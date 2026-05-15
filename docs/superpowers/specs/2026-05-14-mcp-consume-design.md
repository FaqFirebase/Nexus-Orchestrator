# MCP Support (Direction A — Consume) — Design Spec

**Date:** 2026-05-14
**Issue:** #29 (Direction A of two)
**Status:** Approved design, ready for implementation plan
**Target version:** v1.3.0 (dev branch)

---

## 1. Context

Nexus Orchestrator currently supports two LLM tools wired into a multi-turn agentic loop in `server.ts handleChat`:

- `web_search` — calls a configured SearXNG instance
- `fetch_url` — fetches and strips a URL to plain text

The Model Context Protocol (MCP) defines a JSON-RPC-over-HTTP protocol for LLMs to discover and call external tools. This spec covers **Direction A only**: Nexus connects to user-configured MCP servers and exposes their tools to the chat LLM alongside `web_search` and `fetch_url`. Direction B (Nexus exposing itself as an MCP server) is a separate spec.

## 2. Goals

- Let users configure remote MCP servers in System tab, per-user
- Inject those servers' tools into the existing tool-calling loop transparently
- Keep the production Docker image lean (≤+5 MB added)
- Match existing UX patterns: per-chat toggle via the globe icon, Sources panel for observability, online/offline indicator dots
- Fail gracefully on any class of MCP error without breaking the chat

## 3. Non-Goals

- **Stdio transport.** HTTP/SSE (Streamable HTTP) only. Stdio would require shipping every MCP server binary inside the Docker image.
- **OAuth.** Bearer token + custom headers only. OAuth can be added later if a real user demands it.
- **Nexus-as-MCP-server.** Separate spec (Direction B).
- **Per-server chat toggle.** Single globe icon stays; per-server enable is config-time only.
- **`notifications/tools/list_changed` real-time updates.** Manual refresh + 5-minute TTL.
- **MCP resources, prompts, sampling.** Only the `tools/*` subset for v1.

## 4. Design Decisions

| Decision | Choice |
|---|---|
| Transport | Streamable HTTP only (`StreamableHTTPClientTransport`) |
| SDK | Official `@modelcontextprotocol/client` (v2.x) |
| Toggle UX | Single globe icon in `ChatInput` extends to also gate MCP tools |
| Tool naming | `<serverName>__<toolName>` prefix (double underscore separator) |
| Authentication | Bearer token + optional custom headers map, per server |
| Tool list refresh | In-memory cache, 5-minute TTL, manual "Refresh" button per server |
| Health indicator | Piggybacks on tool-list cache: success ⇒ green, failure ⇒ red |
| Iteration cap | Raise `MAX_TOOL_ITERATIONS` 4 → 8 globally |
| Config scope | Per-user (matches existing `user_configs` pattern) |
| UI placement | New collapsible section in Models tab between Web Search and Intent Router |

## 5. Security Requirements (non-negotiable)

These are required for the bearer + custom headers auth model to be safe.

1. **SSRF guard on MCP server URLs** — reuse existing `validateProviderUrl()` to block cloud metadata endpoints (169.254.169.254, metadata.google.internal, metadata.internal, kubernetes.default.svc), non-http(s) schemes, and IPv6 loopback. RFC-1918 LAN addresses remain allowed.
2. **Custom header validation**
   - Header **names** match `^[A-Za-z0-9_-]+$`
   - Header **values** must be printable ASCII (32–126), no CR or LF
   - **Blocklist** for names (case-insensitive): `Host`, `Content-Length`, `Cookie`, `Origin`, `Authorization` (use the dedicated bearer field instead), `Content-Type`
3. **Encryption at rest** — Bearer token and custom header values stored inside the existing `user_configs.config_json` AES-256-GCM blob. No new tables or new crypto helpers needed.
4. **Log redaction** — Pino redact rules added in `logger.ts`:
   - `headers.authorization`
   - `headers["x-api-key"]`
   - any path matching `**.bearer`
   - request and response bodies of MCP calls are never logged
5. **HTTPS warning** — When a user saves a server with `http://` (not `https://`) AND a non-empty bearer/header AND the host is not in the "silent allowlist" (RFC-1918 ranges 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, loopback 127.0.0.0/8, `localhost`, `*.local`, `*.lan`), the UI shows an inline warning ("Credentials will be sent in cleartext"). Silent-allowlist URLs pass without warning.

## 6. Data Model

### Config (lives in `user_configs.config_json`, encrypted)

