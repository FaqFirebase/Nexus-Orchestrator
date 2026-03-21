import { RefreshCw } from 'lucide-react';
import type { NexusConfig, ConnectionStatus } from '../../types';

interface DiscoveredModelsProps {
  localModels: any[];
  connectionStatus: ConnectionStatus;
  isLoading: boolean;
  config: NexusConfig;
  setConfig: (fn: (prev: NexusConfig) => NexusConfig) => void;
  checkConnection: (includeConfig?: boolean) => void;
}

export default function DiscoveredModels({
  localModels, connectionStatus, isLoading, config, setConfig, checkConnection,
}: DiscoveredModelsProps) {
  return (
    <div className="space-y-3 pt-4 border-t border-zinc-800/50">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Discovered Models</label>
        <button
          onClick={() => checkConnection(true)}
          className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest hover:text-emerald-400 transition-all flex items-center gap-1"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {localModels.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {localModels.map((model) => (
            <div
              key={model.name}
              onClick={() => {
                setConfig(prev => ({ ...prev, router: { ...prev.router, model: model.name } }));
              }}
              className="p-3 rounded-xl bg-black/40 border border-zinc-800/50 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all group cursor-pointer relative"
            >
              <div className="text-[10px] font-mono text-zinc-300 truncate mb-1 group-hover:text-emerald-400">{model.name}</div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-mono text-zinc-600">{model.size > 0 ? (model.size / (1024 * 1024 * 1024)).toFixed(1) + 'GB' : 'Cloud'}</span>
                  <span className="text-[8px] font-mono text-zinc-600 uppercase">{model.details?.family || 'unknown'}</span>
                </div>
                {(model.details?.parameter_size || model.details?.quantization_level) && (
                  <div className="flex items-center gap-2 border-t border-zinc-800/30 pt-1">
                    {model.details?.parameter_size && (
                      <span className="text-[7px] font-mono text-zinc-500 uppercase">{model.details.parameter_size}</span>
                    )}
                    {model.details?.quantization_level && (
                      <span className="text-[7px] font-mono text-zinc-500 uppercase">{model.details.quantization_level}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-xl">
                <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-widest">Set as Router</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-black/20 border border-dashed border-zinc-800 text-center">
          <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
            {connectionStatus.status === 'connected' ? 'No models found on provider' : 'Connect to provider to discover models'}
          </p>
        </div>
      )}
    </div>
  );
}
