import { BrainCircuit, X, Info, Zap, CloudOff } from 'lucide-react';
import type { NexusConfig, ModelCategory } from '../../types';
import { getCategoryConfig, CATEGORY_REASONING } from '../../constants';

interface CategoryMappingsProps {
  config: NexusConfig;
  localModels: any[];
  newCategoryName: string;
  setNewCategoryName: (v: string) => void;
  addCategory: () => void;
  removeCategory: (cat: string) => void;
  saveConfig: (cfg: NexusConfig) => void;
}

export default function CategoryMappings({
  config, localModels, newCategoryName, setNewCategoryName,
  addCategory, removeCategory, saveConfig,
}: CategoryMappingsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-emerald-500" />
          <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">Category Mappings</h3>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="NEW CATEGORY..."
            className="bg-black border border-zinc-800 rounded-lg px-3 py-1 text-[10px] font-mono text-emerald-500 focus:border-emerald-500/50 outline-none"
          />
          <button
            onClick={addCategory}
            className="px-3 py-1 bg-zinc-800 text-zinc-300 rounded-lg text-[10px] font-bold uppercase hover:bg-zinc-700 transition-all"
          >
            Add
          </button>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-6">
        {Object.entries(config.categories).map(([category, catConfig]) => (
          <div key={category} className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4 group relative">
            <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-all z-10">
              <button
                onClick={() => removeCategory(category)}
                title={`Remove "${category}" category — this cannot be undone`}
                className="p-1 bg-zinc-800 border border-zinc-700 rounded-full text-zinc-500 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/30 transition-all"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center ${getCategoryConfig(category).color}`}>
                  {getCategoryConfig(category).icon}
                </div>
                <h4 className="text-sm font-bold text-white tracking-tight">{category}</h4>
              </div>
              <select
                value={catConfig.provider}
                onChange={(e) => {
                  const newConfig = { ...config };
                  newConfig.categories[category as ModelCategory].provider = e.target.value as any;
                  saveConfig(newConfig);
                }}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-[9px] font-bold uppercase text-zinc-400 outline-none"
              >
                <option value="local">Local</option>
                <option value="cloud">Cloud</option>
              </select>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Model Pool</label>
                <div className="flex gap-2">
                  {catConfig.models.length > 0 && (
                    <button
                      onClick={() => {
                        const newConfig = { ...config };
                        newConfig.categories[category as ModelCategory].models = [];
                        saveConfig(newConfig);
                      }}
                      className="text-[8px] text-zinc-500 hover:text-red-400 uppercase tracking-tighter transition-colors"
                    >
                      Clear All
                    </button>
                  )}
                  <span className="text-[8px] text-zinc-500 font-mono italic">Select from discovered or add custom</span>
                </div>
              </div>

              {/* Selected Models as Tags */}
              <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2.5 bg-black/40 rounded-xl border border-zinc-800/50 shadow-inner">
                {catConfig.models.length > 0 ? catConfig.models.map(m => (
                  <button
                    key={m}
                    onClick={() => {
                      const newConfig = { ...config };
                      newConfig.categories[category as ModelCategory].models = catConfig.models.filter(mod => mod !== m);
                      saveConfig(newConfig);
                    }}
                    title="Click to remove"
                    className="px-2 py-1 bg-emerald-500/10 hover:bg-red-500/10 rounded-lg text-[10px] font-mono text-emerald-400 hover:text-red-400 border border-emerald-500/20 hover:border-red-500/20 transition-all flex items-center gap-1.5 group"
                  >
                    {m}
                    <X className="w-2.5 h-2.5 opacity-40 group-hover:opacity-100" />
                  </button>
                )) : (
                  <div className="flex items-center gap-2 text-zinc-700">
                    <Info className="w-3 h-3" />
                    <span className="text-[9px] font-mono italic">No models assigned to this category.</span>
                  </div>
                )}
              </div>

              {/* Model Picker — local vs cloud */}
              {catConfig.provider === 'cloud' ? (
                !config.cloudUrl ? (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-yellow-500/5 border border-yellow-500/20">
                    <CloudOff className="w-3.5 h-3.5 text-yellow-500/70 shrink-0" />
                    <p className="text-[9px] font-mono text-yellow-500/70 leading-relaxed">
                      Cloud provider not configured. Set a Cloud API URL in the <span className="font-bold">Settings</span> tab before assigning cloud models.
                    </p>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20 space-y-1">
                    <p className="text-[8px] font-bold text-blue-400/70 uppercase tracking-widest">Cloud Provider Active</p>
                    <p className="text-[9px] font-mono text-zinc-500 leading-relaxed">
                      Enter model names manually below (e.g. <span className="text-blue-400/80">gpt-4o</span>, <span className="text-blue-400/80">claude-3-5-sonnet</span>).
                    </p>
                  </div>
                )
              ) : (
                localModels.length > 0 && (
                  <div className="p-3 rounded-xl bg-zinc-800/30 border border-zinc-800/50 space-y-2">
                    <p className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Available Local Models</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {localModels.map(m => {
                        const isSelected = catConfig.models.includes(m.name);
                        return (
                          <button
                            key={m.name}
                            onClick={() => {
                              const newConfig = { ...config };
                              const currentModels = newConfig.categories[category as ModelCategory].models;
                              if (isSelected) {
                                newConfig.categories[category as ModelCategory].models = currentModels.filter(mod => mod !== m.name);
                              } else {
                                newConfig.categories[category as ModelCategory].models = [...currentModels, m.name];
                              }
                              saveConfig(newConfig);
                            }}
                            className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-[9px] font-mono border transition-all ${
                              isSelected
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                : 'bg-black/20 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                            }`}
                          >
                            <span className="truncate mr-1">{m.name}</span>
                            {isSelected ? (
                              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            ) : (
                              <div className="w-2 h-2 rounded-full border border-zinc-700" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )
              )}

              {/* Manual Entry */}
              <div className="relative group">
                <input
                  type="text"
                  placeholder="Add custom model (e.g. gemini-1.5-pro)..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = e.currentTarget.value.trim();
                      if (val && !catConfig.models.includes(val)) {
                        const newConfig = { ...config };
                        newConfig.categories[category as ModelCategory].models = [...catConfig.models, val];
                        saveConfig(newConfig);
                        e.currentTarget.value = '';
                      }
                    }
                  }}
                  className="w-full bg-black/40 border border-zinc-800 rounded-xl px-3 py-2 text-[10px] font-mono text-zinc-300 focus:border-emerald-500/50 outline-none transition-all placeholder:text-zinc-700"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[8px] font-bold text-zinc-700 uppercase tracking-widest opacity-0 group-focus-within:opacity-100 transition-opacity">
                  Press Enter
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Routing Logic Reasoning */}
      <div className="mt-12 space-y-6 pt-12 border-t border-zinc-800/50">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-zinc-400" />
          <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-widest">Routing Logic & Decision Matrix</h3>
        </div>

        <div className="grid gap-4">
          {Object.entries(CATEGORY_REASONING).map(([cat, reasoning]) => (
            <div key={cat} className="p-4 rounded-xl bg-zinc-900/30 border border-zinc-800 flex gap-4 items-start group hover:border-zinc-700 transition-colors">
              <div className={`w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 ${getCategoryConfig(cat).color}`}>
                {getCategoryConfig(cat).icon}
              </div>
              <div className="space-y-1">
                <h4 className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">{cat}</h4>
                <p className="text-xs text-zinc-500 leading-relaxed group-hover:text-zinc-400 transition-colors">{reasoning}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="p-6 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 space-y-4">
          <div className="flex items-center gap-2 text-emerald-500">
            <Zap className="w-4 h-4" />
            <h4 className="text-xs font-bold uppercase tracking-widest">Orchestration Strategy</h4>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">1. Intent Analysis</p>
              <p className="text-[10px] text-zinc-500 leading-relaxed">The router model analyzes the user input to determine the primary intent and required capabilities.</p>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">2. Provider Selection</p>
              <p className="text-[10px] text-zinc-500 leading-relaxed">The router checks the category mapping. If set to 'Local' and the provider is online, it targets the local model pool.</p>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">3. Load Balancing</p>
              <p className="text-[10px] text-zinc-500 leading-relaxed">If multiple models are in a pool, the router selects the first available or uses a weighted round-robin approach.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
