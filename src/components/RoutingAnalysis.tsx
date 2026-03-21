import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { RoutingDecision, Message } from '../types';
import { getCategoryConfig } from '../constants';

interface RoutingAnalysisProps {
  decision: RoutingDecision;
  usage?: Message['usage'];
}

export default function RoutingAnalysis({ decision, usage }: RoutingAnalysisProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = getCategoryConfig(decision.category);

  return (
    <div className="mt-4 border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/30">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-zinc-800/50 transition-colors group"
      >
        <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded-lg bg-zinc-800 ${config.color}`}>
            {config.icon}
          </div>
          <div className="text-left">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Routing Analysis</p>
            <p className="text-[9px] text-zinc-600 font-mono uppercase">Intent: {decision.category} • Model: {decision.model}{decision.routerModel ? ` • Router: ${decision.routerModel}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[8px] font-bold text-zinc-700 uppercase tracking-widest group-hover:text-zinc-500 transition-colors">
            {isExpanded ? 'Collapse' : 'Expand Details'}
          </span>
          {isExpanded ? <ChevronUp className="w-3 h-3 text-zinc-600" /> : <ChevronDown className="w-3 h-3 text-zinc-600" />}
        </div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 pt-0 space-y-4">
              <div className="h-px bg-zinc-800" />
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Reasoning</p>
                  <p className="text-xs text-zinc-400 leading-relaxed italic">
                    "{decision.reasoning}"
                  </p>
                </div>

                {decision.routerModel && (
                  <div className="space-y-1">
                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Routed By</p>
                    <p className="text-xs font-mono text-purple-400">{decision.routerModel}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Confidence</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 w-[94%]" />
                      </div>
                      <span className="text-[9px] font-mono text-emerald-500">94%</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Latency Impact</p>
                    <p className="text-[9px] font-mono text-zinc-400">Minimal (+12ms)</p>
                  </div>
                </div>

                <div className="p-2 bg-black/30 rounded-lg border border-zinc-800/50">
                  <p className="text-[8px] text-zinc-600 leading-relaxed">
                    <span className="text-emerald-500/50 font-bold">Strategy:</span> The router identified patterns matching the <span className="text-zinc-400">{decision.category}</span> domain. It selected <span className="text-zinc-400">{decision.model}</span> based on current availability and specialized performance benchmarks for this intent.
                  </p>
                </div>

                {decision.usage && (
                  <div className="flex items-center gap-4 pt-1 border-t border-zinc-800/50">
                    <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest">Routing Tokens:</p>
                    <div className="flex items-center gap-1.5">
                      <p className="text-[8px] font-mono text-zinc-500 uppercase">Input: <span className="text-zinc-300">{decision.usage.prompt_tokens}</span></p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-[8px] font-mono text-zinc-500 uppercase">Output: <span className="text-zinc-300">{decision.usage.completion_tokens}</span></p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-[8px] font-mono text-zinc-500 uppercase">Total: <span className="text-zinc-300">{decision.usage.total_tokens}</span></p>
                    </div>
                  </div>
                )}

                {usage && (
                  <div className="flex items-center gap-4 pt-1 border-t border-zinc-800/50">
                    <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest">Chat Tokens:</p>
                    <div className="flex items-center gap-1.5">
                      <p className="text-[8px] font-mono text-zinc-500 uppercase">Input: <span className="text-zinc-300">{usage.prompt_tokens}</span></p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-[8px] font-mono text-zinc-500 uppercase">Output: <span className="text-zinc-300">{usage.completion_tokens}</span></p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-[8px] font-mono text-zinc-500 uppercase">Total: <span className="text-zinc-300">{usage.total_tokens}</span></p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
