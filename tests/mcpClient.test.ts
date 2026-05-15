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