```ts
type McpServer = {
  id: string;                          // crypto.randomUUID()
  name: string;                        // ^[a-z0-9_-]{1,32}$, no '__'
  url: string;                         // http(s) only, SSRF-validated
  bearer?: string;                     // optional, encrypted at rest
  headers?: Record<string, string>;    // optional, encrypted at rest, name+value validated
  enabled: boolean;
};

// New field on the existing user config blob
config.mcpServers: McpServer[];        // max 10 entries
```

### Runtime types (`src/types.ts` + `mcpClient.ts`)

```ts
type McpToolDef = {
  name: string;            // already prefixed: '<serverName>__<toolName>'
  description: string;
  inputSchema: object;     // JSON Schema
};

type McpToolCall = {
  serverId: string;
  serverName: string;
  toolName: string;        // unprefixed
  args: unknown;
  result?: string;
  isError?: boolean;
  errorKind?: 'tool' | 'protocol' | 'auth' | 'not_found' | 'unknown';
  durationMs?: number;
};

type CachedTools = {
  tools: McpToolDef[];
  fetchedAt: number;
  healthy: boolean;
};

// Extension to existing Message type
interface Message {
  // ...existing fields
  mcpToolCalls?: McpToolCall[];
}
```

## 7. Architecture

### New module: `mcpClient.ts` (~250 lines)

Standalone, pure functions where possible. No HTTP server import, so unit-testable.

```ts
export const MCP_CACHE_TTL_MS = 5 * 60 * 1000;
export const MCP_TOOL_NAME_SEP = '__';
export const MCP_SERVER_NAME_RE = /^[a-z0-9_-]{1,32}$/;
export const MCP_HEADER_NAME_BLOCKLIST = ['host', 'content-length', 'cookie', 'origin', 'authorization', 'content-type'];
export const MCP_TOOL_TIMEOUT_MS = 30_000;
export const MCP_LIST_TIMEOUT_MS = 15_000;
export const MCP_MAX_SERVERS_PER_USER = 10;

export function validateMcpServer(s: McpServer): { ok: true } | { ok: false; reason: string };
export function prefixToolName(serverName: string, toolName: string): string;
export function unprefixToolName(prefixed: string): { serverName: string; toolName: string } | null;

export async function listMcpTools(userId: string, server: McpServer): Promise<{ tools: McpToolDef[]; healthy: boolean; errorKind?: McpErrorKind }>;
export async function callMcpTool(server: McpServer, prefixedToolName: string, args: unknown): Promise<{ content: string; isError: boolean; errorKind?: McpErrorKind; durationMs: number }>;
export function invalidateMcpCache(userId: string, serverId?: string): void;
export async function getMcpToolList(userId: string, servers: McpServer[]): Promise<McpToolDef[]>;
```

Cache is a module-scope `Map<userId, Map<serverId, CachedTools>>`. Process-local, lost on restart (matches existing router cache).

### Backend integration: `server.ts`

Three integration points:

1. **`PUT /api/config`** — after validation and encryption, call `invalidateMcpCache(userId, serverId)` for any `mcpServers[]` entry whose URL/bearer/headers/enabled changed compared to the previous saved config.

2. **`POST /api/mcp/refresh/:serverId` (new)** — invalidates cache for that server, calls `listMcpTools`, returns `{ healthy, toolCount, errorKind?, tools? }`. Rate-limited by the existing API rate limiter.

3. **`handleChat` (~line 1302 and ~line 1513)**
   - **Tool assembly**: when `searchEnabled && category !== 'FAST'`, build `toolList = [webSearchTool, fetchUrlTool, ...await getMcpToolList(userId, enabledServers)]`.
   - **Tool dispatch in agentic loop**: after checking for `web_search` and `fetch_url`, fall through to MCP detection — if `toolName` contains `__` and prefix matches an enabled server, call `callMcpTool`. Send SSE `{tool_called: {serverId, serverName, toolName, args}}` before; `{tool_result: {serverId, isError, errorKind?, durationMs}}` after. Push synthetic assistant tool message into `workingMessages`.

4. **`MAX_TOOL_ITERATIONS`** — changed from 4 to 8.

### Validation: `validation.ts`

Add Zod schema for `McpServer` and the `mcpServers: z.array(McpServerSchema).max(10).optional()` extension to the user config schema. Validation enforces name regex, URL http(s), bearer max length (4096), header name/value rules, header name blocklist, and max-10 cap.

### Crypto: `crypto.ts`

