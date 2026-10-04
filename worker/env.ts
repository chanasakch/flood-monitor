export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Set with `wrangler secret put TMD_API_TOKEN`. Optional: without it the forecast falls back to Open-Meteo. */
  TMD_API_TOKEN?: string;
  /** LINE Messaging API channel access token (secret). Without it alerts are only logged. */
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  /**
   * Longdo Map API key for place search, handed to the browser by /api/config (Longdo restricts
   * it by domain). Without it the search uses OpenStreetMap only.
   */
  LONGDO_API_KEY?: string;
  /** LINE channel secret (secret), to verify webhook requests really come from LINE. */
  LINE_CHANNEL_SECRET?: string;
  /** Password of the "admin" account for the LINE send page (secret). */
  ADMIN_PASSWORD?: string;
  /** Random key that signs admin session cookies (secret). */
  SESSION_SECRET?: string;
  /** Public address of the site, used in alert messages. */
  SITE_URL?: string;
  /** People expected to follow the LINE account; sets the monthly alert cap. */
  ALERT_RECIPIENTS?: string;
}
