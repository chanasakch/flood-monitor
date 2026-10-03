# Data sources

Verified on 2026-10-01 (Asia/Bangkok) from a Thai residential connection.
Samples of every response are in [`fixtures/`](fixtures/). Large responses are trimmed to a
representative subset that keeps the edge cases found (null values, old timestamps,
timestamps in the future). Personal data in the Department of Highways sample (reporter
names, phone numbers) is replaced with `REDACTED`; the application never stores those fields.

Status legend: **OK** = fetched and parsed ·
**LINK-OUT** = no usable machine-readable source, the site links to the official page.

| # | Source | Status | Used for |
|---|---|---|---|
| 1 | TMD NWP API | OK | Hourly rain forecast, mm/h (primary) |
| 2 | Open-Meteo | OK | Rain probability %, fallback mm/h |
| 3 | ThaiWater rain | OK from Thailand, **blocked from Cloudflare Workers (429)**, fetched by the browser | Station rainfall 1 h / 24 h, nationwide |
| 4 | ThaiWater water level | OK from Thailand, **blocked from Cloudflare Workers (429)**, fetched by the browser | River / canal level with alert level, nationwide |
| 5 | TMD radar composite | OK (no CORS, no written licence) | Rain radar overlay |
| 6 | BMA road flood sensors | OK | Road flood depth, Bangkok only |
| 7 | BMA traffic CCTV | LINK-OUT (camera list OK from Thailand, **unreachable from Cloudflare**) | Camera locations, Bangkok only |
| 8 | Department of Highways HDMS | OK (undocumented) | Flooded / impassable highway reports |
| 9 | Department of Highways CCTV | LINK-OUT | — |

The table above is what a normal Thai connection sees. What the deployed Worker can actually
reach is in "Reachability from the Worker" at the bottom, and it differs for four sources.

Staleness thresholds in use: BMA road sensors 60 min, ThaiWater rain and water level 180 min
(stations report hourly and ThaiWater publishes 1.5-2.5 h after the observation: at 17:47 on
the test day 53 % of rain stations and 28 % of water stations were 90-120 min old), radar
30 min, forecasts 3 h, highway reports 24 h.

---

## 1. TMD NWP API — primary forecast

- Docs: https://data.tmd.go.th/nwpapi/doc/apidoc/location/forecast_hourly.html
- Endpoint: `GET https://data.tmd.go.th/nwpapi/v1/forecast/location/hourly/at`
- Query: `lat`, `lon` (required), `fields=rain,cond`, `duration` (max 48 h),
  optional `date=YYYY-MM-DD`, `hour=0-23` (default: current hour, GMT+7)
- Auth: `authorization: Bearer <token>`; secret name `TMD_API_TOKEN`.
  Without a token the API answers `401 {"error":"Unauthenticated."}` (verified).
- Errors: 401 bad/expired token, 422 bad request or range outside available data, 429 rate limit.
- Model resolution: 2 km (per the docs). Update frequency: model runs, not documented per hour.
- Fields used: `time`, `data.rain` (mm in that hour), `data.cond` (1–12 weather condition code).
- **No rain probability field exists in this API.** Probability (%) therefore always comes
  from Open-Meteo and is labelled as such.
- Terms: registration required at data.tmd.go.th; token is personal to the account.
- Verified live with the owner token: 200, 48 hourly rows, times as `2026-10-01T17:00:00+07:00`,
  grid point snapped to the model (`location.lat/lon`). Header `x-ratelimit-limit: 60`.
- Response shape: `WeatherForecasts[0].forecasts[] = { time, data: { rain, cond } }`.
- Fixture: `tmd-nwp-hourly.json`

## 2. Open-Meteo — probability and fallback forecast

- Endpoint: `GET https://api.open-meteo.com/v1/forecast?latitude&longitude&hourly=precipitation,precipitation_probability&timezone=Asia/Bangkok&forecast_days=3`
- Auth: none.
- Update frequency: hourly model updates.
- Fields used: `hourly.time[]` (local time, no offset, `utc_offset_seconds` = 25200),
  `hourly.precipitation[]` (mm), `hourly.precipitation_probability[]` (%).
- Terms: free for non-commercial use, under 10,000 calls/day, attribution required
  (CC BY 4.0) — https://open-meteo.com/en/terms
- Fixture: `open-meteo.json`

## 3. ThaiWater (HII / สสน.) — rainfall

- Endpoint: `GET https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h`
  (the endpoint used by www.thaiwater.net itself; no documented public API contract)