**No changes.** MCP credentials live inside the existing encrypted config blob.

### Database: `db.ts`

**No changes.** No new tables. `mcpServers[]` rides inside the existing `user_configs.config_json` field.

### Logger: `logger.ts`

Add Pino `redact` paths: `headers.authorization`, `headers["x-api-key"]`, `**.bearer`. MCP request and response bodies are never serialized into log lines (enforced by structured log fields).

### Frontend

| File | Change |
|---|---|
| `src/components/system/McpServerConfig.tsx` (new ~200 lines) | Collapsible section card with server list, add/delete/refresh, inline validation, status dot, tool count, HTTPS warning |
| `src/components/system/SystemTab.tsx` | Import and render `<McpServerConfig />` between Web Search and Intent Router sections |
| `src/components/chat/ChatInput.tsx` | Globe tooltip text update only — reflects MCP server count when configured |
| `src/components/chat/ChatMessage.tsx` (~30 lines) | Extend Sources panel to render `mcpToolCalls` chronologically. Red badge `MCP error: <name>` when any MCP call had a protocol/auth/unknown error |
| `src/hooks/useChat.ts` (~25 lines) | SSE handlers for `tool_called` and `tool_result` events, append to `message.mcpToolCalls` |
| `src/types.ts` | Add `McpServer`, `McpToolCall`, `mcpToolCalls?` on `Message` |

The McpServerConfig section uses the existing v1.1.7 localStorage collapse pattern (key: `nexus-mcp-collapsed`).

## 8. Data Flow

### Configure a server

```
User → SystemTab → McpServerConfig
  → fills name, url, bearer, headers, enabled
  → PUT /api/config (mcpServers[] in body)
    → Zod validate, encrypt secrets, db write
    → invalidateMcpCache(userId, serverId) for changed servers
  → on success, UI fires POST /api/mcp/refresh/:serverId
    → listMcpTools opens Client, initialize handshake, tools/list, caches result
    → returns { healthy, toolCount } | { healthy: false, errorKind }
  → UI updates dot color + tool count
```

### Chat with MCP enabled

```
User sends message, globe ON
  → POST /api/chat (existing SSE endpoint)
  → handleChat resolves category via router
  → if category !== 'FAST' && globeOn && mcpServers.some(enabled):
       toolList = [webSearchTool, fetchUrlTool, ...await getMcpToolList(userId, enabledServers)]
     else:
       toolList = [webSearchTool, fetchUrlTool]
  → getMcpToolList: for each enabled server, hit cache or call listMcpTools, prefix each tool name
  → POST to LLM provider with tools=toolList

Agentic loop iteration (max 8):
  → provider returns tool_calls[]
  → for each tool_call:
       if name === 'web_search'  → existing handler
       elif name === 'fetch_url' → existing handler
       elif name.includes('__'):
         { serverName, toolName } = unprefixToolName(name)
         server = enabledServers.find(s => s.name === serverName)
         if !server: synth 'not_found' error, invalidate cache, push tool result, continue
         SSE: tool_called
         result = await callMcpTool(server, toolName, args)  // 30s timeout
         SSE: tool_result
         push tool result into workingMessages
       else: synth 'unknown' error
  → on no tool_calls: stream final answer
```

### Manual refresh

```
User clicks Refresh on server row
  → POST /api/mcp/refresh/:serverId
  → invalidateMcpCache(userId, serverId)
  → listMcpTools re-fetches
  → response: { healthy, toolCount, errorKind? }
  → UI updates dot + count
```

## 9. Error Handling

### Classification

| `errorKind` | Trigger | LLM receives | User sees |
|---|---|---|---|
| `tool` | SDK `result.isError === true` | Tool result text as-is | Sources entry, no special badge |
| `protocol` | `SdkError` (timeout, ConnectionClosed), malformed response | `"Error: MCP server <name> unreachable: <safe message>"` | Red `MCP error: <name>` badge, Sources entry red border |
| `auth` | HTTP 401/403 or auth-specific SDK error | `"Error: MCP server <name> authentication failed. Check the bearer token in System tab."` | Red badge, status dot flips red, System tab shows `auth failed` label |
| `not_found` | Tool prefix matches no enabled server, or server returns "unknown tool" | `"Error: tool <prefixed name> is no longer available. The server's tool list has been refreshed."` | Sources entry red border; cache auto-invalidated |
| `unknown` | Any uncaught throw or unexpected shape | `"Error: MCP tool call failed"` | Red badge; full error logged server-side via pino at `error` level |

