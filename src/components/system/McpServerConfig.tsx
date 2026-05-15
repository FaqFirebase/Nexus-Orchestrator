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
