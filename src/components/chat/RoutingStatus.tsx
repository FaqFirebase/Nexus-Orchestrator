import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

interface RoutingStatusProps {
  routingStep: 'idle' | 'analyzing' | 'routing' | 'generating';
}

export default function RoutingStatus({ routingStep }: RoutingStatusProps) {
  return (
    <div className="flex items-start gap-4">
      <div className="mt-1 w-6 h-6 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
        <Loader2 className="w-3 h-3 text-emerald-500 animate-spin" />
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[10px] font-mono text-emerald-500 uppercase tracking-widest">
          {routingStep === 'analyzing' && '> Analyzing Intent...'}
          {routingStep === 'routing' && '> Orchestrating Local Model...'}
          {routingStep === 'generating' && '> Generating Response...'}
        </div>
        <div className="w-48 h-1 bg-zinc-900 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-emerald-500"
            animate={{ x: ['-100%', '100%'] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
          />
        </div>
      </div>
    </div>
  );
}
