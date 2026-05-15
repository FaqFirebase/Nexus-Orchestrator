# MCP Direction A (Consume) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Model Context Protocol (MCP) client support to Nexus Orchestrator so users can register external MCP servers and have their tools exposed to the chat LLM alongside `web_search` and `fetch_url`.

**Architecture:** New standalone module `mcpClient.ts` encapsulates SDK setup, per-user in-memory cache (5-min TTL), tool listing, tool dispatch, and error classification. `server.ts handleChat` calls `getMcpToolList()` to append MCP tools to the existing `toolList`; a fourth branch in the agentic-loop dispatch routes tool calls whose name contains `__` to `callMcpTool()`. Frontend adds a Models-tab section for per-user server config plus a Sources-panel extension showing MCP tool calls.

**Tech Stack:** TypeScript 5.8, Express 4, Vitest, React 19, Vite 6, `@modelcontextprotocol/sdk` (new SDK dependency, ~1-2 MB), Zod, Pino, AES-256-GCM (existing).

**Spec:** `docs/superpowers/specs/2026-05-14-mcp-consume-design.md` — read this first.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `package.json` | modify | Add `@modelcontextprotocol/sdk` to `dependencies` |
| `mcpClient.ts` | create | Constants, types, pure helpers, cache, list/call functions, error mapping |
| `validation.ts` | modify | Add `mcpServerSchema` and extend `configSchema` with `mcpServers` |
| `logger.ts` | modify | Add Pino redact rules |
| `server.ts` | modify | New `POST /api/mcp/refresh/:serverId` endpoint; `handleChat` tool injection + MCP dispatch + iteration cap 4→8; config save → cache invalidation |
| `tests/mcpClient.test.ts` | create | ~24 unit tests (pure helpers, cache, error mapping) |
| `tests/mcpClient.integration.test.ts` | create | ~5 opt-in integration tests (real protocol, behind env flag) |
| `tests/validation.test.ts` | modify | ~6 new tests for `mcpServerSchema` |
| `src/types.ts` | modify | Add `McpServer`, `McpToolCall`, extend `Message`, extend `NexusConfig` |
| `src/components/system/McpServerConfig.tsx` | create | Per-user MCP server list UI |
| `src/components/system/SystemTab.tsx` | modify | Render `<McpServerConfig />` between Web Search and Intent Router |
| `src/components/chat/ChatInput.tsx` | modify | Update globe tooltip to mention MCP server count |
| `src/components/chat/ChatMessage.tsx` | modify | Extend Sources panel + add `MCP error: <name>` badge |
| `src/hooks/useChat.ts` | modify | SSE handlers for `tool_called` / `tool_result` |

---

## Task 1: Install the MCP SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the runtime dependency**

Run from repo root:

```bash
npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: Verify install + lockfile updated**

Run:

```bash
node --input-type=module -e "import('@modelcontextprotocol/sdk/client/index.js').then(m => console.log(Object.keys(m)))"
```

Expected: prints an array containing at least `Client` and `StreamableHTTPClientTransport`.

Run:

```bash
git status package.json package-lock.json
```

Expected: both files marked as modified.

- [ ] **Step 3: Confirm no audit regressions**

Run:

```bash
npm audit --omit=dev
```

Expected: `found 0 vulnerabilities`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @modelcontextprotocol/sdk SDK"
```

---

## Task 2: Constants and pure tool-name helpers in `mcpClient.ts`

**Files:**
- Create: `mcpClient.ts`
- Test: `tests/mcpClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/mcpClient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MCP_CACHE_TTL_MS,
  MCP_TOOL_NAME_SEP,
  MCP_SERVER_NAME_RE,
  MCP_HEADER_NAME_BLOCKLIST,
  MCP_TOOL_TIMEOUT_MS,
  MCP_LIST_TIMEOUT_MS,
  MCP_MAX_SERVERS_PER_USER,
  prefixToolName,
  unprefixToolName,
} from '../mcpClient.js';

describe('mcpClient constants', () => {
  it('exports the expected constants', () => {
    expect(MCP_CACHE_TTL_MS).toBe(5 * 60 * 1000);
    expect(MCP_TOOL_NAME_SEP).toBe('__');
    expect(MCP_TOOL_TIMEOUT_MS).toBe(30_000);
    expect(MCP_LIST_TIMEOUT_MS).toBe(15_000);
    expect(MCP_MAX_SERVERS_PER_USER).toBe(10);
    expect(MCP_SERVER_NAME_RE.test('github')).toBe(true);
    expect(MCP_SERVER_NAME_RE.test('GitHub')).toBe(false);
    expect(MCP_HEADER_NAME_BLOCKLIST).toContain('host');
    expect(MCP_HEADER_NAME_BLOCKLIST).toContain('authorization');
  });
});

describe('prefixToolName / unprefixToolName', () => {
  it('round-trips a normal pair', () => {
    expect(prefixToolName('github', 'read_file')).toBe('github__read_file');
    expect(unprefixToolName('github__read_file')).toEqual({ serverName: 'github', toolName: 'read_file' });
  });

  it('splits on the FIRST separator only when tool name itself contains __', () => {
    expect(unprefixToolName('fs__weird__tool')).toEqual({ serverName: 'fs', toolName: 'weird__tool' });
  });

  it('returns null when no separator is present', () => {
    expect(unprefixToolName('web_search')).toBeNull();
    expect(unprefixToolName('fetch_url')).toBeNull();
  });

  it('returns null on empty / malformed input', () => {
    expect(unprefixToolName('')).toBeNull();
    expect(unprefixToolName('__missingServer')).toBeNull();
    expect(unprefixToolName('missingTool__')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/mcpClient.test.ts`

Expected: FAIL — `Cannot find module '../mcpClient.js'`.

- [ ] **Step 3: Create `mcpClient.ts` with constants + helpers**

Create `mcpClient.ts`:

```ts
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
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npx vitest run tests/mcpClient.test.ts`

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add mcpClient.ts tests/mcpClient.test.ts
git commit -m "feat(mcp): add constants and tool-name prefix helpers"
```

---

## Task 3: `validateMcpServer` — SSRF, name, header rules

**Files:**
- Modify: `mcpClient.ts`
- Modify: `tests/mcpClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/mcpClient.test.ts`:

```ts
import { validateMcpServer, McpServer } from '../mcpClient.js';

