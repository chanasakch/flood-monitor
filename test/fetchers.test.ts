import { describe, expect, it } from 'vitest';
import { parseCctv } from '../worker/fetchers/bma-cctv';
import { parseRoad } from '../worker/fetchers/bma-road';
import { parseDepthText, parseHighway } from '../worker/fetchers/doh';
import { parseOpenMeteo } from '../worker/fetchers/open-meteo';
import { parseRain, parseRainGraph } from '../worker/fetchers/thaiwater-rain';
import { parseWater, parseWaterGraph } from '../worker/fetchers/thaiwater-water';
import { parseTmdHourly } from '../worker/fetchers/tmd-nwp';
import { isPng, parseRadarList } from '../worker/fetchers/tmd-radar';
import { FormatError } from '../worker/lib/http';
import { packLayer, unpackLayer } from '../worker/pack';
import { expectCommonSchema, fixtureBytes, fixtureJson, fixtureText } from './helpers';

describe('ThaiWater rain', () => {
  const raw = fixtureJson('thaiwater-rain24h.json') as { data: any[] };
  const readings = parseRain(raw);

  it('normalises every station to the common schema', () => {
    expect(readings.length).toBe(raw.data.length);
    expectCommonSchema(readings, 'rain', 'thaiwater-rain');
  });

  it('keeps 24 h rain as the value and the station time as observed_at', () => {
    const first = raw.data[0];
    const r = readings.find((x) => x.id === `rain:${first.station.id}`)!;
    expect(r.value).toBe(141.5);
    expect(r.unit).toBe('mm');
    expect(r.level).toBe('danger'); // > 90 mm in 24 h is "very heavy"
    expect(r.observed_at).toBe('2026-10-01T15:00:00+07:00');
    expect(r.name_th).toBe('บ้านห้วยแก้ว');
    expect(r.extra?.province_code).toBe('86');
  });

  it('keeps a missing 1 h value as null instead of zero', () => {
    const missing = raw.data.filter((d) => d.rain_1h == null);
    expect(missing.length).toBeGreaterThan(0);
    for (const d of missing) {
      expect(readings.find((x) => x.id === `rain:${d.station.id}`)!.extra?.rain_1h).toBeNull();
    }
  });

  it('rejects a response with a changed format', () => {
    expect(() => parseRain({ result: 'OK', rows: [] })).toThrow(FormatError);
    expect(() => parseRain({ data: [] })).toThrow(FormatError);
  });

  it('parses the hourly graph', () => {
    const points = parseRainGraph(fixtureJson('thaiwater-rain-graph.json'));
    expect(points.length).toBe(42);
    expect(points[0]).toEqual({ time: '2026-09-30T00:00:00+07:00', value: 0 });
  });
});

describe('ThaiWater water level', () => {
  const raw = fixtureJson('thaiwater-waterlevel.json') as { waterlevel_data: { data: any[] } };
  const readings = parseWater(raw);

  it('normalises every station to the common schema', () => {
    expect(readings.length).toBe(raw.waterlevel_data.data.length);
    expectCommonSchema(readings, 'water', 'thaiwater-water');
  });

  it('maps the agency situation level to an alert level', () => {
    for (const d of raw.waterlevel_data.data) {
      const r = readings.find((x) => x.id === `water:${d.station.id}`)!;
      const expected = d.situation_level == null ? 'unknown' : d.situation_level >= 5 ? 'danger' : d.situation_level === 4 ? 'watch' : 'normal';
      expect(r.level).toBe(expected);
    }
    expect(readings.some((r) => r.level === 'unknown')).toBe(true);
    expect(readings.some((r) => r.level === 'danger')).toBe(true);
  });

  it('parses the water level string and bank level', () => {
    const r = readings.find((x) => x.id === 'water:505018')!;
    expect(r.value).toBe(50.27);
    expect(r.extra?.bank).toBe(45.8);
    expect(r.extra?.river).toBe('แม่น้ำแควน้อย');
    expect(r.source_url).toBe('https://www.thaiwater.net/water/station/dataindex/tele_wl/505018');
  });

  it('passes a future observation time through unchanged so the UI can grey it out', () => {
    expect(readings.find((x) => x.id === 'water:505018')!.observed_at).toBe('2026-10-01T23:00:00+07:00');
  });

  it('parses the history graph with thresholds', () => {
    const g = parseWaterGraph(fixtureJson('thaiwater-waterlevel-graph.json'));
    expect(g.points.length).toBe(42);
    expect(g.points[0].value).toBeNull();
    expect(g.points[1]).toEqual({ time: '2026-09-30T01:00:00+07:00', value: 52.9 });
    expect(g.thresholds).toEqual({ bank: 45.8, ground: 36.66 });
  });
});

