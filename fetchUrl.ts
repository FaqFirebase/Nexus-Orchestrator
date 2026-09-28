// URL fetch + HTML-to-text helper used by the fetch_url LLM tool in handleChat.
// Kept as a standalone module so the pure HTML-strip logic is unit-testable
// without importing server.ts (which boots the HTTP server on load).

import { checkOutboundUrl } from './urlSafety.js';

export const FETCH_URL_TIMEOUT_MS = 15000;
export const FETCH_URL_MAX_BYTES = 50 * 1024; // ~12k tokens, fits all modern context windows
export const FETCH_URL_SNIPPET_LEN = 200;
export const FETCH_URL_TRUNCATION_MARKER = '\n\n...[content truncated]';
/** Raw bytes read before HTML stripping; the stripped text is then capped at FETCH_URL_MAX_BYTES. */
export const FETCH_URL_MAX_RAW_BYTES = 2 * 1024 * 1024;
export const FETCH_URL_MAX_REDIRECTS = 5;
const MAX_CODE_POINT = 0x10FFFF;
const HTTP_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export const FETCH_URL_USER_AGENT = 'NexusOrchestrator/1.0 (+https://github.com/FaqFirebase/Nexus-Orchestrator)';

export interface FetchedSource {
  title: string;
  url: string;
  snippet: string;
}

export interface FetchUrlResult {
  text: string;
  source: FetchedSource;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/** Out-of-range code points (e.g. &#99999999;) decode to '' instead of throwing RangeError. */
function codePointToString(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= MAX_CODE_POINT ? String.fromCodePoint(code) : '';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => codePointToString(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePointToString(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

// Pure HTML → plain text + title extraction. No DOM, no deps.
export function stripHtmlToText(html: string): { title: string; text: string } {
  // Extract title before stripping
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim().replace(/\s+/g, ' ') : '';

  let text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<(br|p|div|li|tr|h[1-6])[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  text = decodeEntities(text);
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return { title, text };
}

export function truncateText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  // Byte-aware truncation — JS strings are UTF-16 in memory; we approximate with UTF-8 byte length
  // by walking the string and tallying byte cost until we hit the cap.
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return { text, truncated: false };
  }
  // Binary search-ish: trim by characters until under cap
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { text: text.slice(0, lo) + FETCH_URL_TRUNCATION_MARKER, truncated: true };
}

export function validateFetchUrl(url: string): { valid: boolean; reason?: string } {
  if (!url || !url.trim()) return { valid: false, reason: 'URL is empty' };
  const check = checkOutboundUrl(url);
  return check.ok ? { valid: true } : { valid: false, reason: check.reason };
}

/** Follows redirects by hand so every hop passes the same outbound URL check as the first request. */
async function fetchWithCheckedRedirects(startUrl: string, signal: AbortSignal): Promise<Response> {
  let url = startUrl;
  for (let hop = 0; hop <= FETCH_URL_MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': FETCH_URL_USER_AGENT, 'Accept': 'text/html,text/plain,*/*' },
      redirect: 'manual',
    });
    const location = res.headers.get('location');
    if (!HTTP_REDIRECT_STATUSES.has(res.status) || !location) return res;

    await res.body?.cancel().catch(() => {}); // free the redirect hop's socket
    const next = new URL(location, url).toString();
    const check = validateFetchUrl(next);
    if (!check.valid) throw new Error(`Redirect blocked: ${check.reason}`);
    url = next;
  }
  throw new Error(`Too many redirects (more than ${FETCH_URL_MAX_REDIRECTS})`);
}

/** Reads at most maxBytes of the body, then cancels the rest of the stream. */
export async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total >= maxBytes) await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}

// Fetch a URL, strip to plain text, truncate. Returns an LLM-friendly result.
export async function fetchUrlAndStrip(rawUrl: string): Promise<FetchUrlResult> {
  const errorSource: FetchedSource = { title: '', url: rawUrl, snippet: '' };
  const check = validateFetchUrl(rawUrl);
  if (!check.valid) {
    return { text: `Fetch error: ${check.reason}`, source: { ...errorSource, snippet: check.reason || '' } };
  }
  try {
    const res = await fetchWithCheckedRedirects(rawUrl, AbortSignal.timeout(FETCH_URL_TIMEOUT_MS));

    if (!res.ok) {
      return {
        text: `Fetch failed: HTTP ${res.status} ${res.statusText}`,
        source: { ...errorSource, snippet: `HTTP ${res.status}` },
      };
    }

    const contentType = res.headers.get('content-type') || '';
    const isText = contentType.includes('text/') || contentType.includes('application/xhtml')
      || contentType.includes('application/json') || contentType === '';

    if (!isText) {
      return {
        text: `Fetch skipped: unsupported content-type "${contentType}". Only text-based pages are supported.`,
        source: { ...errorSource, title: rawUrl, snippet: `Unsupported: ${contentType}` },
      };
    }

    const body = await readTextCapped(res, FETCH_URL_MAX_RAW_BYTES);
    const { title, text } = stripHtmlToText(body);
    const { text: capped, truncated } = truncateText(text, FETCH_URL_MAX_BYTES);
    const snippet = text.slice(0, FETCH_URL_SNIPPET_LEN).replace(/\s+/g, ' ').trim();

    return {
      text: title ? `Title: ${title}\nURL: ${rawUrl}\n\n${capped}` : `URL: ${rawUrl}\n\n${capped}`,
      source: {
        title: title || rawUrl,
        url: rawUrl,
        snippet: truncated ? `${snippet} (truncated)` : snippet,
      },
    };
  } catch (err: any) {
    const reason = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : (err?.message || 'unknown error');
    return {
      text: `Fetch error: ${reason}`,
      source: { ...errorSource, snippet: reason },
    };
  }
}
