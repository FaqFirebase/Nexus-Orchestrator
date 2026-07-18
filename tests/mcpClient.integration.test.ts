// Opt-in MCP integration tests. Skipped by default; run with:
//   RUN_INTEGRATION_TESTS=1 npx vitest run tests/mcpClient.integration.test.ts
//
// These exercise the real `@modelcontextprotocol/sdk` transport against
// concrete servers. The default behaviour is `describe.skip` so `npm test`
// stays fast and offline (matches the fetchUrl.test.ts policy).
import { describe, it, expect } from 'vitest';
import { listMcpTools, callMcpTool, _resetCacheForTests, type McpServer } from '../mcpClient.js';

const RUN = process.env.RUN_INTEGRATION_TESTS === '1';
const d = RUN ? describe : describe.skip;

const unreachable = (): McpServer => ({
  id: 'int-dead',
  name: 'dead',
  url: 'http://127.0.0.1:1/mcp',
  enabled: true,
});

d('MCP integration (RUN_INTEGRATION_TESTS=1)', () => {
  it('listMcpTools returns an error kind for an unreachable host', async () => {
    _resetCacheForTests();
    const r = await listMcpTools('u-int', unreachable());
    expect(r.healthy).toBe(false);
    // Underlying transport surfaces vary by Node/undici — accept either bucket
    expect(['protocol', 'unknown']).toContain(r.errorKind);
    expect(r.tools).toEqual([]);
  });

  it('callMcpTool returns isError=true with not_found when prefix does not match server', async () => {
    const r = await callMcpTool(unreachable(), 'someother__doit', { x: 1 });
    expect(r.isError).toBe(true);
    expect(r.errorKind).toBe('not_found');
  });

  it('callMcpTool returns isError=true with protocol error when server unreachable', async () => {
    const r = await callMcpTool(unreachable(), 'dead__doit', { x: 1 });
    expect(r.isError).toBe(true);
    // Either protocol or unknown depending on transport timing
    expect(['protocol', 'unknown']).toContain(r.errorKind);
  });

  it('listMcpTools rejects bad SSRF target without network call', async () => {
    _resetCacheForTests();
    const bad: McpServer = { id: 'int-meta', name: 'meta', url: 'http://169.254.169.254/mcp', enabled: true };
    const r = await listMcpTools('u-int', bad);
    expect(r.healthy).toBe(false);
    expect(r.errorKind).toBe('unknown');
  });
});