### Recovery rules

- Loop continues after any error; the error text is pushed as a synthetic tool result so the model can adapt.
- Iteration cap still applies — repeated failures eat iterations like any tool call.
- `auth` and `not_found` invalidate the affected server's cache immediately.
- `protocol` does NOT invalidate cache (transient network blip shouldn't throw away valid tool definitions).

### Timeouts

- `MCP_TOOL_TIMEOUT_MS = 30_000` per `tools/call`
- `MCP_LIST_TIMEOUT_MS = 15_000` per `tools/list`
- Both implemented via `AbortController` passed to the SDK; timeout produces `errorKind: 'protocol'`.

### Frontend resilience

- SSE stream drop mid-tool-call: `routingStep` clears on stream end, partial `mcpToolCalls` remain in the message.
- `POST /api/mcp/refresh` failure: existing toast pattern; dot stays in last-known state.

## 10. Testing

### Unit tests — `tests/mcpClient.test.ts` (new, ~24 tests)

Pure functions, no network:

- **`validateMcpServer`** (8): valid passes; name rejects (empty, >32 chars, uppercase, contains `__`, spaces); URL rejects (non-http(s), cloud metadata, IPv6 loopback); header rejects (CR/LF in value, blocklisted name, bad name chars).
- **Tool name prefix/unprefix** (4): round-trip; tool names containing `__` themselves split on first separator; missing separator returns null.
- **Cache behavior** (6, mocked clock): fresh entry skips re-fetch; stale triggers re-fetch; `invalidateMcpCache(userId, serverId)` is targeted; `invalidateMcpCache(userId)` is global-for-user; unhealthy cache still returned so we don't hammer a dead server; two users with same serverId are isolated.
- **Error mapping** (6): `SdkError(RequestTimeout)` → `protocol`; `SdkError(ConnectionClosed)` → `protocol`; HTTP 401 → `auth`; HTTP 403 → `auth`; `result.isError` → `tool`; uncaught throw → `unknown`.

### Unit tests — `tests/validation.test.ts` (add, ~6 tests)

`McpServer` Zod schema: accepts valid; rejects bad URL; rejects bad name; rejects blocklisted header name; rejects header value with CR/LF; rejects >10 servers.

### Integration tests — `tests/mcpClient.integration.test.ts` (new, ~5 tests)

Marked `describe.skip` by default behind `RUN_INTEGRATION_TESTS=1`. Boots an in-process MCP server (using the SDK's server bits or a JSON-RPC stub):

- Initialize handshake completes
- `tools/list` returns expected schemas
- `tools/call` round-trip with text result
- Bearer header is sent
- Tool-level error surfaces as `errorKind: 'tool'`

Default `npm test` stays fast and offline (matches `fetchUrl.test.ts` policy).

### Manual frontend smoke checklist

- Add an MCP server → dot turns green, tool count populates
- Click Refresh → cache invalidated, new list fetched
- Chat with globe ON → routing analysis shows prefixed tool names
- Sources panel shows MCP entries with correct chronological ordering
- Disabled server doesn't appear in chat tools
- FAST category skips MCP even with globe ON
- Protocol error → red badge appears
- Auth failure → dot flips red and System tab shows `auth failed`
- HTTPS warning shows for `http://` + non-RFC-1918 host

### Pre-merge regression checks

- `npm test` passes (target: existing 44 + ~30 new = ~74 tests; integration tests opt-in via `RUN_INTEGRATION_TESTS=1`)
- `npm run lint` zero TypeScript errors
- Bundle: prod runtime deps ≤8 packages (adds `@modelcontextprotocol/client`)
- Docker image: ≤+5 MB (target ~91 MB from current 86 MB)
- Manual full vision/document/web search regression — existing tool paths unchanged

## 11. Open Questions / Future Work

- **Direction B (Nexus-as-MCP-server)** — separate spec to follow this one
- **`notifications/tools/list_changed`** subscription — could replace manual refresh later
- **Per-server cost/quota tracking** — interesting once users connect paid MCP services
- **MCP resources / prompts / sampling** — only if real demand emerges

## 12. References

- MCP spec: https://modelcontextprotocol.io
- TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Existing tool-calling loop: `server.ts` lines 1162–1640 (`handleChat`)
- Existing tool integration model: `fetchUrl.ts`, `tests/fetchUrl.test.ts`
- Project memory: `nexus-orchestrator/pending_items` (Serena), `Nexus Orchestrator HTML docs system` (OpenMemory)
