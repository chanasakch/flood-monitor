import { describe, expect, it } from 'vitest';
import { isShortMapLink, parseCoordinates, parseGoogleMapsUrl, parsePasted } from '../shared/geolink';

// The address a real short share link redirected to (2026-10-05).
const REAL =
  'https://www.google.com/maps/place/INNER+PEACE+%E0%B8%AA%E0%B8%B2%E0%B8%97%E0%B8%A3+-+%E0%B8%97%E0%B9%88%E0%B8%B2%E0%B8%9E%E0%B8%A3%E0%B8%B0+(by+PEACE)/@13.7033644,100.325346,12z/data=!4m6!3m5!1s0x30e299a5c9c602cd:0x37cbe2dd3a747c93!8m2!3d13.7033281!4d100.4778325!16s%2Fg%2F11xlj_zg1c?entry=tts';

describe('pasted coordinates', () => {
  it('reads latitude then longitude in common forms', () => {
    expect(parseCoordinates('13.7033281, 100.4778325')).toEqual({ lat: 13.7033281, lng: 100.4778325, name: null });
    expect(parseCoordinates('13.7033 100.4778')).toMatchObject({ lat: 13.7033, lng: 100.4778 });
    expect(parseCoordinates('(13.7033,100.4778)')).toMatchObject({ lat: 13.7033, lng: 100.4778 });
  });

  it('ignores ordinary text, numbers alone and positions outside Thailand', () => {
    expect(parseCoordinates('สาทร 13')).toBeNull();
    expect(parseCoordinates('10110')).toBeNull();
    expect(parseCoordinates('48.8566, 2.3522')).toBeNull();
    expect(parseCoordinates('100.4778, 13.7033')).toBeNull(); // longitude first is not accepted
  });
});

describe('Google Maps links', () => {
  it('takes the pin position, not the centre of the view, and the place name', () => {
    expect(parseGoogleMapsUrl(REAL)).toEqual({ lat: 13.7033281, lng: 100.4778325, name: 'INNER PEACE สาทร - ท่าพระ (by PEACE)' });
  });

  it('reads the other common link shapes', () => {
    expect(parseGoogleMapsUrl('https://www.google.com/maps?q=13.7563,100.5018')).toEqual({ lat: 13.7563, lng: 100.5018, name: null });
    expect(parseGoogleMapsUrl('https://www.google.com/maps/search/?api=1&query=13.7563,100.5018')).toMatchObject({ lat: 13.7563, lng: 100.5018 });
    expect(parseGoogleMapsUrl('https://www.google.co.th/maps/place/13.7563,100.5018')).toEqual({ lat: 13.7563, lng: 100.5018, name: null });
    expect(parseGoogleMapsUrl('https://www.google.com/maps/@13.7563,100.5018,15z')).toMatchObject({ lat: 13.7563, lng: 100.5018 });
  });

  it('rejects other sites, links without a position and places outside Thailand', () => {
    expect(parseGoogleMapsUrl('https://evil.example/maps/@13.7,100.5,15z')).toBeNull();
    expect(parseGoogleMapsUrl('https://www.google.com/search?q=13.7,100.5')).toBeNull();
    expect(parseGoogleMapsUrl('https://www.google.com/maps/place/Somewhere/')).toBeNull();
    expect(parseGoogleMapsUrl('https://www.google.com/maps/@48.85,2.35,12z')).toBeNull();
    expect(parseGoogleMapsUrl('not a url')).toBeNull();
  });

  it('recognises only the two short-link hosts', () => {
    expect(isShortMapLink('https://maps.app.goo.gl/g2upLrPTUePyWk13A')).toBe(true);
    expect(isShortMapLink('https://goo.gl/maps/abc123')).toBe(true);
    expect(isShortMapLink('https://maps.app.goo.gl.evil.example/abc')).toBe(false);
    expect(isShortMapLink('http://maps.app.goo.gl/abc')).toBe(false);
    expect(isShortMapLink('https://example.com/?u=https://maps.app.goo.gl/abc')).toBe(false);
  });

  it('handles either kind of pasted text', () => {
    expect(parsePasted('13.7, 100.5')).toMatchObject({ lat: 13.7, lng: 100.5 });
    expect(parsePasted(REAL)?.name).toContain('INNER PEACE');
    expect(parsePasted('โรงแรม')).toBeNull();
  });
});
