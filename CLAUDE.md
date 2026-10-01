# Thailand Flood Monitor — Project Brief

You are building and deploying a public, read-only flood monitoring website for Thailand.
Primary users: a family checking conditions before travelling (including older relatives).
Anyone can view. No login, no user-submitted content.

Work autonomously through every phase below. After each phase, run it, verify it works,
fix problems, then commit and push before moving on. Ask the user only when you need
something only they can provide (login, token, a decision). At the end, the site must be
live on a public URL.

## Repository

- GitHub: https://github.com/chanasakch/flood-monitor (set as `origin`, branch `main`)
- Commit and push at the end of every phase with a clear message.
- Never commit `.env`, `.dev.vars`, tokens or any secret. Add them to `.gitignore` first.

## Non-negotiable accuracy rules

1. Official / scientific sources only. Never scrape Facebook, Instagram, TikTok or X.
2. Every data point shows its **source name, a link to the original, and its observation time**.
3. Data older than its staleness threshold renders **grey with "ข้อมูลไม่เป็นปัจจุบัน" /
   "Data not current"**, never as its last colour. Default thresholds: sensors 60 min,
   radar 30 min, forecast 3 h, announcements 24 h.
4. Never claim "ไม่ท่วม" / "Not flooded" where there is no sensor. Show "ไม่มีข้อมูล" / "No data".
5. Forecasts are shown as rain probability (%) and mm per hour, never as a fixed stop time.
   A one-line summary is allowed, e.g. "โอกาสฝนสูงถึงราว 20:00 จากนั้นลดลง".
6. If a source fails or changes format: keep the last good data marked stale, log the error,
   and show the source as unavailable in the UI. Never invent or interpolate values.
7. Footer on every page (TH/EN): "ใช้ประกอบการตัดสินใจเท่านั้น โปรดตรวจสอบประกาศทางการอีกครั้ง"
   plus emergency numbers 1669, 1784 (ปภ.), 1555 (กทม.).

## Scope

Nationwide:
- Rainfall from stations (ThaiWater / HAII)
- Water level in rivers and canals with alert levels (ThaiWater / HAII)
- Rain radar overlay
- Hourly rain forecast for any tapped point: **TMD NWP API primary, Open-Meteo fallback**
- Department of Highways flooded / impassable road announcements and highway CCTV, if a
  stable machine-readable source exists; otherwise link out to the official page

Bangkok additionally:
- Road flood depth sensors (สำนักการระบายน้ำ กทม.)
- BMA traffic CCTV snapshots

Provinces without road-level sensors get no road layer. Do not fake one.

Out of scope: user reports, social media, AI news summaries, routing, push notifications.

## Data sources — VERIFY EVERY ONE FIRST

Endpoints of Thai government sites change often. Phase 1 exists to confirm them.
For each source: find the real current endpoint (inspect the official site's network
requests if there is no documented API), fetch a sample, save it to `fixtures/`, and record
the result in `SOURCES.md` (URL, auth, update frequency, fields used, terms of use).

| Source | Starting point | Notes |
|---|---|---|
| TMD NWP API (primary forecast) | Docs: https://data.tmd.go.th/nwpapi/doc/ — e.g. `/nwpapi/v1/forecast/location/hourly/at` | Bearer token in secret `TMD_API_TOKEN`. Hourly forecast, high resolution |
| Open-Meteo (fallback forecast) | https://api.open-meteo.com/v1/forecast | No key. `hourly=precipitation,precipitation_probability&timezone=Asia/Bangkok` |
| ThaiWater (HAII) | https://www.thaiwater.net and its public API (api-v3.thaiwater.net) | Rain, water level, alert levels |
| Rain radar | TMD radar products, or another free radar tile source | Check licence permits embedding |
| BMA road flood sensors | Bangkok drainage / weather sites (weather.bangkok.go.th) | Bangkok only |
| BMA CCTV | Bangkok traffic CCTV site | Snapshots only, no stream proxying. Link out if hotlinking is not allowed |
| Department of Highways | Official DOH flood and CCTV pages | Link out if no stable data |

When both forecasts are available, show TMD as the main forecast and label it; show
Open-Meteo only when TMD fails or as a clearly labelled comparison.

Some Thai government endpoints may block non-Thai IPs. Cloudflare Workers may not run from a
Thai IP. If a source fails only from the Worker, record that in `SOURCES.md`, mark the source
unavailable, and tell the user. Do not work around blocks with third-party proxies.

## Tech stack (all free tier)

