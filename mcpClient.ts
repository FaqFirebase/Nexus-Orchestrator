// Model Context Protocol (MCP) client used by handleChat to expose user-configured
// remote MCP servers as tools to the chat LLM. HTTP/SSE transport only.
// Kept as a standalone module so pure helpers and cache logic are unit-testable
// without importing server.ts (which boots the HTTP server on load).

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