- Auth: none. CORS: reflects any origin.
- Size: ~4.7 MB JSON, 4,644 stations from 8 agencies (DWR, HII, FOP, DDPM, RID, TMD, EGAT, DNP).
- Update frequency: stations report every 10–60 min; most rows were 5–125 min old.
- Fields used: `station.id`, `station.tele_station_name.th/en`, `station.tele_station_lat/long`,
  `rain_1h` (mm, **null for 575 stations**), `rain_24h` (mm), `rainfall_datetime`
  (`YYYY-MM-DD HH:mm`, Asia/Bangkok), `agency.agency_shortname`, `geocode.province_name`,
  `geocode.province_code`.
- History: `GET …/public/rain_24h_graph?station_id=<id>&start_date&end_date` returns hourly
  `rainfall_value` for roughly the last two days only, whatever range is asked.
- 3 h accumulation is not published; it is summed from the hourly series only when all
  three hours are present, otherwise shown as "no data".
- Terms: no licence text found on the API. Data is published openly by the National
  Hydroinformatics Data Center; shown with attribution and a link to thaiwater.net.
- Fixtures: `thaiwater-rain24h.json` (trimmed), `thaiwater-rain-graph.json`

## 4. ThaiWater (HII / สสน.) — water level

- Endpoint: `GET https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load`
- Auth: none. Size: ~1.4 MB JSON, 807 telemetry stations (HII, RID, FOP, EGAT).
- Update frequency: 10–60 min.
- Fields used: `station.id`, names, lat/long, `waterlevel_msl` (m MSL, string),
  `waterlevel_datetime`, `storage_percent` (% of channel capacity), `situation_level` (1–5,
  **null for 15 stations**), `station.min_bank`, `station.ground_level`, `river_name`,
  `agency`, `geocode`, `diff_wl_bank`.
- Official scale (returned in the `scale` block of the same response):
  5 = > 100 % "น้ำล้นตลิ่ง" (overflow) · 4 = > 70 % "น้ำมาก" (high) · 3 = > 30 % "น้ำปกติ" ·
  2 = > 10 % "น้ำน้อย" · 1 = ≤ 10 % "น้ำน้อยวิกฤต".
  Site mapping: 5 → red, 4 → yellow, 1–3 → green (no flood risk), null → no data.
- **Known data problem:** 28 stations (RID) carried `waterlevel_datetime` 6 hours in the
  future. Any observation time more than 15 min ahead of now is treated as untrustworthy
  and rendered grey.
- History: `GET …/public/waterlevel_graph?station_type=tele_waterlevel&station_id=<id>&start_date&end_date`
  → hourly `value` (m MSL) plus `min_bank`, `ground_level`, `warning_level`, `critical_level`.
  7-day ranges work (verified).
- Fixtures: `thaiwater-waterlevel.json` (trimmed), `thaiwater-waterlevel-graph.json`

## 5. TMD radar composite — rain radar overlay

- Page: https://weather.tmd.go.th/composite/index_composite.html
- Frame list: `GET https://weather.tmd.go.th/composite/images_composite.list`
  — 24 lines `background_THA.png "YYYY-MM-DD HH:mm" overlay=zr/NN.png`, one per 15 min.
- Latest time: `GET https://weather.tmd.go.th/composite/radar.sharing.latest` (plain text).
- Image: `GET https://weather.tmd.go.th/composite/images/zr/NN.png` — transparent RGBA PNG
  1800×2644, 30–150 KB. National mosaic, PCAPPI 2 km, Z = 200 R^1.6, rain rate in mm/h.