describe('BMA road flood sensors', () => {
  const raw = fixtureJson('bma-flood-getdata.json') as { floodTbl: any[]; dtTblTunel: any[] };
  const readings = parseRoad(raw);

  it('normalises road and underpass sensors', () => {
    expectCommonSchema(readings, 'road', 'bma-road');
    expect(readings.filter((r) => r.extra?.tunnel === true).length).toBe(raw.dtTblTunel.length);
    expect(readings.filter((r) => r.extra?.tunnel === false).length).toBe(new Set(raw.floodTbl.map((f) => f.flood_id)).size);
  });

  it('applies the BMA thresholds: <= 5 normal, > 5-10 slight flooding, > 10 flooding', () => {
    for (const r of readings) {
      if (r.value == null) expect(r.level).toBe('unknown');
      else if (r.value > 10) expect(r.level).toBe('danger');
      else if (r.value > 5) expect(r.level).toBe('watch');
      else expect(r.level).toBe('normal');
    }
    const bangKapi = readings.find((r) => r.id === 'road:215')!;
    expect(bangKapi.value).toBe(20);
    expect(bangKapi.level).toBe('danger');
    expect(bangKapi.name_en).toBe('Thanon Nawamin, Bang Kapi Junction *');
  });

  it('converts .NET dates and links to the official sensor page', () => {
    const r = readings.find((x) => x.id === 'road:215')!;
    expect(r.observed_at).toBe('2026-09-26T13:45:00+07:00');
    expect(r.source_url).toBe('https://floodbangkok.bangkok.go.th/device-info?sensor_profile_id=FL.BKP.03');
  });

  it('never links outside bangkok.go.th', () => {
    const tampered = { floodTbl: [{ ...raw.floodTbl[0], web_url: 'https://evil.example/x' }] };
    expect(parseRoad(tampered)[0].source_url).toBe('https://weather.bangkok.go.th/flood');
  });
});

describe('BMA CCTV directory', () => {
  const readings = parseCctv(fixtureText('bma-cctv-index.snippet.html'));

  it('extracts cameras with coordinates and an official link', () => {
    expect(readings.length).toBe(60);
    expectCommonSchema(readings, 'cctv', 'bma-cctv');
    const silom = readings.find((r) => r.id === 'cctv:603')!;
    expect(silom.name_th).toBe('แยกสีลม-นราธิวาส');
    expect(silom.name_en).toBe('Silom-Naradhiwas Intersection');
    expect(silom.lat).toBe(13.7262);
    expect(silom.source_url).toBe('http://www.bmatraffic.com/PlayVideo.aspx?ID=603');
  });

  it('does not keep internal IP addresses', () => {
    expect(JSON.stringify(readings)).not.toMatch(/\b10\.\d+\.\d+\.\d+\b/);
  });

  it('fails loudly when the page layout changes', () => {
    expect(() => parseCctv('<html><body>maintenance</body></html>')).toThrow(FormatError);
  });
});

