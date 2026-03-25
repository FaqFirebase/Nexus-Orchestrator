import React from 'react';
import {
  Code2,
  BrainCircuit,
  Sparkles,
  Image as ImageIcon,
  Terminal,
  FileText,
  Cpu,
  Zap,
  ShieldCheck,
} from 'lucide-react';
import type { NexusConfig } from './types';

declare const __APP_VERSION__: string;
export const VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

export const CATEGORY_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  CODING: { icon: <Code2 className="w-4 h-4" />, color: 'text-blue-400' },
  REASONING: { icon: <BrainCircuit className="w-4 h-4" />, color: 'text-purple-400' },
  CREATIVE: { icon: <Sparkles className="w-4 h-4" />, color: 'text-amber-400' },
  VISION: { icon: <ImageIcon className="w-4 h-4" />, color: 'text-emerald-400' },
  GENERAL: { icon: <Terminal className="w-4 h-4" />, color: 'text-zinc-400' },
  DOCUMENT: { icon: <FileText className="w-4 h-4" />, color: 'text-cyan-400' },
  FAST: { icon: <Zap className="w-4 h-4" />, color: 'text-yellow-400' },
  SECURITY: { icon: <ShieldCheck className="w-4 h-4" />, color: 'text-red-400' },
};

export const CATEGORY_REASONING: Record<string, string> = {
  CODING: "Selected for technical implementation, debugging, or architectural queries. Prefers models with high context windows and strict syntax adherence.",
  REASONING: "Triggered for complex logic, mathematical problems, or multi-step planning. Routes to models with strong chain-of-thought capabilities.",
  CREATIVE: "Used for brainstorming, storytelling, or stylistic writing. Prioritizes models with higher temperature settings and diverse vocabulary.",
  VISION: "Activated when images are attached or visual descriptions are requested. Routes to multimodal-capable local or cloud endpoints.",
  GENERAL: "The default fallback for conversational queries, facts, and simple tasks. Optimized for low latency and high throughput.",
  DOCUMENT: "Specialized for analyzing long-form text, PDFs, or structured data files. Prefers models optimized for retrieval-augmented generation (RAG).",
  FAST: "Quick responses for simple questions, greetings, or trivial tasks. Routes to the smallest, fastest model available for minimal latency.",
  SECURITY: "Security analysis, vulnerability assessment, threat modeling, CTF challenges, penetration testing guidance, and cybersecurity best practices.",
};

export const DEFAULT_CONFIG: NexusConfig = {
  localUrl: "http://localhost:11434",
  localKey: "",
  cloudUrl: "",
  cloudKey: "",
  router: {
    provider: 'openai' as 'openai',
    model: '',
    url: '',
    key: ''
  },
  categories: {
    CODING: { models: [], provider: 'local' as 'local' | 'cloud' },
    REASONING: { models: [], provider: 'local' as 'local' | 'cloud' },
    CREATIVE: { models: [], provider: 'local' as 'local' | 'cloud' },
    VISION: { models: [], provider: 'local' as 'local' | 'cloud' },
    GENERAL: { models: [], provider: 'local' as 'local' | 'cloud' },
    DOCUMENT: { models: [], provider: 'local' as 'local' | 'cloud' },
    FAST: { models: [], provider: 'local' as 'local' | 'cloud' },
    SECURITY: { models: [], provider: 'local' as 'local' | 'cloud' },
  }
};

export const getCategoryConfig = (cat: string) => {
  return CATEGORY_CONFIG[cat] || { icon: <Cpu className="w-4 h-4" />, color: 'text-zinc-500' };
};