- Georeference (from the page's own MapLibre config): west 97.50, east 105.65,
  north 20.48, south 5.58.
- **Timestamps are UTC** (the page adds 7 h before display). Latest frame was ~20 min old.
- Auth: none. **No `Access-Control-Allow-Origin` header**, so a browser cannot load the
  image into a WebGL map directly. The Worker fetches the newest frame once per new frame
  and serves it unmodified from our own origin.
- Terms: page footer "© 2022 Thai Meteorological Department (TMD)". TMD's public service
  manual describes the radar products as open public information without fees. **No written
  licence that explicitly permits re-serving was found** — this is a known limitation; the
  image is shown unmodified, with TMD named and linked. Owner should ask TMD if in doubt.
- Verified alternative, not used: RainViewer (`https://api.rainviewer.com/public/weather-maps.json`,
  CORS enabled). Terms: "free for personal or educational use", attribution with link
  required. Not official, so kept only as a documented fallback option.
- Fixtures: `tmd-radar-images_composite.list`, `tmd-radar-sharing-latest.txt`,
  `tmd-radar-frame.png`, `rainviewer.json`

## 6. BMA Drainage and Sewerage Department — road flood sensors (Bangkok)

- Page: https://weather.bangkok.go.th/flood
- Endpoint: `GET https://weather.bangkok.go.th/Flood/PageMap/GetData?id=` → JSON ~1 MB.
  Behind Cloudflare; a non-browser User-Agent got 403, a browser-like one is accepted.
- Auth: none. Update frequency: every 5 min.
- Blocks used: `floodTbl` (247 road sensors), `dtTblTunel` (underpass sensors).
- Fields used: `flood_id`, `flood_code`, `flood_name` / `flood_name_en`, `latitude`,
  `longitude`, `flood` (cm on the road surface, null = sensor offline),
  `site_timestamp` (`/Date(ms)/`), `web_url` (official per-sensor page on
  floodbangkok.bangkok.go.th).
- Official thresholds (from the page's own code): ≤ 5 cm "ปกติ" (normal) → green ·
  > 5–10 cm "น้ำท่วมขังเล็กน้อย" (slight flooding) → yellow · > 10 cm "น้ำท่วม" (flooding) → red ·
  null → sensor not connected → grey.
- Some sensors report timestamps weeks or months old; they go grey by the 60-min rule.
- Terms: none published. Shown with attribution and a link to each sensor's official page.
- Fixture: `bma-flood-getdata.json` (trimmed)

## 7. BMA Traffic CCTV (Bangkok)

- Page: http://www.bmatraffic.com/index.aspx (**HTTP only**, HTTPS does not answer)
- Camera list: inline `var locations = [[id, name_th, name_en, …, lat, lng, internal_ip, icon], …]`
  in the page HTML — 584 cameras with coordinates.
- Snapshot: `show.aspx?image=<id>` only returns a real frame inside a browser session
  started on `PlayVideo.aspx?ID=<id>`; without it a 1.4 KB placeholder is returned.
  Being HTTP-only, the images would also be blocked as mixed content on an HTTPS site.
- Decision: **LINK-OUT**. The map shows camera positions; tapping one opens the official
  camera page `http://www.bmatraffic.com/PlayVideo.aspx?ID=<id>` in a new tab. No image is
  proxied or re-hosted. Internal IP addresses in the list are discarded.
- Refresh: once a day (camera positions rarely change).
- Fixture: `bma-cctv-index.snippet.html` (the `locations` block only)

## 8. Department of Highways — HDMS public dashboard (ศูนย์บริหารงานอุบัติภัย 2.0)

- Page: https://hdms.doh.go.th/dashboard (public view, no login)
- Endpoint: `GET https://hdms.doh.go.th/internal-api/public/dashboard?start=YYYY-MM-DD&end=YYYY-MM-DD`
  → JSON array of incident tickets (187 active on the day of the check, 179 of them floods).
  Types list: `GET …/internal-api/public/metadata`.
- Auth: none. Undocumented; it is what the public dashboard itself calls, so it can change
  without notice. If the format changes the source is marked unavailable and the site
  falls back to a link to the dashboard.
- Fields used: `gid`, `case_id`, `case_name`, `incident_type_id` (1 = อุทกภัย flood,
  2 = landslide, 8 = storm …), `latitude`, `longitude`, `road_code`, `km_start`, `km_end`,
  `flood_level` (cm, free text such as "10-15"), `lane_closure`
  (**true = passable, false = not passable** — confirmed in the dashboard code:
  "การผ่านทาง: ได้ / ไม่ได้"), `road_closure_text` (reason when impassable),
  `province`, `start_date`, `end_date`, `report_date` (UTC ISO).
- Observation time shown on the site = `report_date` (last report by the highway district).
  Announcements older than 24 h go grey.
- **Never stored or shown:** `reporter_name`, `tel`, user ids, free-text fields that may
  contain phone numbers.
- Fixture: `doh-hdms-dashboard.json` (trimmed, personal data redacted)

## 9. Department of Highways — CCTV

- https://highwaytraffic.go.th/DOHWeb/Home.aspx shows cameras through a session-bound
  handler (`SiteCameraHandler.ashx`); no stable public list with coordinates was found.
- Decision: **LINK-OUT** to the official page.

## Place search (not flood data)

The search box only moves the map or opens a point; it never supplies readings.

- **Subdistricts, districts, provinces**: `public/gazetteer.json`, built by
  `scripts/build-gazetteer.mjs` from the subdistrict point file on the TMD radar page,
  `https://weather.tmd.go.th/composite/data/tambon_points.geojson` (7,367 subdistricts, 928
  districts, 77 provinces, Thai and English names, centre points). Bundled with the site, so it
  works offline and no query leaves the device. District and province positions are the mean of
  their subdistrict points. No licence is stated for the file; it holds administrative names
  and coordinates only. Rebuild it when administrative boundaries change.
- **Named places** (schools, temples, markets, ...): Photon, `https://photon.komoot.io/api/`
  (OpenStreetMap data, ODbL, no key). Called by the Worker at `/api/search?q=`, limited to
  Thailand's bounding box, cached in D1 for 7 days per query. The service asks for fair use and
  may throttle; when it fails the built-in list still works and the box says so. Typical
  response time 3-4 s. Fixture: `photon-search.json`.

## LINE Messaging API (alerts, not a data source)

- Endpoint: `POST https://api.line.me/v2/bot/message/broadcast` (to every friend of the account),
  plus free read-only calls `GET /v2/bot/info`, `/v2/bot/message/quota`,
  `/v2/bot/message/quota/consumption` to check the token and usage every 6 hours.
- Auth: channel access token, secret `LINE_CHANNEL_ACCESS_TOKEN`.
- Free plan (Thailand): 300 messages a month, counted per recipient
  (https://developers.line.biz/en/docs/messaging-api/pricing/). With 6 people: 48 sends a month.
- Alerts are computed from the TMD and Open-Meteo forecasts only (`shared/alerts.ts`).

## Map and other third-party resources

- Base map: OpenFreeMap styles `https://tiles.openfreemap.org/styles/{positron,dark,liberty}`
  (all answered 200). No API key. Attribution: OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors.
- Terrain (3D): no free DEM source verified → terrain is not enabled; 3D mode uses pitch and
  extruded buildings only.

## Reachability from the Worker

Checked on 2026-10-01 after deployment to `https://flood-monitor.flood-monitor.workers.dev`.
"Cron" = scheduled runs, which Cloudflare executes wherever it has spare capacity (in practice
outside Thailand; the `[placement]` setting does not move them). "Visit" = the Worker handling a
visitor's request, which for visitors in Thailand runs at Cloudflare Bangkok (`colo=BKK`).

| Source | From cron (abroad) | From a visit (Bangkok) | Result on the site |
|---|---|---|---|
| TMD NWP forecast | — (on demand only) | OK | Works |
| Open-Meteo | — (on demand only) | OK | Works |
| TMD radar composite | OK | OK | Works |
| BMA road flood sensors | **403** | OK | Works, refreshed on visit |
| Department of Highways HDMS | **520** | OK | Works, refreshed on visit |
| ThaiWater rain | **429** | **429** | Works, **fetched by the visitor's browser** |
| ThaiWater water level | **429** | **429** | Works, **fetched by the visitor's browser** |
| BMA traffic CCTV list | **522** | **522** | **Unavailable**, link to the official site |

Notes

- **TMD NWP** only accepts old TLS 1.2 CBC cipher suites. Cloudflare's network connects fine;
  the local `wrangler dev` runtime cannot ("Network connection lost"), so locally the forecast
  always falls back to Open-Meteo. This is a local-development limitation only.
- **BMA road sensors and Highways HDMS** refuse requests that arrive from outside Thailand.
  They are therefore refreshed by the Worker when a visitor's request finds the stored data
  older than ~10 minutes (`refreshOnVisit` in `worker/cron.ts`): at most one upstream request
  per source per 10 minutes, the same volume as the cron. Before fetching, the Worker checks
  its own egress country and does nothing unless it is `TH`. Consequence: with no visitors the
  data is not refreshed and shows grey as "not current" until the next visit, and the road
  sensor history only has points for periods when the site was being used.
- **ThaiWater** (`api-v3.thaiwater.net`) is itself behind Cloudflare and answers every request
  from a Cloudflare Worker, from any location, with `429` and the text
  "การใช้งานถึง limit ที่กำหนด กรุณาติดต่อผู้ดูแลระบบ" (usage limit reached, contact the
  administrator), within a few milliseconds. Requests from one Worker to another Cloudflare
  customer leave from a small shared address pool, so ThaiWater's per-address limit is
  effectively always exhausted for Workers. Five of five attempts failed; a normal Thai
  connection gets `200`. No other official host serves the same data.
  **Decision (owner, 2026-10-01):** the visitor's browser fetches ThaiWater directly
  (`src/lib/thaiwater.ts`). The API allows cross-origin requests, the responses go through the
  same tested parsers, and the service worker keeps each answer for 10 minutes. This departs
  from the brief's "the frontend only calls our own API" for these two layers and their station
  graphs. Costs: about 0.8 MB of transfer per 10 minutes per visitor (rain 0.58 MB + water
  0.24 MB, gzip), ThaiWater sees the visitor's own connection, and the layers depend on
  ThaiWater keeping cross-origin access open. The Worker no longer calls ThaiWater from cron.
  The fetch status of these two sources is recorded in each visitor's browser and shown on the
  status page as belonging to that device.
- **BMA traffic CCTV** (`www.bmatraffic.com`, HTTP only) cannot be reached from Cloudflare at
  all (`522`, connection timed out). The CCTV layer shows as unavailable and links to the site.
- The Worker retries the camera list every 6 hours, so that layer comes back by itself if the
  site becomes reachable.
