// Model Context Protocol (MCP) client used by handleChat to expose user-configured
// remote MCP servers as tools to the chat LLM. HTTP/SSE transport only.
// Kept as a standalone module so pure helpers and cache logic are unit-testable
// without importing server.ts (which boots the HTTP server on load).

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import logger from './logger.js';

const log = logger.child({ module: 'mcpClient' });

export const MCP_CACHE_TTL_MS = 5 * 60 * 1000;
export const MCP_TOOL_NAME_SEP = '__';
export const MCP_SERVER_NAME_RE = /^[a-z0-9_-]{1,32}$/;
export const MCP_HEADER_NAME_BLOCKLIST: readonly string[] = [
  'host',
  'content-length',
  'cookie',
  'origin',
  'authorization',
  'content-type',
];
export const MCP_HEADER_NAME_RE = /^[A-Za-z0-9_-]+$/;
export const MCP_TOOL_TIMEOUT_MS = 30_000;
export const MCP_LIST_TIMEOUT_MS = 15_000;
export const MCP_MAX_SERVERS_PER_USER = 10;
export const MCP_BEARER_MAX_LEN = 4096;

export function prefixToolName(serverName: string, toolName: string): string {
  return `${serverName}${MCP_TOOL_NAME_SEP}${toolName}`;
}

export function unprefixToolName(prefixed: string): { serverName: string; toolName: string } | null {
  if (!prefixed) return null;
  const idx = prefixed.indexOf(MCP_TOOL_NAME_SEP);
  if (idx <= 0) return null;
  const serverName = prefixed.slice(0, idx);
  const toolName = prefixed.slice(idx + MCP_TOOL_NAME_SEP.length);
  if (!serverName || !toolName) return null;
  return { serverName, toolName };
}

export interface McpServer {
  id: string;
  name: string;
  url: string;
  bearer?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

const METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.internal',
  'kubernetes.default.svc',
]);

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateMcpServer(s: McpServer): ValidationResult {
  if (!MCP_SERVER_NAME_RE.test(s.name) || s.name.includes(MCP_TOOL_NAME_SEP)) {
    return { ok: false, reason: 'invalid_name' };
  }

  let parsed: URL;
  try {
    parsed = new URL(s.url);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'invalid_scheme' };
  }
  const host = parsed.hostname.toLowerCase();
  if (METADATA_HOSTS.has(host)) {
    return { ok: false, reason: 'metadata_endpoint_blocked' };
  }
  if (host === '::1' || host === '[::1]') {
    return { ok: false, reason: 'loopback_blocked' };
  }

  if (s.bearer != null && s.bearer.length > MCP_BEARER_MAX_LEN) {
    return { ok: false, reason: 'bearer_too_long' };
  }

  if (s.headers) {
    for (const [name, value] of Object.entries(s.headers)) {
      if (!MCP_HEADER_NAME_RE.test(name)) {
        return { ok: false, reason: `invalid_header_name:${name}` };
      }
      if (MCP_HEADER_NAME_BLOCKLIST.includes(name.toLowerCase())) {
        return { ok: false, reason: `blocked_header_name:${name}` };
      }
      if (typeof value !== 'string' || /[\r\n]/.test(value)) {
        return { ok: false, reason: `invalid_header_value:${name}` };
      }
      for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c < 32 || c > 126) return { ok: false, reason: `invalid_header_value:${name}` };
      }
    }
  }

  return { ok: true };
}

export interface McpToolDef {
  name: string;            // fully prefixed: '<serverName>__<toolName>'
  description: string;
  inputSchema: object;
}

export interface CachedTools {
  tools: McpToolDef[];
  fetchedAt: number;
  healthy: boolean;
}

// Module-scope cache. Process-local, lost on restart (matches existing router cache).
const cache = new Map<string, Map<string, CachedTools>>();

export function getCachedTools(userId: string, serverId: string): CachedTools | undefined {
  const userMap = cache.get(userId);
  if (!userMap) return undefined;
  const entry = userMap.get(serverId);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > MCP_CACHE_TTL_MS) {
    userMap.delete(serverId);
    return undefined;
  }
  return entry;
}

export function setCachedTools(userId: string, serverId: string, entry: CachedTools): void {
  let userMap = cache.get(userId);
  if (!userMap) {
    userMap = new Map();
    cache.set(userId, userMap);
  }
  userMap.set(serverId, entry);
}

export function invalidateMcpCache(userId: string, serverId?: string): void {
  if (serverId == null) {
    cache.delete(userId);
    return;
  }
  cache.get(userId)?.delete(serverId);
}

// Test-only — never call from production code paths.
export function _resetCacheForTests(): void {
  cache.clear();
}

export type McpErrorKind = 'tool' | 'protocol' | 'auth' | 'not_found' | 'unknown';

export function classifyMcpError(err: unknown): McpErrorKind {
  if (!err || typeof err !== 'object') return 'unknown';
  const e = err as { name?: string; code?: string | number; status?: number; message?: string };

  const status = e.status;
  if (status === 401 || status === 403) return 'auth';

  const code = e.code;
  if (code === 'RequestTimeout' || code === 'ConnectionClosed') return 'protocol';
  if (e.name === 'AbortError') return 'protocol';

  const msg = (e.message || '').toLowerCase();
  if (msg.includes('unknown tool') || msg.includes('tool not found') || msg.includes('method not found')) {
    return 'not_found';
  }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('socket hang up') || msg.includes('network')) {
    return 'protocol';
  }

  return 'unknown';
}

