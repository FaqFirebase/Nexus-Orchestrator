import { useState } from 'react';
import { Settings, Globe, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, Shield, Lock, Search, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { NexusConfig, LocalProvider } from '../../types';
import { usePersistentToggle } from '../../hooks/usePersistentToggle';

interface ProviderConfigProps {
  config: NexusConfig;
  setConfig: (fn: (prev: NexusConfig) => NexusConfig) => void;
  showApiKey: boolean;
  setShowApiKey: (v: boolean) => void;
  saveStatus: 'idle' | 'saving' | 'success' | 'error';
  saveError: string | null;
  saveConfig: (cfg: NexusConfig) => void;
  authRequired: boolean;
  isAuthorized: boolean;
  logout: () => void;
}

const MASKED_PATTERN = /\.\.\.|^\*{4}$/;

function isMasked(key: string): boolean {
  return MASKED_PATTERN.test(key);
}

function SectionHeader({
  visible,
  onToggle,
  children,
}: {
  visible: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 group w-full text-left"
    >
      {visible
        ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0" />
        : <ChevronRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0" />
      }
      {children}
    </button>
  );
}

function SaveFeedback({ saveStatus, saveError }: { saveStatus: ProviderConfigProps['saveStatus']; saveError: string | null }) {
  return (
    <AnimatePresence>
      {saveStatus !== 'idle' && (
        <motion.div
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 10 }}
          className="flex flex-col items-end gap-1"
        >
          <div className="flex items-center gap-2">
            {saveStatus === 'saving' && <Loader2 className="w-3 h-3 text-zinc-500 animate-spin" />}
            {saveStatus === 'success' && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
            {saveStatus === 'error' && <AlertCircle className="w-3 h-3 text-red-500" />}
            <span className={`text-[9px] font-bold uppercase tracking-widest ${
              saveStatus === 'saving' ? 'text-zinc-500' :
              saveStatus === 'success' ? 'text-emerald-500' :
              'text-red-500'
            }`}>
              {saveStatus === 'saving' ? 'Saving...' :
               saveStatus === 'success' ? 'Config Updated' :
               'Save Failed'}
            </span>
          </div>
          {saveStatus === 'error' && saveError && (
            <span className="text-[8px] font-mono text-red-500/80 max-w-[150px] truncate">{saveError}</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function ProviderConfig({
  config, setConfig, showApiKey, setShowApiKey,
  saveStatus, saveError, saveConfig,
  authRequired, isAuthorized, logout,
}: ProviderConfigProps) {
  const [showCloudKey, setShowCloudKey] = useState(false);
  const [localVisible, toggleLocal] = usePersistentToggle('nexus:section:local-providers', true);
  const [cloudVisible, toggleCloud] = usePersistentToggle('nexus:section:cloud-provider', true);
  const [searchVisible, toggleSearch] = usePersistentToggle('nexus:section:web-search', true);

  const providers: LocalProvider[] = config.localProviders?.length > 0
    ? config.localProviders
    : [{ name: 'Local', url: '', key: '' }];

  const updateProvider = (index: number, field: keyof LocalProvider, value: string) => {
    setConfig(prev => {
      const updated = [...(prev.localProviders ?? [])];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, localProviders: updated };
    });
  };

  const addProvider = () => {
    setConfig(prev => ({
      ...prev,
      localProviders: [...(prev.localProviders ?? []), { name: `Provider ${(prev.localProviders?.length ?? 0) + 1}`, url: '', key: '' }],
    }));
  };

  const removeProvider = (index: number) => {
    setConfig(prev => {
      const updated = (prev.localProviders ?? []).filter((_, i) => i !== index);
      return { ...prev, localProviders: updated.length > 0 ? updated : [{ name: 'Local', url: '', key: '' }] };
    });
  };

  return (
    <div className="grid gap-6">
      {/* Local Providers */}
      <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4">
        <div className="flex items-center justify-between">
          <SectionHeader visible={localVisible} onToggle={toggleLocal}>
            <Settings className="w-4 h-4 text-emerald-500 shrink-0" />
            <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">Local Model/API Providers</h3>
          </SectionHeader>
          {localVisible && (
            <button
              onClick={addProvider}
              className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-[10px] font-bold text-zinc-300 uppercase tracking-widest transition-all shrink-0"
            >
              <Plus className="w-3 h-3" />
              Add Provider
            </button>
          )}
        </div>

        {localVisible && (
          <>
            <div className="space-y-4">
              {providers.map((provider, index) => (
                <div key={index} className="p-4 rounded-xl bg-black/30 border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <input
                      type="text"
                      value={provider.name}
                      onChange={(e) => updateProvider(index, 'name', e.target.value)}
                      className="bg-transparent text-[10px] font-bold text-zinc-400 uppercase tracking-widest outline-none focus:text-zinc-200 transition-colors w-40"
                      placeholder="Provider Name"
                    />
                    {providers.length > 1 && (
                      <button
                        onClick={() => removeProvider(index)}
                        className="p-1 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                        title="Remove provider"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Provider URL</label>
                      <input
                        type="text"
                        value={provider.url}
                        onChange={(e) => updateProvider(index, 'url', e.target.value)}
                        className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 text-xs font-mono text-emerald-500 focus:border-emerald-500/50 outline-none transition-all"
                        placeholder="192.168.1.x:11434 or localhost:11434"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">API Key</label>
                      <div className="relative">
                        <input
                          type={showApiKey ? "text" : "password"}
                          value={isMasked(provider.key) ? provider.key : provider.key}
                          onChange={(e) => updateProvider(index, 'key', e.target.value)}
                          className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 pr-10 text-xs font-mono text-emerald-500 focus:border-emerald-500/50 outline-none transition-all"
                          placeholder="Leave blank for Ollama"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
                        >
                          {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3">
              <SaveFeedback saveStatus={saveStatus} saveError={saveError} />
              <button
                onClick={() => saveConfig(config)}
                disabled={saveStatus === 'saving'}
                className="px-4 py-2 bg-emerald-500 text-black rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Update Configuration
              </button>
            </div>
          </>
        )}
      </div>

      {/* Cloud Provider */}
      <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4">
        <SectionHeader visible={cloudVisible} onToggle={toggleCloud}>
          <Globe className="w-4 h-4 text-blue-500 shrink-0" />
          <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">Cloud Model/API Provider</h3>
        </SectionHeader>

        {cloudVisible && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Cloud API URL</label>
                <input
                  type="text"
                  value={config.cloudUrl}
                  onChange={(e) => setConfig(prev => ({ ...prev, cloudUrl: e.target.value }))}
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 text-xs font-mono text-blue-400 focus:border-blue-500/50 outline-none transition-all"
                  placeholder="https://your-cloud-provider.com/v1"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Cloud API Key</label>
                <div className="relative">
                  <input
                    type={showCloudKey ? "text" : "password"}
                    value={config.cloudKey}
                    onChange={(e) => setConfig(prev => ({ ...prev, cloudKey: e.target.value }))}
                    className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 pr-10 text-xs font-mono text-blue-400 focus:border-blue-500/50 outline-none transition-all"
                    placeholder="sk-..."
                  />
                  <button
                    type="button"
                    onClick={() => setShowCloudKey(!showCloudKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
                  >
                    {showCloudKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => saveConfig(config)}
                disabled={saveStatus === 'saving'}
                className="px-4 py-2 bg-blue-500 text-black rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Update Cloud Settings
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SearXNG Web Search */}
      <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4">
        <SectionHeader visible={searchVisible} onToggle={toggleSearch}>
          <Search className="w-4 h-4 text-blue-400 shrink-0" />
          <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">Web Search (SearXNG)</h3>
        </SectionHeader>

        {searchVisible && (
          <div className="space-y-4">
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Connect a self-hosted SearXNG instance to give the LLM tool-calling access to the web. The model decides when to search.
            </p>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">SearXNG URL</label>
              <input
                type="text"
                value={config.searxng?.url || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, searxng: { url: e.target.value, alwaysOn: prev.searxng?.alwaysOn ?? false } }))}
                className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 text-xs font-mono text-blue-400 focus:border-blue-500/50 outline-none transition-all"
                placeholder="searxng:8080 or localhost:8080"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">Always On</p>
                <p className="text-[10px] text-zinc-500">Include web search tool in every request. Can also be toggled per-chat in the input bar.</p>
              </div>
              <button
                onClick={() => setConfig(prev => ({ ...prev, searxng: { url: prev.searxng?.url ?? '', alwaysOn: !(prev.searxng?.alwaysOn ?? false) } }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${config.searxng?.alwaysOn ? 'bg-blue-500' : 'bg-zinc-700'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${config.searxng?.alwaysOn ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <div className="flex items-center justify-end">
              <button
                onClick={() => saveConfig(config)}
                disabled={saveStatus === 'saving'}
                className="px-4 py-2 bg-blue-500 text-black rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save Search Settings
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Admin Authentication */}
      <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-500" />
            <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">Admin Authentication</h3>
          </div>
          {authRequired && (
            <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
              <Lock className="w-3 h-3 text-emerald-500" />
              <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-widest">Enabled</span>
            </div>
          )}
        </div>

        <div className="p-4 rounded-xl bg-black/40 border border-zinc-800 space-y-4">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-zinc-800 text-zinc-400">
              <Lock className="w-4 h-4" />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">Access Control</p>
              <p className="text-xs text-zinc-500 leading-relaxed">
                {authRequired
                  ? "This instance is protected by an Admin API Key. You must be authenticated to use the router, modify settings, or view system health."
                  : "No Admin API Key is set. For security, all API access is currently disabled. Set ADMIN_API_KEY in your environment variables to enable this instance."}
              </p>
            </div>
          </div>

          {authRequired && (
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isAuthorized ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-[10px] font-mono text-zinc-400">
                  {isAuthorized ? 'Authenticated Session' : 'Unauthorized Session'}
                </span>
              </div>
              <button
                onClick={logout}
                className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest hover:text-emerald-400 transition-colors"
              >
                {isAuthorized ? 'Logout / Change Key' : 'Authenticate'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