describe('Department of Highways reports', () => {
  const raw = fixtureJson('doh-hdms-dashboard.json') as any[];
  const readings = parseHighway(raw);

  it('keeps only open incidents', () => {
    expectCommonSchema(readings, 'highway', 'doh-hdms');
    expect(readings.length).toBe(raw.filter((r) => !r.end_date).length);
    expect(readings.length).toBeLessThan(raw.length);
  });

  it('treats lane_closure=true as passable (watch) and false as not passable (danger)', () => {
    for (const row of raw.filter((r) => !r.end_date)) {
      const r = readings.find((x) => x.id === `highway:${row.gid}`)!;
      expect(r.level).toBe(row.lane_closure ? 'watch' : 'danger');
      expect(r.extra?.passable).toBe(row.lane_closure);
    }
  });

  it('never copies reporter names, phone numbers or free-text remarks', () => {
    const dump = JSON.stringify(readings);
    expect(dump).not.toContain('REDACTED');
    expect(dump).not.toContain('reporter');
    expect(dump).not.toContain('initial_relief');
    const withPhone = parseHighway([{ ...raw[0], end_date: null, case_name: 'น้ำท่วม ทล. 33 โทร 081-234-5678' }]);
    expect(withPhone[0].name_th).toBe('น้ำท่วม ทล. 33 โทร');
  });

  it('reads the reported depth from free text', () => {
    expect(parseDepthText('10-15')).toBe(15);
    expect(parseDepthText('26')).toBe(26);
    expect(parseDepthText('')).toBeNull();
    expect(parseDepthText(null)).toBeNull();
    const r = readings.find((x) => x.id === 'highway:138089')!;
    expect(r.value).toBe(26);
    expect(r.extra?.road).toBe('33');
    expect(r.observed_at).toBe('2026-10-01T17:11:15+07:00');
  });
});

describe('TMD radar', () => {
  it('picks the newest frame and converts UTC to Thai time', () => {
    const frame = parseRadarList(fixtureText('tmd-radar-images_composite.list'));
    expect(frame).toEqual({ observed_at: '2026-10-01T16:45:00+07:00', file: 'zr/24.png' });
  });

  it('rejects an empty or changed list', () => {
    expect(() => parseRadarList('<html>404</html>')).toThrow(FormatError);
  });

  it('recognises PNG data', () => {
    expect(isPng(fixtureBytes('tmd-radar-frame.png'))).toBe(true);
    expect(isPng(new TextEncoder().encode('<html>not an image</html>'))).toBe(false);
  });
});

describe('Forecasts', () => {
  it('parses the TMD hourly forecast (mm per hour, no probability)', () => {
    const hours = parseTmdHourly(fixtureJson('tmd-nwp-hourly.json'));
    expect(hours.length).toBe(48);
    expect(hours[0]).toEqual({ time: '2026-10-01T17:00:00+07:00', mm: 0, cond: 1 });
    expect(hours.every((h) => !('prob' in h))).toBe(true);
  });

  it('parses Open-Meteo precipitation and probability in Thai time', () => {
    const hours = parseOpenMeteo(fixtureJson('open-meteo.json'));
    expect(hours.length).toBe(72);
    expect(hours[0].time).toBe('2026-10-01T00:00:00+07:00');
    for (const h of hours) {
      expect(h.mm === null || h.mm >= 0).toBe(true);
      expect(h.prob === null || (h.prob! >= 0 && h.prob! <= 100)).toBe(true);
    }
  });

  it('rejects malformed forecast responses', () => {
    expect(() => parseTmdHourly({ error: 'Unauthenticated.' })).toThrow(FormatError);
    expect(() => parseOpenMeteo({ hourly: { time: [] }, utc_offset_seconds: 0 })).toThrow(FormatError);
  });
});

describe('layer packing', () => {
  it('round-trips to the full common schema', () => {
    const readings = parseWater(fixtureJson('thaiwater-waterlevel.json'));
    const packed = packLayer(readings);
    expect(packed.defaults).toMatchObject({ type: 'water', unit: 'm MSL', source: 'thaiwater-water' });
    expect(packed.items[0]).not.toHaveProperty('type');
    expect(unpackLayer(JSON.parse(JSON.stringify(packed)))).toEqual(readings);
  });
});