function buildHeaders(server: McpServer): Record<string, string> {
  const headers: Record<string, string> = {};
  if (server.bearer) headers['Authorization'] = `Bearer ${server.bearer}`;
  if (server.headers) {
    for (const [name, value] of Object.entries(server.headers)) {
      headers[name] = value;
    }
  }
  return headers;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          const e: any = new Error('MCP request timed out');
          e.name = 'AbortError';
          reject(e);
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface ListMcpToolsResult {
  tools: McpToolDef[];
  healthy: boolean;
  errorKind?: McpErrorKind;
}

export async function listMcpTools(userId: string, server: McpServer): Promise<ListMcpToolsResult> {
  const validation = validateMcpServer(server);
  if (!validation.ok) {
    setCachedTools(userId, server.id, { tools: [], fetchedAt: Date.now(), healthy: false });
    return { tools: [], healthy: false, errorKind: 'unknown' };
  }

  const client = new Client({ name: 'nexus-orchestrator', version: '1.3.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: buildHeaders(server) },
  });

  try {
    await withTimeout(client.connect(transport), MCP_LIST_TIMEOUT_MS);

    const collected: McpToolDef[] = [];
    let cursor: string | undefined = undefined;
    do {
      const page: any = await withTimeout(client.listTools(cursor ? { cursor } : {}), MCP_LIST_TIMEOUT_MS);
      for (const t of page.tools || []) {
        collected.push({
          name: prefixToolName(server.name, t.name),
          description: t.description ?? '',
          inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
        });
      }
      cursor = page.nextCursor;
    } while (cursor);

    setCachedTools(userId, server.id, { tools: collected, fetchedAt: Date.now(), healthy: true });
    log.info({ userId, serverId: server.id, serverName: server.name, toolCount: collected.length }, 'MCP tools listed');
    return { tools: collected, healthy: true };
  } catch (err) {
    const errorKind = classifyMcpError(err);
    setCachedTools(userId, server.id, { tools: [], fetchedAt: Date.now(), healthy: false });
    log.warn({ userId, serverId: server.id, serverName: server.name, errorKind, err: (err as Error)?.message }, 'MCP listTools failed');
    return { tools: [], healthy: false, errorKind };
  } finally {
    try { await client.close(); } catch { /* best-effort */ }
  }
}

export interface CallMcpToolResult {
  content: string;
  isError: boolean;
  errorKind?: McpErrorKind;
  durationMs: number;
}

export async function callMcpTool(
  server: McpServer,
  prefixedToolName: string,
  args: unknown
): Promise<CallMcpToolResult> {
  const started = Date.now();
  const unprefixed = unprefixToolName(prefixedToolName);
  if (!unprefixed || unprefixed.serverName !== server.name) {
    return {
      content: `Error: tool ${prefixedToolName} is not available on server ${server.name}.`,
      isError: true,
      errorKind: 'not_found',
      durationMs: Date.now() - started,
    };
  }

  const client = new Client({ name: 'nexus-orchestrator', version: '1.3.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: buildHeaders(server) },
  });

  try {
    await withTimeout(client.connect(transport), MCP_TOOL_TIMEOUT_MS);
    const result: any = await withTimeout(
      client.callTool({ name: unprefixed.toolName, arguments: (args && typeof args === 'object') ? args as Record<string, unknown> : {} }),
      MCP_TOOL_TIMEOUT_MS
    );

    const blocks = Array.isArray(result?.content) ? result.content : [];
    const text = blocks
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => String(b.text || ''))
      .join('\n');
    const content = text || (result?.structuredContent ? JSON.stringify(result.structuredContent) : '');

    if (result?.isError) {
      return { content: content || 'Tool returned an error.', isError: true, errorKind: 'tool', durationMs: Date.now() - started };
    }
    return { content, isError: false, durationMs: Date.now() - started };
  } catch (err) {
    const errorKind = classifyMcpError(err);
    const messageByKind: Record<McpErrorKind, string> = {
      auth: `Error: MCP server ${server.name} authentication failed. Check the bearer token in System tab.`,
      protocol: `Error: MCP server ${server.name} unreachable.`,
      not_found: `Error: tool ${prefixedToolName} is no longer available. The server's tool list has been refreshed.`,
      tool: 'Error: MCP tool call failed.',
      unknown: 'Error: MCP tool call failed.',
    };
    log.warn({ serverId: server.id, serverName: server.name, toolName: unprefixed.toolName, errorKind, err: (err as Error)?.message }, 'MCP callTool failed');
    return { content: messageByKind[errorKind], isError: true, errorKind, durationMs: Date.now() - started };
  } finally {
    try { await client.close(); } catch { /* best-effort */ }
  }
}

export async function getMcpToolList(userId: string, servers: McpServer[]): Promise<McpToolDef[]> {
  const enabled = servers.filter(s => s.enabled);
  if (enabled.length === 0) return [];

  const results = await Promise.all(enabled.map(async (server) => {
    const cached = getCachedTools(userId, server.id);
    if (cached) return cached.tools;
    const fresh = await listMcpTools(userId, server);
    return fresh.tools;
  }));

  return results.flat();
}
