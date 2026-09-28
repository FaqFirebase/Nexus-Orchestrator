// Shared outbound-URL guard for provider URLs, the fetch_url tool, and MCP servers.
// Private LAN addresses stay allowed on purpose: Nexus is self-hosted and talks to local providers.

/** Cloud metadata / cluster endpoints that must never be reachable from a user-supplied URL. */
export const METADATA_HOSTS: ReadonlySet<string> = new Set([
  '169.254.169.254',          // AWS/GCP/Azure IMDS
  'metadata.google.internal', // GCP metadata
  'metadata.internal',        // GCP internal alias
  'kubernetes.default.svc',   // Kubernetes API server
]);

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const IPV6_LOOPBACK_HOSTS = new Set(['::1', '[::1]']);

export type OutboundUrlIssue = 'malformed' | 'scheme' | 'metadata' | 'loopback';

export type OutboundUrlCheck =
  | { ok: true; url: URL }
  | { ok: false; issue: OutboundUrlIssue; reason: string };

/** Accepts http(s) URLs that do not target cloud metadata endpoints or IPv6 loopback. */
export function checkOutboundUrl(raw: string): OutboundUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, issue: 'malformed', reason: 'Malformed URL' };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, issue: 'scheme', reason: `Invalid URL scheme "${url.protocol}" — only http and https are allowed` };
  }
  const host = url.hostname.toLowerCase();
  if (METADATA_HOSTS.has(host)) {
    return { ok: false, issue: 'metadata', reason: `Blocked host "${url.hostname}"` };
  }
  if (IPV6_LOOPBACK_HOSTS.has(host)) {
    return { ok: false, issue: 'loopback', reason: 'IPv6 loopback is not allowed' };
  }
  return { ok: true, url };
}
