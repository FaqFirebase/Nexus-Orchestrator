import { useState } from 'react';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import type { NexusConfig, ConnectionStatus } from '../../types';
import { usePersistentToggle } from '../../hooks/usePersistentToggle';

interface DiscoveredModelsProps {
  localModels: any[];
  connectionStatus: ConnectionStatus;
  isLoading: boolean;
  config: NexusConfig;
  setConfig: (fn: (prev: NexusConfig) => NexusConfig) => void;
  checkConnection: (includeConfig?: boolean) => void;
}

interface ModelGroup {
  providerName: string;
  models: any[];
}

const GENERIC_FAMILIES = new Set(['library', 'unknown', '']);
const LS_GROUPS_COLLAPSED = 'nexus:discovered-models:collapsed-groups';

function readSet(key: string): Set<string> {
  try {
    const v = localStorage.getItem(key);
    return v ? new Set(JSON.parse(v) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<string>): void {
  try { localStorage.setItem(key, JSON.stringify(Array.from(set))); } catch { /* ignore */ }
}

function groupByProvider(models: any[]): ModelGroup[] {
  const map = new Map<string, any[]>();
  for (const model of models) {
    const key = model.providerName ?? 'Unknown';
    const existing = map.get(key) ?? [];
    existing.push(model);
    map.set(key, existing);
  }
  return Array.from(map.entries()).map(([providerName, items]) => ({ providerName, models: items }));
}

function formatSize(model: any): string | null {
  if (model.details?.parameter_size) return model.details.parameter_size;
  if (model.size > 0) return (model.size / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
  return null;
}

function sizeColorClass(size: string | null): string {
  if (!size) return 'text-zinc-600 bg-zinc-800/40';
  const num = parseFloat(size);
  if (num >= 30) return 'text-orange-400/80 bg-orange-500/10';
  if (num >= 13) return 'text-amber-400/80 bg-amber-500/10';
  if (num >= 7)  return 'text-sky-400/80 bg-sky-500/10';
  return 'text-zinc-400 bg-zinc-800/50';
}

function ModelRow({
  model,
  isActive,
  onSelect,
}: {
  model: any;
  isActive: boolean;
  onSelect: () => void;
}) {
  const name = model.displayName || model.name;
  const size = formatSize(model);
  const family = model.details?.family;
  const showFamily = family && !GENERIC_FAMILIES.has(family.toLowerCase());
  const quant = model.details?.quantization_level;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={name}
      className={`
        group w-full flex items-center gap-2.5 px-3 py-2
        rounded-lg border transition-all text-left
        ${isActive
          ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-400'
          : 'border-transparent hover:border-zinc-700/60 hover:bg-zinc-800/30 text-zinc-400 hover:text-zinc-200'
        }
      `}
    >
      <div className={`w-1 h-1 rounded-full shrink-0 transition-colors ${isActive ? 'bg-emerald-500' : 'bg-zinc-700 group-hover:bg-zinc-500'}`} />

      <span className={`flex-1 text-[11px] font-mono truncate transition-colors ${isActive ? 'text-emerald-400' : 'text-zinc-300 group-hover:text-zinc-100'}`}>
        {name}
      </span>

      <div className="flex items-center gap-1.5 shrink-0">
        {showFamily && (
          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wide">
            {family}
          </span>
        )}
        {quant && (
          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wide">
            {quant}
          </span>
        )}
        {size && (
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${sizeColorClass(size)}`}>
            {size}
          </span>
        )}
      </div>

      {isActive && (
        <span className="text-[8px] font-bold text-emerald-500/70 uppercase tracking-widest shrink-0">
          active
        </span>
      )}
    </button>
  );
}

function ProviderGroup({
  group,
  activeModel,
  collapsedGroups,
  onToggleGroup,
  onSelect,
}: {
  group: ModelGroup;
  activeModel: string;
  collapsedGroups: Set<string>;
  onToggleGroup: (name: string) => void;
  onSelect: (model: any) => void;
}) {
  const collapsed = collapsedGroups.has(group.providerName);
  const hasActive = group.models.some(m => m.name === activeModel);

  return (
    <div className="rounded-lg border border-zinc-800/50 bg-black/20 overflow-hidden">
      <button
        type="button"
        onClick={() => onToggleGroup(group.providerName)}
        className="w-full flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/50 bg-zinc-900/30 hover:bg-zinc-800/30 transition-colors text-left"
      >
        {collapsed
          ? <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
          : <ChevronDown className="w-3 h-3 text-zinc-600 shrink-0" />
        }
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasActive ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest truncate flex-1">
          {group.providerName}
        </span>
        <span className="text-[9px] font-mono text-zinc-600 shrink-0">
          {group.models.length}
        </span>
      </button>

      {!collapsed && (
        <div className="p-1">
          {group.models.map((model, idx) => (
            <ModelRow
              key={`${model.providerUrl ?? ''}-${model.name}-${idx}`}
              model={model}
              isActive={model.name === activeModel}
              onSelect={() => onSelect(model)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DiscoveredModels({
  localModels, connectionStatus, isLoading, config, setConfig, checkConnection,
}: DiscoveredModelsProps) {
  const [visible, toggleVisible] = usePersistentToggle('nexus:discovered-models:visible', true);
  const [collapsedGroups, setCollapsedGroups] = useState(() => readSet(LS_GROUPS_COLLAPSED));

  const groups = groupByProvider(localModels);
  const activeModel = config.router.model;

  function toggleGroup(name: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      writeSet(LS_GROUPS_COLLAPSED, next);
      return next;
    });
  }

  function handleSelect(model: any) {
    setConfig(prev => ({ ...prev, router: { ...prev.router, model: model.name } }));
  }

  return (
    <div className="space-y-2 pt-4 border-t border-zinc-800/50">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={toggleVisible}
          className="flex items-center gap-1.5 group"
        >
          {visible
            ? <ChevronDown className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            : <ChevronRight className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
          }
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest group-hover:text-zinc-400 transition-colors">
            Discovered Models
          </span>
          {!visible && localModels.length > 0 && (
            <span className="text-[9px] font-mono text-zinc-700">
              ({localModels.length})
            </span>
          )}
        </button>
        <button
          onClick={() => checkConnection(true)}
          className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest hover:text-emerald-400 transition-all flex items-center gap-1"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {visible && (
        <>
          {localModels.length > 0 ? (
            <div className="space-y-1.5">
              {groups.map(group => (
                <ProviderGroup
                  key={group.providerName}
                  group={group}
                  activeModel={activeModel}
                  collapsedGroups={collapsedGroups}
                  onToggleGroup={toggleGroup}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-black/20 border border-dashed border-zinc-800 text-center">
              <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                {connectionStatus.status === 'connected'
                  ? 'No models found on provider'
                  : 'Connect to provider to discover models'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
