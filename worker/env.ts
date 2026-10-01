export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Set with `wrangler secret put TMD_API_TOKEN`. Optional: without it the forecast falls back to Open-Meteo. */
  TMD_API_TOKEN?: string;
}
