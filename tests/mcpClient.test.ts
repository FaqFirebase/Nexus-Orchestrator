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
  validateMcpServer,
  type McpServer,
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
