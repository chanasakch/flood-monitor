// Some Thai government sites reject requests without a browser-like User-Agent.
const UA =
  'Mozilla/5.0 (compatible; ThailandFloodMonitor/1.0; +https://github.com/chanasakch/flood-monitor) AppleWebKit/537.36 Chrome/126 Safari/537.36';

export class UpstreamError extends Error {}

export async function fetchUpstream(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 25000, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*', ...(headers as Record<string, string>) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new UpstreamError(`network error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`);
  return res;
}

export async function fetchJson<T = unknown>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await fetchUpstream(url, init);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(`response is not JSON (${text.slice(0, 60).replace(/\s+/g, ' ')})`);
  }
}

/** Raised when a response parses but does not have the shape we rely on. */
export class FormatError extends Error {}

export function assertFormat(cond: unknown, what: string): asserts cond {
  if (!cond) throw new FormatError(`unexpected format: ${what}`);
}
