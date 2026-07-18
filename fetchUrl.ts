// URL fetch + HTML-to-text helper used by the fetch_url LLM tool in handleChat.
// Kept as a standalone module so the pure HTML-strip logic is unit-testable
// without importing server.ts (which boots the HTTP server on load).

export const FETCH_URL_TIMEOUT_MS = 15000;
export const FETCH_URL_MAX_BYTES = 50 * 1024; // ~12k tokens, fits all modern context windows
export const FETCH_URL_SNIPPET_LEN = 200;
export const FETCH_URL_TRUNCATION_MARKER = '\n\n...[content truncated]';
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

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
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

// Validates URL allow-list parity with server.ts validateUrl (cloud metadata blocked,
// non-http(s) blocked, LAN allowed). Duplicated here to keep this module standalone.
const BLOCKED_HOSTS = [
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.internal',
  'kubernetes.default.svc',
];

export function validateFetchUrl(url: string): { valid: boolean; reason?: string } {
  if (!url || !url.trim()) return { valid: false, reason: 'URL is empty' };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: `Invalid URL scheme "${parsed.protocol}"` };
    }
    if (BLOCKED_HOSTS.includes(parsed.hostname)) {
      return { valid: false, reason: `Blocked host "${parsed.hostname}"` };
    }
    if (parsed.hostname === '[::1]' || parsed.hostname === '::1') {
      return { valid: false, reason: 'IPv6 loopback is not allowed' };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Malformed URL' };
  }
}

// Fetch a URL, strip to plain text, truncate. Returns an LLM-friendly result.
export async function fetchUrlAndStrip(rawUrl: string): Promise<FetchUrlResult> {
  const errorSource: FetchedSource = { title: '', url: rawUrl, snippet: '' };
  const check = validateFetchUrl(rawUrl);
  if (!check.valid) {
    return { text: `Fetch error: ${check.reason}`, source: { ...errorSource, snippet: check.reason || '' } };
  }
  try {
    const res = await fetch(rawUrl, {
      signal: AbortSignal.timeout(FETCH_URL_TIMEOUT_MS),
      headers: { 'User-Agent': FETCH_URL_USER_AGENT, 'Accept': 'text/html,text/plain,*/*' },
      redirect: 'follow',
    });

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

    const body = await res.text();
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
