// Builds public/gazetteer.json: a compact list of every subdistrict (tambon / khwaeng) with its
// district, province and centre point, used by the place search box.
//
// Input: the subdistrict point file published on the Thai Meteorological Department radar page,
//   https://weather.tmd.go.th/composite/data/tambon_points.geojson
// Usage: node scripts/build-gazetteer.mjs path/to/tambon_points.geojson
import { readFileSync, writeFileSync } from 'node:fs';

const src = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const provinces = new Map(); // code -> [th, en]
const districts = new Map(); // code -> [th, en, provinceIndex]
const tambons = [];

for (const f of src.features) {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  if (!p.tam_th || !p.amp_code || !p.pro_code || !(lat >= 5 && lat <= 21 && lng >= 97 && lng <= 106)) continue;
  if (!provinces.has(p.pro_code)) provinces.set(p.pro_code, [p.pro_th, p.pro_en ?? '']);
  if (!districts.has(p.amp_code)) districts.set(p.amp_code, [p.amp_th, p.amp_en ?? '', [...provinces.keys()].indexOf(p.pro_code)]);
  tambons.push([p.tam_th, [...districts.keys()].indexOf(p.amp_code), Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4]);
}

const out = { source: 'https://weather.tmd.go.th/composite/data/tambon_points.geojson', p: [...provinces.values()], a: [...districts.values()], t: tambons };
writeFileSync('public/gazetteer.json', JSON.stringify(out));
console.log(`provinces ${out.p.length}, districts ${out.a.length}, subdistricts ${out.t.length}`);