function makeServer(over: Partial<McpServer> = {}): McpServer {
  return {
    id: 'srv-1',
    name: 'good',
    url: 'https://mcp.example.com/mcp',
    enabled: true,
    ...over,
  };
}

describe('validateMcpServer', () => {
  it('accepts a valid server', () => {
    expect(validateMcpServer(makeServer())).toEqual({ ok: true });
  });

  it('rejects empty name', () => {
    expect(validateMcpServer(makeServer({ name: '' }))).toMatchObject({ ok: false });
  });

  it('rejects uppercase / overlong / separator-containing name', () => {
    expect(validateMcpServer(makeServer({ name: 'Bad' }))).toMatchObject({ ok: false });
    expect(validateMcpServer(makeServer({ name: 'a'.repeat(33) }))).toMatchObject({ ok: false });
    expect(validateMcpServer(makeServer({ name: 'has__sep' }))).toMatchObject({ ok: false });
  });

  it('rejects non-http(s) URL', () => {
    expect(validateMcpServer(makeServer({ url: 'ftp://x/y' }))).toMatchObject({ ok: false });
    expect(validateMcpServer(makeServer({ url: 'file:///etc/passwd' }))).toMatchObject({ ok: false });
  });

  it('rejects cloud metadata endpoints', () => {
    expect(validateMcpServer(makeServer({ url: 'http://169.254.169.254/latest/meta-data' }))).toMatchObject({ ok: false });
    expect(validateMcpServer(makeServer({ url: 'http://metadata.google.internal' }))).toMatchObject({ ok: false });
    expect(validateMcpServer(makeServer({ url: 'http://metadata.internal' }))).toMatchObject({ ok: false });
    expect(validateMcpServer(makeServer({ url: 'http://kubernetes.default.svc' }))).toMatchObject({ ok: false });
  });

  it('rejects IPv6 loopback', () => {
    expect(validateMcpServer(makeServer({ url: 'http://[::1]/mcp' }))).toMatchObject({ ok: false });
  });

  it('rejects blocklisted custom header names (case-insensitive)', () => {
    expect(validateMcpServer(makeServer({ headers: { Host: 'evil.example.com' } }))).toMatchObject({ ok: false });
    expect(validateMcpServer(makeServer({ headers: { cookie: 'a=b' } }))).toMatchObject({ ok: false });
    expect(validateMcpServer(makeServer({ headers: { authorization: 'Bearer x' } }))).toMatchObject({ ok: false });
  });

  it('rejects CR/LF in header values', () => {
    expect(validateMcpServer(makeServer({ headers: { 'X-Foo': 'bar\r\nInjected: yes' } }))).toMatchObject({ ok: false });
  });

  it('rejects header names with invalid chars', () => {
    expect(validateMcpServer(makeServer({ headers: { 'X Foo': 'bar' } }))).toMatchObject({ ok: false });
    expect(validateMcpServer(makeServer({ headers: { 'X:Foo': 'bar' } }))).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/mcpClient.test.ts`

Expected: FAIL — `validateMcpServer is not exported`.

- [ ] **Step 3: Implement `validateMcpServer` in `mcpClient.ts`**

Append to `mcpClient.ts` (above any future imports):

```ts
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
  // IPv6 loopback (URL strips brackets in hostname)
  if (host === '::1') {
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
      // Printable ASCII only
      for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c < 32 || c > 126) return { ok: false, reason: `invalid_header_value:${name}` };
      }
    }
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npx vitest run tests/mcpClient.test.ts`

Expected: PASS (existing 5 + 9 new = 14 tests).

- [ ] **Step 5: Commit**

```bash
git add mcpClient.ts tests/mcpClient.test.ts
git commit -m "feat(mcp): add validateMcpServer with SSRF + header guardrails"
```

---

## Task 4: Cache module in `mcpClient.ts`

**Files:**
- Modify: `mcpClient.ts`
- Modify: `tests/mcpClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/mcpClient.test.ts`:

```ts
import {
  getCachedTools,
  setCachedTools,
  invalidateMcpCache,
  _resetCacheForTests,
  McpToolDef,
} from '../mcpClient.js';

describe('mcp cache', () => {
  beforeEach(() => _resetCacheForTests());

  const tools: McpToolDef[] = [{ name: 'github__read_file', description: 'd', inputSchema: {} }];

  it('returns undefined when nothing cached', () => {
    expect(getCachedTools('u1', 's1')).toBeUndefined();
  });

  it('returns set value within TTL', () => {
    setCachedTools('u1', 's1', { tools, fetchedAt: Date.now(), healthy: true });
    const cached = getCachedTools('u1', 's1');
    expect(cached?.tools).toEqual(tools);
    expect(cached?.healthy).toBe(true);
  });

  it('returns undefined past TTL', () => {
    setCachedTools('u1', 's1', { tools, fetchedAt: Date.now() - (MCP_CACHE_TTL_MS + 1), healthy: true });
    expect(getCachedTools('u1', 's1')).toBeUndefined();
  });

  it('still returns unhealthy entries within TTL (so we do not hammer dead servers)', () => {
    setCachedTools('u1', 's1', { tools: [], fetchedAt: Date.now(), healthy: false });
    const cached = getCachedTools('u1', 's1');
    expect(cached?.healthy).toBe(false);
  });

  it('invalidateMcpCache(userId, serverId) is targeted', () => {
    setCachedTools('u1', 's1', { tools, fetchedAt: Date.now(), healthy: true });
    setCachedTools('u1', 's2', { tools, fetchedAt: Date.now(), healthy: true });
    invalidateMcpCache('u1', 's1');
    expect(getCachedTools('u1', 's1')).toBeUndefined();
    expect(getCachedTools('u1', 's2')).toBeDefined();
  });

  it('invalidateMcpCache(userId) clears all entries for that user', () => {
    setCachedTools('u1', 's1', { tools, fetchedAt: Date.now(), healthy: true });
    setCachedTools('u1', 's2', { tools, fetchedAt: Date.now(), healthy: true });
    setCachedTools('u2', 's1', { tools, fetchedAt: Date.now(), healthy: true });
    invalidateMcpCache('u1');
    expect(getCachedTools('u1', 's1')).toBeUndefined();
    expect(getCachedTools('u1', 's2')).toBeUndefined();
    expect(getCachedTools('u2', 's1')).toBeDefined();
  });

  it('isolates the same serverId between users', () => {
    setCachedTools('u1', 's1', { tools: [{ name: 'a__b', description: 'A', inputSchema: {} }], fetchedAt: Date.now(), healthy: true });
    setCachedTools('u2', 's1', { tools: [{ name: 'x__y', description: 'X', inputSchema: {} }], fetchedAt: Date.now(), healthy: true });
    expect(getCachedTools('u1', 's1')?.tools[0].name).toBe('a__b');
    expect(getCachedTools('u2', 's1')?.tools[0].name).toBe('x__y');
  });
});
```

Also add `import { beforeEach } from 'vitest';` to the top imports.

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/mcpClient.test.ts`

Expected: FAIL — `getCachedTools / setCachedTools / invalidateMcpCache / _resetCacheForTests / McpToolDef not exported`.

- [ ] **Step 3: Implement cache in `mcpClient.ts`**

Append to `mcpClient.ts`:

```ts
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
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npx vitest run tests/mcpClient.test.ts`

Expected: PASS (existing 14 + 7 new = 21 tests).

- [ ] **Step 5: Commit**

```bash
git add mcpClient.ts tests/mcpClient.test.ts
git commit -m "feat(mcp): add per-user TTL tool cache"
```

---

## Task 5: `McpErrorKind` mapping helper + tests

**Files:**
- Modify: `mcpClient.ts`
- Modify: `tests/mcpClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/mcpClient.test.ts`:

```ts
import { classifyMcpError } from '../mcpClient.js';

describe('classifyMcpError', () => {
  it('maps timeout-like AbortError to protocol', () => {
    const err: any = new Error('aborted'); err.name = 'AbortError';
    expect(classifyMcpError(err)).toBe('protocol');
  });

  it('maps SDK error with timeout code to protocol', () => {
    const err: any = new Error('timed out'); err.code = 'RequestTimeout';
    expect(classifyMcpError(err)).toBe('protocol');
  });

  it('maps SDK error with connection-closed code to protocol', () => {
    const err: any = new Error('closed'); err.code = 'ConnectionClosed';
    expect(classifyMcpError(err)).toBe('protocol');
  });

  it('maps HTTP 401 to auth', () => {
    const err: any = new Error('unauthorized'); err.status = 401;
    expect(classifyMcpError(err)).toBe('auth');
  });

  it('maps HTTP 403 to auth', () => {
    const err: any = new Error('forbidden'); err.status = 403;
    expect(classifyMcpError(err)).toBe('auth');
  });

  it('maps "unknown tool" message to not_found', () => {
    expect(classifyMcpError(new Error('Method not found: unknown tool xyz'))).toBe('not_found');
  });

  it('falls back to unknown for unrecognized errors', () => {
    expect(classifyMcpError(new Error('something exploded'))).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/mcpClient.test.ts`

Expected: FAIL — `classifyMcpError not exported`.

- [ ] **Step 3: Implement `classifyMcpError`**

Append to `mcpClient.ts`:

```ts
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
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npx vitest run tests/mcpClient.test.ts`

Expected: PASS (existing 21 + 7 new = 28 tests).

- [ ] **Step 5: Commit**

```bash
git add mcpClient.ts tests/mcpClient.test.ts
git commit -m "feat(mcp): classify SDK errors into auth/protocol/not_found/unknown"
```

---

## Task 6: `listMcpTools` and `callMcpTool` (real SDK plumbing, no tests yet)

**Files:**
- Modify: `mcpClient.ts`

> Note: This task wires the SDK. Unit tests against a mocked SDK Client are fragile (the SDK's API shape can shift). Integration tests against a real MCP server cover this in Task 17. We accept a one-task gap in TDD here because the alternative — mocking deeply into the SDK — produces tests that lie about real behaviour.

- [ ] **Step 1: Add SDK imports + `buildHeaders` helper**

Insert at the top of `mcpClient.ts` (above the existing constants):

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import logger from './logger.js';

const log = logger.child({ module: 'mcpClient' });
```

Append:

```ts
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
```

- [ ] **Step 2: Implement `listMcpTools`**

Append:

```ts
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
```

- [ ] **Step 3: Implement `callMcpTool`**

Append:

```ts
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

    // Extract text from content blocks
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
    const messageByKind = {
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
```

- [ ] **Step 4: Implement `getMcpToolList`**

Append:

```ts
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
```

- [ ] **Step 5: Run lint to catch type errors**

Run: `npx tsc --noEmit`

Expected: zero errors. The stable `@modelcontextprotocol/sdk` package exposes `Client` and `StreamableHTTPClientTransport` via subpaths (`@modelcontextprotocol/sdk/client/index.js` and `@modelcontextprotocol/sdk/client/streamableHttp.js`) — confirmed in this repo's installed v1.29.0. If a future version reorganises exports, check `node_modules/@modelcontextprotocol/sdk/dist/esm/client/` for the actual layout.

- [ ] **Step 6: Run the existing unit tests to confirm nothing regressed**

Run: `npx vitest run`

Expected: all 28 mcpClient unit tests still pass (we didn't touch them).

- [ ] **Step 7: Commit**

```bash
git add mcpClient.ts
git commit -m "feat(mcp): wire listMcpTools/callMcpTool to the SDK"
```

---

## Task 7: Zod schema in `validation.ts` + tests

**Files:**
- Modify: `validation.ts`
- Modify: `tests/validation.test.ts`

- [ ] **Step 1: Write failing tests in `tests/validation.test.ts`**

Append a new `describe` block at the end:

```ts
import { configSchema, mcpServerSchema } from '../validation.js';

describe('mcpServerSchema', () => {
  const valid = { id: 'a', name: 'github', url: 'https://example.com/mcp', enabled: true };

  it('accepts a minimal valid server', () => {
    expect(mcpServerSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects bad name (uppercase)', () => {
    expect(mcpServerSchema.safeParse({ ...valid, name: 'GitHub' }).success).toBe(false);
  });

  it('rejects name with separator', () => {
    expect(mcpServerSchema.safeParse({ ...valid, name: 'has__sep' }).success).toBe(false);
  });

  it('rejects non-http(s) URL', () => {
    expect(mcpServerSchema.safeParse({ ...valid, url: 'ftp://x' }).success).toBe(false);
  });

  it('accepts optional bearer and headers', () => {
    expect(mcpServerSchema.safeParse({ ...valid, bearer: 'abc123', headers: { 'X-Foo': 'bar' } }).success).toBe(true);
  });

  it('rejects more than 10 servers in configSchema', () => {
    const servers = Array.from({ length: 11 }, (_, i) => ({ ...valid, id: `s${i}`, name: `srv-${i}` }));
    const result = configSchema.safeParse({ mcpServers: servers });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/validation.test.ts`

Expected: FAIL — `mcpServerSchema is not exported`.

- [ ] **Step 3: Add schema in `validation.ts`**

Append above `export const configSchema = ...`:

```ts
const mcpHeaderNameRe = /^[A-Za-z0-9_-]+$/;
const mcpHeaderBlocklist = new Set(['host', 'content-length', 'cookie', 'origin', 'authorization', 'content-type']);

const mcpHeadersSchema = z.record(
  z.string().regex(mcpHeaderNameRe, 'Invalid header name').refine(
    (n) => !mcpHeaderBlocklist.has(n.toLowerCase()),
    { message: 'Header name is reserved' }
  ),
  z.string()
    .max(4096)
    .regex(/^[\x20-\x7e]*$/, 'Header value must be printable ASCII')
);

export const mcpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().regex(/^[a-z0-9_-]{1,32}$/, 'Name must be lowercase a-z, 0-9, _, -').refine(
    (n) => !n.includes('__'),
    { message: "Name cannot contain '__'" }
  ),
  url: z.string().url().refine(
    (u) => /^https?:\/\//i.test(u),
    { message: 'URL must use http or https' }
  ),
  bearer: z.string().max(4096).optional(),
  headers: mcpHeadersSchema.optional(),
  enabled: z.boolean(),
});
```

Modify the `configSchema` literal to add the new field. Replace the existing closing `});` of `configSchema` with:

```ts
  mcpServers: z.array(mcpServerSchema).max(10).optional(),
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/validation.test.ts`

Expected: PASS (existing tests + 6 new).

- [ ] **Step 5: Commit**

```bash
git add validation.ts tests/validation.test.ts
git commit -m "feat(mcp): Zod schema for McpServer and configSchema extension"
```

---

## Task 8: Logger redact rules

**Files:**
- Modify: `logger.ts`

- [ ] **Step 1: Update `logger.ts` with redact paths**

Replace the contents of `logger.ts` with:

```ts
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  redact: {
    paths: [
      'headers.authorization',
      'headers["x-api-key"]',
      'req.headers.authorization',
      '*.bearer',
      '*.*.bearer',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'nexus-orchestrator' },
});

export default logger;
```

- [ ] **Step 2: Quick smoke**

Run from repo root:

```bash
node -e "import('./logger.ts').then(m => m.default.info({ headers: { authorization: 'Bearer secret123' }, bearer: 'inner' }, 'smoke'))" 2>&1 | head -5
```

Expected: log line shows `[REDACTED]` in place of `Bearer secret123` and `inner`. (If `tsx` is required for this to run, prefix with `npx tsx --eval` or run `npm run dev` briefly and trigger any log.)

- [ ] **Step 3: Commit**

```bash
git add logger.ts
git commit -m "feat(mcp): redact bearer/authorization paths in pino logs"
```

---

## Task 9: `POST /api/mcp/refresh/:serverId` endpoint

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Add imports near the top of `server.ts`**

Find the existing imports block and add:

```ts
import { listMcpTools, invalidateMcpCache, McpServer } from "./mcpClient.js";
```

- [ ] **Step 2: Add the endpoint above the chat endpoint**

Find the line `app.post("/api/chat", authMiddleware, ...)` (around line 1138). Add immediately ABOVE it:

```ts
app.post("/api/mcp/refresh/:serverId", authMiddleware, apiLimiter, async (req, res) => {
  try {
    const userId = req.userId!;
    const serverId = req.params.serverId;
    const config = getUserConfig(userId);
    const servers: McpServer[] = (config as any).mcpServers || [];
    const server = servers.find(s => s.id === serverId);
    if (!server) {
      return res.status(404).json({ error: 'MCP server not found' });
    }
    invalidateMcpCache(userId, serverId);
    const result = await listMcpTools(userId, server);
    res.json({
      healthy: result.healthy,
      toolCount: result.tools.length,
      errorKind: result.errorKind,
    });
  } catch (error: any) {
    log.error({ err: error }, 'MCP refresh failed');
    res.status(500).json({ error: 'Failed to refresh MCP server' });
  }
});
```

`getUserConfig(userId)` is the existing helper at `server.ts:297` that wraps `readUserConfig` with migration; use it directly.

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 4: Smoke (manual, optional)**

Run: `npm run dev` and hit `POST /api/mcp/refresh/nonexistent` with a valid session cookie:

```bash
curl -s -X POST -b "nexus_session=YOUR_SESSION" http://localhost:3000/api/mcp/refresh/nonexistent
```

Expected: `{"error":"MCP server not found"}` with status 404.

Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat(mcp): POST /api/mcp/refresh/:serverId endpoint"
```

---

## Task 10: Config-save cache invalidation hook

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Locate the write site**

In `server.ts` find this line (around line 790):

```ts
writeUserConfig(req.userId!, newConfig, ENCRYPTION_SECRET);
```

The handler reads `currentConfig` (line 750) and the validated body lives in `newConfig`. We insert invalidation immediately above the `writeUserConfig` call.

- [ ] **Step 2: Before persisting, invalidate cache for changed/removed MCP servers**

Insert immediately ABOVE `writeUserConfig(req.userId!, newConfig, ENCRYPTION_SECRET);`:

```ts
// Invalidate MCP cache for any server whose connection-relevant fields changed
const prevServers: McpServer[] = (currentConfig as any).mcpServers || [];
const nextServers: McpServer[] = (newConfig as any).mcpServers || [];
const prevById = new Map(prevServers.map(s => [s.id, s]));
const nextById = new Map(nextServers.map(s => [s.id, s]));
for (const id of prevById.keys()) {
  if (!nextById.has(id)) invalidateMcpCache(req.userId!, id);
}
for (const [id, s] of nextById) {
  const prev = prevById.get(id);
  if (!prev) { invalidateMcpCache(req.userId!, id); continue; }
  const sameUrl = prev.url === s.url;
  const sameBearer = (prev.bearer || '') === (s.bearer || '');
  const sameEnabled = prev.enabled === s.enabled;
  const sameName = prev.name === s.name;
  const sameHeaders = JSON.stringify(prev.headers || {}) === JSON.stringify(s.headers || {});
  if (!sameUrl || !sameBearer || !sameEnabled || !sameName || !sameHeaders) {
    invalidateMcpCache(req.userId!, id);
  }
}
```

- [ ] **Step 3: Run type-check + tests**

Run: `npx tsc --noEmit && npx vitest run`

Expected: zero TS errors, all unit tests still pass.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat(mcp): invalidate cache on config change"
```

---

## Task 11: Tool list injection in `handleChat` + iteration cap 4→8

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Add imports**

Add to the top imports block (if not already added in Task 9):

```ts
import { getMcpToolList } from "./mcpClient.js";
```

- [ ] **Step 2: Bump `MAX_TOOL_ITERATIONS`**

In `handleChat`, find the line:

```ts
const MAX_TOOL_ITERATIONS = 4;
```

(around line 1303) and change to:

```ts
const MAX_TOOL_ITERATIONS = 8;
```

- [ ] **Step 3: Build the MCP tool list near `toolList` assembly**

Find:

```ts
const toolList = [webSearchTool, fetchUrlTool];
```

Replace with:

```ts
// `config` is already in scope at this point in handleChat (see server.ts:1165:
//   const config = getUserConfig(req.userId!);
// ). If it's not in scope at the insertion site, add: const userConfig = getUserConfig(req.userId!);
const mcpServers: McpServer[] = (config as any).mcpServers || [];
const mcpAllowed = decision.category !== 'FAST' && searchEnabled && mcpServers.some(s => s.enabled);
const mcpToolDefs = mcpAllowed ? await getMcpToolList(req.userId!, mcpServers) : [];
const mcpToolList = mcpToolDefs.map(t => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: (t.inputSchema && Object.keys(t.inputSchema).length > 0)
      ? t.inputSchema
      : { type: 'object', properties: {} },
  },
}));
const toolList = [webSearchTool, fetchUrlTool, ...mcpToolList];
```

The `mcpServers` const declared here is reused in Task 12's dispatch — keep its name stable.

- [ ] **Step 4: Run type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 5: Run tests**

Run: `npx vitest run`

Expected: 28 mcpClient + 6 validation + existing 38 = 72 passing.

- [ ] **Step 6: Commit**

```bash
git add server.ts
git commit -m "feat(mcp): inject MCP tools into chat toolList and raise iteration cap to 8"
```

---

## Task 12: MCP tool dispatch in the agentic loop + SSE events

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Add imports**

Append the existing import line from `./mcpClient.js`:

```ts
import { callMcpTool, unprefixToolName } from "./mcpClient.js";
```

(merge into the line added in Task 9 / 11 so there's one combined import).

- [ ] **Step 2: Add MCP branch to the tool-call dispatch**

Find the existing dispatch (around line 1545 in the agentic loop):

```ts
if (name === 'web_search') {
  // ...
} else if (name === 'fetch_url') {
  // ...
} else {
  toolText = `Unknown tool: ${name}`;
  log.warn({ name, userId: req.userId }, 'Unknown tool call requested');
}
```

Replace the trailing `else` with:

```ts
} else if (name && name.includes('__')) {
  const unprefixed = unprefixToolName(name);
  const server = unprefixed ? mcpServers.find(s => s.enabled && s.name === unprefixed.serverName) : null;
  if (!server || !unprefixed) {
    toolText = `Error: tool ${name} is no longer available.`;
    invalidateMcpCache(req.userId!);
    log.warn({ name, userId: req.userId }, 'MCP tool not found');
  } else {
    log.info({ serverId: server.id, serverName: server.name, toolName: unprefixed.toolName, userId: req.userId, iteration }, 'MCP tool call');
    res.write(JSON.stringify({ tool_called: { serverId: server.id, serverName: server.name, toolName: unprefixed.toolName, args } }) + '\n');
    const result = await callMcpTool(server, name, args);
    toolText = result.content;
    res.write(JSON.stringify({ tool_result: { serverId: server.id, isError: result.isError, errorKind: result.errorKind, durationMs: result.durationMs } }) + '\n');
    if (result.errorKind === 'auth' || result.errorKind === 'not_found') {
      invalidateMcpCache(req.userId!, server.id);
    }
  }
} else {
  toolText = `Unknown tool: ${name}`;
  log.warn({ name, userId: req.userId }, 'Unknown tool call requested');
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat(mcp): dispatch MCP tool calls in agentic loop with SSE events"
```

---

## Task 13: Frontend types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `McpServer`, `McpToolCall` and extend `Message` + `NexusConfig`**

Append after the existing `SearchSource` interface:

```ts
export interface McpServer {
  id: string;
  name: string;
  url: string;
  bearer?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export type McpErrorKind = 'tool' | 'protocol' | 'auth' | 'not_found' | 'unknown';

export interface McpToolCall {
  serverId: string;
  serverName: string;
  toolName: string;
  args?: unknown;
  isError?: boolean;
  errorKind?: McpErrorKind;
  durationMs?: number;
}
```

In the existing `interface Message` block, add right after `webFetchHost?: string;`:

```ts
  mcpToolCalls?: McpToolCall[];
```

In the existing `interface NexusConfig` block, add after the `searxng?: { ... }` field:

```ts
  mcpServers?: McpServer[];
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors. If frontend code references `Message` and `webFetchUrl`-like fields elsewhere, no rename happened so existing references remain valid.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(mcp): frontend types for McpServer, McpToolCall, Message extension"
```

---

## Task 14: `McpServerConfig` component skeleton (list + add + delete)

**Files:**
- Create: `src/components/system/McpServerConfig.tsx`

- [ ] **Step 1: Create the component file**

Create `src/components/system/McpServerConfig.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { Server, Plus, Trash2, RefreshCcw, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { McpServer } from '../../types';

const COLLAPSE_KEY = 'nexus-mcp-collapsed';

interface McpServerConfigProps {
  servers: McpServer[];
  onChange: (servers: McpServer[]) => void;
}

interface ServerStatus {
  healthy?: boolean;
  toolCount?: number;
  errorKind?: string;
  refreshing?: boolean;
}

function isLanHost(host: string): boolean {
  if (host === 'localhost') return true;
  if (host.endsWith('.local') || host.endsWith('.lan')) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const m = host.match(/^172\.(\d+)\./);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

function shouldWarnCleartext(url: string, hasCreds: boolean): boolean {
  if (!hasCreds || !url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:') return false;
    return !isLanHost(u.hostname);
  } catch {
    return false;
  }
}

export function McpServerConfig({ servers, onChange }: McpServerConfigProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({});

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  function updateServer(id: string, patch: Partial<McpServer>) {
    onChange(servers.map(s => s.id === id ? { ...s, ...patch } : s));
  }

  function addServer() {
    const id = (crypto as any).randomUUID?.() ?? `srv-${Date.now()}`;
    onChange([...servers, { id, name: '', url: '', enabled: true }]);
  }

  function removeServer(id: string) {
    onChange(servers.filter(s => s.id !== id));
  }

  async function refreshServer(id: string) {
    setStatuses(prev => ({ ...prev, [id]: { ...prev[id], refreshing: true } }));
    try {
      const res = await fetch(`/api/mcp/refresh/${encodeURIComponent(id)}`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      setStatuses(prev => ({
        ...prev,
        [id]: { healthy: data.healthy, toolCount: data.toolCount, errorKind: data.errorKind, refreshing: false },
      }));
    } catch {
      setStatuses(prev => ({ ...prev, [id]: { healthy: false, refreshing: false } }));
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <button
        className="w-full flex items-center justify-between text-left mb-2"
        onClick={() => setCollapsed(c => !c)}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <Server className="w-4 h-4" />
          MCP Servers ({servers.length})
        </span>
        {collapsed ? <ChevronRight className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
      </button>

      {!collapsed && (
        <div className="space-y-3 mt-3">
          {servers.length === 0 && (
            <p className="text-xs text-zinc-500">No MCP servers configured. Click "Add MCP Server" to connect one.</p>
          )}

          {servers.map(s => {
            const status = statuses[s.id] || {};
            const dotColor = status.healthy === true ? 'bg-emerald-500'
              : status.healthy === false ? 'bg-red-500'
              : 'bg-zinc-600';
            const hasCreds = !!(s.bearer || (s.headers && Object.keys(s.headers).length > 0));
            const warnCleartext = shouldWarnCleartext(s.url, hasCreds);

            return (
              <div key={s.id} className="bg-zinc-950 border border-zinc-800 rounded p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${dotColor}`} title={status.errorKind || (status.healthy ? 'healthy' : 'unknown')} />
                  <input
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs"
                    placeholder="server-name (lowercase, a-z 0-9 _ -)"
                    value={s.name}
                    onChange={e => updateServer(s.id, { name: e.target.value })}
                  />
                  <label className="flex items-center gap-1 text-xs text-zinc-400">
                    <input type="checkbox" checked={s.enabled} onChange={e => updateServer(s.id, { enabled: e.target.checked })} />
                    enabled
                  </label>
                  <button onClick={() => refreshServer(s.id)} className="text-zinc-400 hover:text-zinc-200" disabled={!!status.refreshing} title="Refresh tools">
                    <RefreshCcw className={`w-3.5 h-3.5 ${status.refreshing ? 'animate-spin' : ''}`} />
                  </button>
                  <button onClick={() => removeServer(s.id)} className="text-zinc-400 hover:text-red-400" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs"
                  placeholder="https://your-mcp-server/mcp"
                  value={s.url}
                  onChange={e => updateServer(s.id, { url: e.target.value })}
                />
                <input
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs"
                  type="password"
                  placeholder="Bearer token (optional)"
                  value={s.bearer ?? ''}
                  onChange={e => updateServer(s.id, { bearer: e.target.value })}
                />
                {warnCleartext && (
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
                    <AlertTriangle className="w-3 h-3" />
                    Credentials will be sent in cleartext over http. Use https or a LAN host.
                  </div>
                )}
                {typeof status.toolCount === 'number' && (
                  <div className="text-[10px] text-zinc-500">{status.toolCount} tool{status.toolCount === 1 ? '' : 's'} discovered</div>
                )}
                {status.errorKind && status.healthy === false && (
                  <div className="text-[10px] text-red-400">Error: {status.errorKind}</div>
                )}
              </div>
            );
          })}

          <button
            onClick={addServer}
            className="w-full flex items-center justify-center gap-1 py-2 text-xs border border-dashed border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
          >
            <Plus className="w-3 h-3" /> Add MCP Server
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/system/McpServerConfig.tsx
git commit -m "feat(mcp): MCP server config UI component"
```

---

## Task 15: Wire `McpServerConfig` into `SystemTab`

**Files:**
- Modify: `src/components/system/SystemTab.tsx`

- [ ] **Step 1: Find the section ordering**

Open `src/components/system/SystemTab.tsx`. Locate the JSX where the Web Search section is rendered (likely a component or block containing "Web Search" or "SearXNG"). Locate where the Intent Router section is rendered.

- [ ] **Step 2: Import the new component + add render**

Add the import:

```tsx
import { McpServerConfig } from './McpServerConfig';
```

Between Web Search and Intent Router sections, add:

```tsx
<McpServerConfig
  servers={config.mcpServers || []}
  onChange={(mcpServers) => setConfig({ ...config, mcpServers })}
/>
```

> Substitute `config` and `setConfig` with the actual prop / state names used in the surrounding code. If the component already destructures specific props, follow the existing pattern.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/system/SystemTab.tsx
git commit -m "feat(mcp): render MCP server config in System tab"
```

---

## Task 16: Update globe tooltip in `ChatInput`

**Files:**
- Modify: `src/components/chat/ChatInput.tsx`

- [ ] **Step 1: Find the globe button tooltip**

Search `ChatInput.tsx` for `Globe` or the existing tooltip text (likely something like `"Web search"` or `"Toggle web search"`).

- [ ] **Step 2: Replace the static tooltip with a dynamic one**

Wherever the tooltip is set (likely a `title=` attribute or a tooltip component prop), compute it from props or context. If the component receives `config` or has access to `mcpServers`:

```tsx
const enabledMcpCount = (config.mcpServers || []).filter(s => s.enabled).length;
const globeTooltip = enabledMcpCount > 0
  ? `Web search + URL fetch + ${enabledMcpCount} MCP server${enabledMcpCount === 1 ? '' : 's'}`
  : 'Web search + URL fetch';
```

Then use `globeTooltip` in the JSX:

```tsx
<button title={globeTooltip} ...>...</button>
```

> If the component does NOT receive `config`, skip this task or thread `config` through from the parent. Look at how `webSearchEnabled` reaches the component — pipe `mcpServers.filter(s=>s.enabled).length` through the same channel.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatInput.tsx
git commit -m "feat(mcp): include MCP server count in globe tooltip"
```

---

## Task 17: SSE handlers in `useChat`

**Files:**
- Modify: `src/hooks/useChat.ts`

- [ ] **Step 1: Find existing JSON SSE parse loop**

Search `useChat.ts` for `json.fetching` (added in v1.2.0). The new handlers go alongside it.

- [ ] **Step 2: Add `tool_called` and `tool_result` handlers**

Insert near the other event handlers (before `if (json.message)` or wherever it makes sense in the parser):

```ts
if (json.tool_called) {
  const tc = json.tool_called as { serverId: string; serverName: string; toolName: string; args?: unknown };
  setRoutingStep('searching');
  setMessages(msgs => msgs.map(m => {
    if (m.id !== assistantMsg.id) return m;
    const calls = m.mcpToolCalls || [];
    return { ...m, mcpToolCalls: [...calls, { serverId: tc.serverId, serverName: tc.serverName, toolName: tc.toolName, args: tc.args }] };
  }));
  continue;
}

if (json.tool_result) {
  const tr = json.tool_result as { serverId: string; isError: boolean; errorKind?: string; durationMs?: number };
  setMessages(msgs => msgs.map(m => {
    if (m.id !== assistantMsg.id) return m;
    const calls = m.mcpToolCalls || [];
    if (calls.length === 0) return m;
    // Find the most recent call for this server with no result yet
    const idx = [...calls].reverse().findIndex(c => c.serverId === tr.serverId && c.isError === undefined);
    if (idx < 0) return m;
    const realIdx = calls.length - 1 - idx;
    const updated = [...calls];
    updated[realIdx] = { ...updated[realIdx], isError: tr.isError, errorKind: tr.errorKind as any, durationMs: tr.durationMs };
    return { ...m, mcpToolCalls: updated };
  }));
  continue;
}
```

> If `assistantMsg.id` is named differently in the local scope (e.g. `assistantId`), substitute. Patterns mirror the existing `json.fetching` handler.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useChat.ts
git commit -m "feat(mcp): handle tool_called/tool_result SSE events in useChat"
```

---

## Task 18: Extend Sources panel + add MCP error badge in `ChatMessage`

**Files:**
- Modify: `src/components/chat/ChatMessage.tsx`

- [ ] **Step 1: Add error badge near `webSearchQuery` / `webFetchUrl` badges**

Find the existing badge block (Task notes from v1.2.0 added the `Fetched: <host>` badge). Add immediately after the `webFetchUrl` badge:

```tsx
{msg.mcpToolCalls?.some(c => c.errorKind === 'protocol' || c.errorKind === 'auth' || c.errorKind === 'unknown') && (
  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-[9px] font-bold text-red-400 uppercase tracking-wider">
    MCP error: {msg.mcpToolCalls?.find(c => c.errorKind === 'protocol' || c.errorKind === 'auth' || c.errorKind === 'unknown')?.serverName}
  </div>
)}
```

- [ ] **Step 2: Extend the Sources panel render**

Locate the Sources panel block (likely conditional on `msg.webSearchSources?.length`). Replace the condition with one that also fires for MCP calls:

```tsx
{(msg.webSearchSources?.length || msg.mcpToolCalls?.length) ? (
  <details className="mt-3 group">
    <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
      Sources ({(msg.webSearchSources?.length || 0) + (msg.mcpToolCalls?.length || 0)})
    </summary>
    <div className="mt-2 space-y-2">
      {msg.webSearchSources?.map((src, i) => (
        <div key={`s-${i}`} className="text-xs bg-zinc-950 border border-zinc-800 rounded p-2">
          <a href={src.url} target="_blank" rel="noopener" className="text-blue-400 hover:underline font-medium">{src.title}</a>
          <div className="text-zinc-500 text-[10px] mt-0.5">{src.url}</div>
          {src.snippet && <div className="text-zinc-400 mt-1">{src.snippet}</div>}
        </div>
      ))}
      {msg.mcpToolCalls?.map((tc, i) => {
        const errorBorder = tc.isError || tc.errorKind ? 'border-red-500/40' : 'border-zinc-800';
        return (
          <div key={`m-${i}`} className={`text-xs bg-zinc-950 border ${errorBorder} rounded p-2`}>
            <div className="font-medium text-zinc-200">[{tc.serverName}] {tc.toolName}</div>
            {tc.args && Object.keys(tc.args as object).length > 0 && (
              <pre className="text-[10px] text-zinc-500 mt-1 overflow-x-auto">{JSON.stringify(tc.args, null, 2)}</pre>
            )}
            {tc.errorKind && <div className="text-[10px] text-red-400 mt-1">Error: {tc.errorKind}</div>}
            {typeof tc.durationMs === 'number' && <div className="text-[10px] text-zinc-600 mt-0.5">{tc.durationMs} ms</div>}
          </div>
        );
      })}
    </div>
  </details>
) : null}
```

> Replace the existing Sources panel block in its entirety with the above. The visual styling (`bg-zinc-950`, etc.) should match adjacent message styling; adjust class names if your local file uses different design tokens.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatMessage.tsx
git commit -m "feat(mcp): Sources panel renders MCP tool calls and error badge"
```

---

## Task 19: Integration tests (opt-in)

**Files:**
- Create: `tests/mcpClient.integration.test.ts`

These tests run against a real in-process MCP server using the SDK's server bits. They are opt-in to keep `npm test` fast and offline.

- [ ] **Step 1: Create the integration test file**

Create `tests/mcpClient.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { listMcpTools, callMcpTool, _resetCacheForTests, McpServer } from '../mcpClient.js';

const RUN = process.env.RUN_INTEGRATION_TESTS === '1';
const d = RUN ? describe : describe.skip;

// Tiny test server. Uses the SDK's server pieces if available; else a manual stub.
// We mount on a random port and let StreamableHTTPClientTransport speak to it.
let serverUrl = '';
let stopServer: (() => Promise<void>) | null = null;

beforeAll(async () => {
  if (!RUN) return;
  // Lazy import to avoid loading server bits when integration tests are skipped.
  const { McpServer: SdkServer, StreamableHTTPServerTransport } = await import('@modelcontextprotocol/server' as any);
  const http = await import('http');

  const sdkServer = new SdkServer({ name: 'test-server', version: '0.0.1' });
  sdkServer.tool('echo', 'Echo the input', { type: 'object', properties: { msg: { type: 'string' } } }, async (args: any) => ({
    content: [{ type: 'text', text: `echo:${args.msg}` }],
  }));
  sdkServer.tool('fail', 'Always returns error', { type: 'object', properties: {} }, async () => ({
    content: [{ type: 'text', text: 'something broke' }],
    isError: true,
  }));

  const transport = new StreamableHTTPServerTransport({});
  await sdkServer.connect(transport);

  const httpServer = http.createServer(async (req, res) => {
    // Optional bearer check
    if (req.headers.authorization !== 'Bearer testkey') {
      res.statusCode = 401; res.end('unauth'); return;
    }
    await transport.handleRequest(req, res);
  });

  await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 3001;
  serverUrl = `http://127.0.0.1:${port}/mcp`;

  stopServer = async () => {
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  };
});

afterAll(async () => {
  if (stopServer) await stopServer();
});

const server = (): McpServer => ({
  id: 'int-1', name: 'test', url: serverUrl, bearer: 'testkey', enabled: true,
});

d('MCP integration (RUN_INTEGRATION_TESTS=1)', () => {
  it('lists tools', async () => {
    _resetCacheForTests();
    const r = await listMcpTools('u-int', server());
    expect(r.healthy).toBe(true);
    expect(r.tools.map(t => t.name).sort()).toEqual(['test__echo', 'test__fail']);
  });

  it('calls a tool and returns text', async () => {
    const r = await callMcpTool(server(), 'test__echo', { msg: 'hi' });
    expect(r.isError).toBe(false);
    expect(r.content).toBe('echo:hi');
  });

  it('surfaces tool-level errors as errorKind: tool', async () => {
    const r = await callMcpTool(server(), 'test__fail', {});
    expect(r.isError).toBe(true);
    expect(r.errorKind).toBe('tool');
  });

  it('rejects bad bearer with auth errorKind', async () => {
    const bad: McpServer = { ...server(), bearer: 'wrong' };
    const r = await listMcpTools('u-int', bad);
    expect(r.healthy).toBe(false);
    expect(r.errorKind).toBe('auth');
  });

  it('rejects unreachable host with protocol errorKind', async () => {
    const dead: McpServer = { ...server(), url: 'http://127.0.0.1:1/mcp' };
    const r = await listMcpTools('u-int', dead);
    expect(r.healthy).toBe(false);
    expect(r.errorKind).toBe('protocol');
  });
});
```

> The exact path `@modelcontextprotocol/server` may differ depending on how the SDK splits server bits. If `npm install @modelcontextprotocol/server` is required to run these tests, document that — but do NOT add `@modelcontextprotocol/server` to dependencies (it would bloat the production image). Add it to `devDependencies` only.

- [ ] **Step 2: Install server SDK as devDependency (only if needed for these tests)**

Run:

```bash
npm install --save-dev @modelcontextprotocol/server
```

If the import path above doesn't resolve, check actual exports in `node_modules/@modelcontextprotocol/server/dist/index.d.ts` and adjust the dynamic import.

- [ ] **Step 3: Verify default test run still skips integration**

Run: `npx vitest run`

Expected: integration `describe` is skipped (no errors, just `5 skipped`).

- [ ] **Step 4: Verify opt-in run actually executes**

Run: `RUN_INTEGRATION_TESTS=1 npx vitest run tests/mcpClient.integration.test.ts`

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/mcpClient.integration.test.ts package.json package-lock.json
git commit -m "test(mcp): opt-in integration tests against real protocol"
```

---

## Task 20: Final verification — type-check, full test, lint, dev smoke

**Files:** none modified — verification only.

- [ ] **Step 1: Full type-check**

Run: `npm run lint`

Expected: zero TypeScript errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`

Expected: existing 44 + ~30 new = ~74 tests pass. Integration tests are skipped (`RUN_INTEGRATION_TESTS=1` not set).

- [ ] **Step 3: Bundle size + audit**

Run:

```bash
ls -la node_modules/@modelcontextprotocol/sdk | head -5
npm audit --omit=dev
```

Expected: 0 vulnerabilities; SDK package size visible.

- [ ] **Step 4: Manual smoke checklist (one pass via `npm run dev`)**

Start dev server: `npm run dev`. In the browser:

- Log in. Go to System tab. Click "Add MCP Server" — a new card appears.
- Enter `name=test`, `url=https://example.com/mcp`, `enabled=on`, save config. Click Refresh. The dot turns red (example.com is not an MCP server) and `errorKind: protocol` shows.
- Now use a real MCP server (e.g. `npx -y @modelcontextprotocol/server-everything` exposed over HTTP via a tiny proxy, or any test server you have access to). Save and click Refresh. Dot turns green; tool count populates.
- Open a chat. Turn the globe icon ON. Hover — tooltip mentions "1 MCP server".
- Send a prompt that should trigger an MCP tool ("list the test_tool of my MCP server" or whatever fits your test server). Verify:
  - Routing analysis shows the MCP server's tools available.
  - Sources panel below the response includes `[test] <toolname>` entries.
  - No red badge for the success path.
- Disable the server (toggle off). Send the same prompt. Tools should NOT appear in routing — MCP gated off.
- Re-enable. Send a prompt while the MCP server is intentionally down (kill the server). Verify red "MCP error: test" badge appears.
- FAST category check: send "hi" (typical FAST trigger). Inspect network — chat request should NOT include MCP tools in the `tools` array.

Kill the dev server.

- [ ] **Step 5: Final commit / housekeeping**

If any small fix-ups came out of manual smoke, commit them with a `fix(mcp):` prefix. Otherwise nothing more to commit — the feature is done.

```bash
git log --oneline | head -25
```

Expected: 19+ commits introducing the feature on the dev branch. Do NOT push — user instruction is to hold the dev branch local pending review.

---

## Summary

When all tasks complete:

- Production runtime adds one dependency: `@modelcontextprotocol/sdk`
- New module `mcpClient.ts` (~280 lines) with full unit coverage
- `server.ts` gains one endpoint and ~70 lines inside `handleChat`
- New System tab section + extended Sources panel + globe tooltip + SSE handlers
- ~74 unit tests pass; ~5 opt-in integration tests pass under `RUN_INTEGRATION_TESTS=1`
- Docker image grows by ~1-2 MB (target ≤91 MB)
- Existing web_search, fetch_url, vision, document, and FAST paths unchanged
- All security guardrails from spec section 5 implemented: SSRF reuse, header validation/blocklist, log redaction, HTTPS cleartext warning, AES-256-GCM at rest (via existing config blob)

Direction B (Nexus-as-MCP-server) remains a separate spec to be brainstormed after Direction A ships.