- Cloudflare Workers with static assets (frontend + API in one Worker)
- Cron Trigger every 10 minutes to fetch and normalise data
- Cloudflare D1 for latest normalised readings, short history (7 days) and fetch status
- Frontend: Vite + TypeScript (React or vanilla, your choice, keep it light)
- Map: MapLibre GL + OpenFreeMap tiles (no API key). Do not use tile.openstreetmap.org
- Charts: a lightweight library (uPlot or Chart.js)
- PWA: manifest + service worker caching the shell and the last API response
- Wrangler for local dev and deploy

Keep request volume low: the cron fetches upstream, the frontend only calls our own API.
Point forecasts are fetched on demand and cached ~30 min per rounded coordinate.

## Design system (production quality)

Goal: looks like a polished production app, calm and trustworthy, readable at a glance
by older relatives. Clarity beats decoration.

- Languages: Thai (default) and English, toggle in header, remembered in localStorage.
  All strings in i18n files (`th.json`, `en.json`), no hardcoded text. Times in
  Asia/Bangkok; Thai uses Buddhist year.
- Typography: IBM Plex Sans Thai (or Noto Sans Thai) self-hosted, fallback system-ui.
  Base 17–18px on mobile, clear hierarchy, tabular numbers for values.
- Theme: light, dark, and "system". Colour tokens as CSS variables. WCAG AA contrast minimum.
- Status colours: colour-blind-safe green / yellow / red for alert levels, grey for stale
  or no data, always paired with a text label and icon (never colour alone).
- Layout: mobile-first, responsive to tablet and desktop (map + side panel on desktop,
  bottom sheet on mobile). Touch targets ≥ 44px. Safe-area insets for iPhone.
- Components: cards with soft shadows and rounded corners, skeleton loaders, empty and
  error states in plain language, subtle motion that respects prefers-reduced-motion.
- Icons: Lucide, bundled.

### Charts
- Hourly rain forecast: bars for mm/h + line for probability %, next 24–48 h,
  "now" marker, source labelled (TMD / Open-Meteo).
- Water level: 24 h / 7 d line with alert thresholds drawn as bands.
- Rainfall accumulation at nearest station: 1 h / 3 h / 24 h.
- Every chart shows source and last update time.

### Map
- MapLibre + OpenFreeMap styles matching light/dark theme.
- Layer toggles with legend: rain, water level, radar, road sensors (BKK), CCTV.
- Tapping a marker shows value, level, source link, and "อัปเดตเมื่อ X นาทีที่แล้ว".
- Marker clustering when zoomed out.
- Optional 3D mode toggle (default OFF): pitch + extruded buildings from OpenFreeMap,
  terrain only if a free DEM source is verified. Must stay smooth on mid-range phones;
  auto-disable on low performance.

### Pages
1. Home: "ที่ประจำ / My places" — saved places (home, work, school) in localStorage.
   Each card: overall status, nearest rain, nearest water level, Bangkok road sensor if
   applicable, next 12 h rain mini-chart.
2. Map: full screen with layer toggles and legend.
3. Place detail: charts, nearest sensors, CCTV snapshots.
4. Source status: every source, last successful fetch, errors.
5. About / how to read this site (TH + EN).

## Phases

1. **Verify sources.** Fill `SOURCES.md` and `fixtures/`. Report which sources work.
   For TMD, ask the user to set the token first (see Secrets) or test with a local
   `.dev.vars` the user creates themselves.
2. **Scaffold.** Worker + assets, D1 schema and migrations, `wrangler.toml` with cron,
   `.gitignore`, i18n and theme foundations.
3. **Fetchers.** One module per source, normalised to a common schema
   (id, type, lat, lng, value, unit, level, observed_at, source, source_url).
   Unit tests against `fixtures/`.
4. **API.** `/api/layers/:type`, `/api/forecast?lat&lng`, `/api/history/:id`, `/api/sources`.
5. **Frontend.** All pages, map, charts, saved places, staleness handling, TH/EN,
   light/dark, PWA.
6. **Local test.** `wrangler dev`, trigger cron manually, check every layer renders and
   stale data turns grey. Test at 375px, 768px, 1440px in light and dark, TH and EN.
   Run Lighthouse (mobile) and fix until Performance ≥ 85 and Accessibility ≥ 95.
7. **Deploy.** Create the D1 database, apply migrations, confirm secrets are set,
   `npx wrangler deploy`. Open the live URL, confirm data loads, wait for one real cron run.
8. **Hand-over.** Write `README.md` in Thai: live URL, how to redeploy, how to check source
   status, how to add a saved place, known limitations. Final commit and push.

## Secrets

- `TMD_API_TOKEN` — the user sets it themselves. When it is needed, stop and tell the user
  to run `npx wrangler secret put TMD_API_TOKEN` in the terminal (and, for local dev,
  create `.dev.vars` with `TMD_API_TOKEN=...`). Never ask for the token in chat,
  never print it, never commit it.