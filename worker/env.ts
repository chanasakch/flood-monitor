export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Set with `wrangler secret put TMD_API_TOKEN`. Optional: without it the forecast falls back to Open-Meteo. */
  TMD_API_TOKEN?: string;
  /** LINE Messaging API channel access token (secret). Without it alerts are only logged. */
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  /** Public address of the site, used in alert messages. */
  SITE_URL?: string;
  /** People expected to follow the LINE account; sets the monthly alert cap. */
  ALERT_RECIPIENTS?: string;
}
