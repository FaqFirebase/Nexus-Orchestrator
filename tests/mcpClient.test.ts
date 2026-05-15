import { describe, it, expect, beforeEach } from 'vitest';
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
  validateMcpServer,
  getCachedTools,
  setCachedTools,
  invalidateMcpCache,
  _resetCacheForTests,
  type McpServer,
  type McpToolDef,
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

  it('still returns unhealthy entries within TTL', () => {
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
