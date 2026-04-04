import { Loader2, Globe } from 'lucide-react';
import { motion } from 'motion/react';

interface RoutingStatusProps {
  routingStep: 'idle' | 'analyzing' | 'routing' | 'searching' | 'generating';
}

export default function RoutingStatus({ routingStep }: RoutingStatusProps) {
  const isSearching = routingStep === 'searching';
  return (
    <div className="flex items-start gap-4">
      <div className={`mt-1 w-6 h-6 rounded border flex items-center justify-center ${
        isSearching ? 'bg-blue-500/10 border-blue-500/20' : 'bg-emerald-500/10 border-emerald-500/20'
      }`}>
        {isSearching
          ? <Globe className="w-3 h-3 text-blue-400 animate-pulse" />
          : <Loader2 className="w-3 h-3 text-emerald-500 animate-spin" />}
      </div>
      <div className="space-y-2">
        <div className={`flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest ${
          isSearching ? 'text-blue-400' : 'text-emerald-500'
        }`}>
          {routingStep === 'analyzing' && '> Analyzing Intent...'}
          {routingStep === 'routing' && '> Orchestrating Local Model...'}
          {routingStep === 'searching' && '> Searching the Web...'}
          {routingStep === 'generating' && '> Generating Response...'}
        </div>
        <div className="w-48 h-1 bg-zinc-900 rounded-full overflow-hidden">
          <motion.div
            className={`h-full ${isSearching ? 'bg-blue-400' : 'bg-emerald-500'}`}
            animate={{ x: ['-100%', '100%'] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
          />
        </div>
      </div>
    </div>
  );
}
