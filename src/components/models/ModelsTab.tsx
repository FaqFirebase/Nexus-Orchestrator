import type { NexusConfig, ConnectionStatus } from '../../types';
import ProviderConfig from './ProviderConfig';
import RouterConfig from './RouterConfig';
import DiscoveredModels from './DiscoveredModels';
import CategoryMappings from './CategoryMappings';

interface ModelsTabProps {
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
  localModels: any[];
  connectionStatus: ConnectionStatus;
  isLoading: boolean;
  checkConnection: (includeConfig?: boolean) => void;
  newCategoryName: string;
  setNewCategoryName: (v: string) => void;
  addCategory: () => void;
  removeCategory: (cat: string) => void;
}

export default function ModelsTab(props: ModelsTabProps) {
  return (
    <div className="pb-20 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tighter text-white">Model Configuration</h2>
        <p className="text-zinc-400 text-sm">Manage your local and cloud model endpoints and routing logic.</p>
      </div>

      <ProviderConfig
        config={props.config}
        setConfig={props.setConfig}
        showApiKey={props.showApiKey}
        setShowApiKey={props.setShowApiKey}
        saveStatus={props.saveStatus}
        saveError={props.saveError}
        saveConfig={props.saveConfig}
        authRequired={props.authRequired}
        isAuthorized={props.isAuthorized}
        logout={props.logout}
      />

      <RouterConfig
        config={props.config}
        setConfig={props.setConfig}
        saveStatus={props.saveStatus}
        saveError={props.saveError}
        saveConfig={props.saveConfig}
      />

      <DiscoveredModels
        localModels={props.localModels}
        connectionStatus={props.connectionStatus}
        isLoading={props.isLoading}
        config={props.config}
        setConfig={props.setConfig}
        checkConnection={props.checkConnection}
      />

      <CategoryMappings
        config={props.config}
        localModels={props.localModels}
        newCategoryName={props.newCategoryName}
        setNewCategoryName={props.setNewCategoryName}
        addCategory={props.addCategory}
        removeCategory={props.removeCategory}
        saveConfig={props.saveConfig}
      />
    </div>
  );
}
