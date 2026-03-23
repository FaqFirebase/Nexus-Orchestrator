export type ModelCategory = string;

export interface RoutingDecision {
  category: ModelCategory;
  model: string;
  fallbackModels?: string[];
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
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: string;
}

export interface NexusConfig {
  localUrl: string;
  localKey: string;
  cloudUrl: string;
  cloudKey: string;
  router: {
    provider: 'openai';
    model: string;
    url: string;
    key: string;
  };
  categories: Record<ModelCategory, { models: string[]; provider: 'local' | 'cloud' }>;
}

export interface ConnectionStatus {
  status: 'checking' | 'connected' | 'disconnected' | 'error';
  local?: string;
  message?: string;
}
