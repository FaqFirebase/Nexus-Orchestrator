export type ModelCategory = string;

export interface LocalProvider {
  name: string;
  url: string;
  key: string;
}

export interface CategoryModel {
  name: string;
  providerUrl: string;
}

export interface RoutingDecision {
  category: ModelCategory;
  model: string;
  providerUrl?: string;
  fallbackModels?: string[];
  fallbackProviderUrls?: string[];
  provider: 'local' | 'cloud';
  reasoning: string;
  confidence: number;
  routerModel?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string;
  preview?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  category?: ModelCategory;
  decision?: RoutingDecision;
  attachments?: Attachment[];
  timestamp: Date;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  webSearchQuery?: string;
  webSearchSources?: SearchSource[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: string;
  projectId?: string | null;
}

export interface Project {
  id: string;
  name: string;
  collapsed: boolean;
  createdAt: string;
}

export interface NexusConfig {
  localProviders: LocalProvider[];
  /** @deprecated Use localProviders[0] — kept for migration path only */
  localUrl?: string;
  /** @deprecated Use localProviders[0] — kept for migration path only */
  localKey?: string;
  cloudUrl: string;
  cloudKey: string;
  router: {
    provider: 'openai';
    model: string;
    url: string;
    key: string;
  };
  categories: Record<ModelCategory, { models: CategoryModel[]; provider: 'local' | 'cloud' }>;
  routerCacheEnabled?: boolean;
  searxng?: {
    url: string;
    alwaysOn: boolean;
  };
}

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export interface LocalProviderStatus {
  name: string;
  url: string;
  online: boolean;
  isOllama: boolean;
  message?: string;
}

export interface ConnectionStatus {
  status: 'checking' | 'connected' | 'disconnected' | 'error';
  local?: string;
  message?: string;
  providers?: LocalProviderStatus[];
}
