import { BrainCircuit, Network, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import type { NexusConfig } from '../../types';
import { usePersistentToggle } from '../../hooks/usePersistentToggle';

interface RouterConfigProps {
  config: NexusConfig;
  setConfig: (fn: (prev: NexusConfig) => NexusConfig) => void;
  saveStatus: 'idle' | 'saving' | 'success' | 'error';
  saveError: string | null;
  saveConfig: (cfg: NexusConfig) => void;
}

export default function RouterConfig({ config, setConfig, saveStatus, saveError, saveConfig }: RouterConfigProps) {
  const [visible, toggleVisible] = usePersistentToggle('nexus:section:router-config', true);

  return (
    <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4">
      <button
        type="button"
        onClick={toggleVisible}
        className="flex items-center gap-2 group w-full text-left"
      >
        {visible
          ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0" />
        }
        <BrainCircuit className="w-4 h-4 text-purple-500 shrink-0" />
        <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">Intent Router (Orchestrator)</h3>
      </button>

      {visible && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Router Provider</label>
              <div className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-2 text-xs font-mono text-zinc-400">
                OpenAI Compatible (Local/Cloud)
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Router Model</label>
              <input
                type="text"
                value={config.router.model}
                onChange={(e) => setConfig(prev => ({ ...prev, router: { ...prev.router, model: e.target.value } }))}
                className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 text-xs font-mono text-emerald-500 focus:border-emerald-500/50 outline-none transition-all"
                placeholder="e.g. gemma3:4b or gemini-2.0-flash-lite"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/10 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Network className="w-3 h-3 text-purple-400" />
                  <span className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">Custom Router Endpoint</span>
                </div>
                <span className="text-[8px] text-zinc-500 uppercase font-mono">Optional Override</span>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Router URL (router.url)</label>
                  <input
                    type="text"
                    value={config.router.url}
                    onChange={(e) => setConfig(prev => ({ ...prev, router: { ...prev.router, url: e.target.value } }))}
                    className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 text-xs font-mono text-emerald-500 focus:border-emerald-500/50 outline-none transition-all"
                    placeholder="e.g. https://openrouter.ai/api/v1"
                  />
                  <p className="text-[8px] text-zinc-600 italic">Leave blank to use Local Provider URL</p>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Router Key (router.key)</label>
                  <input
                    type="password"
                    value={config.router.key}
                    onChange={(e) => setConfig(prev => ({ ...prev, router: { ...prev.router, key: e.target.value } }))}
                    className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 text-xs font-mono text-emerald-500 focus:border-emerald-500/50 outline-none transition-all"
                    placeholder="Custom API Key"
                  />
                  <p className="text-[8px] text-zinc-600 italic">Leave blank to use main Local API Key</p>
                </div>
              </div>
            </div>

            {config.router.url.includes('openrouter.ai') && (
              <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/10 space-y-2">
                <div className="text-[9px] font-bold text-purple-400 uppercase tracking-widest">OpenRouter Quick Select</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Gemini Flash 1.5', id: 'google/gemini-flash-1.5' },
                    { label: 'Mistral 7B', id: 'mistralai/mistral-7b-instruct' },
                    { label: 'Claude 3 Haiku', id: 'anthropic/claude-3-haiku' },
                    { label: 'Minimax 2.5', id: 'minimax/minimax-01' }
                  ].map(m => (
                    <button
                      key={m.id}
                      onClick={() => setConfig(prev => ({ ...prev, router: { ...prev.router, model: m.id } }))}
                      className="px-2 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-[9px] text-purple-300 hover:bg-purple-500/20 transition-all"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => saveConfig(config)}
            disabled={saveStatus === 'saving'}
            className="w-full py-3 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl font-bold uppercase tracking-widest text-[10px] hover:bg-purple-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveStatus === 'saving' ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Saving...
              </>
            ) : saveStatus === 'success' ? (
              <>
                <CheckCircle2 className="w-3 h-3" />
                Router Config Saved
              </>
            ) : saveStatus === 'error' ? (
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-3 h-3" />
                  Failed to Save
                </div>
                {saveError && (
                  <span className="text-[8px] font-mono opacity-60 lowercase">
                    {saveError}
                  </span>
                )}
              </div>
            ) : (
              'Save Router Configuration'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
