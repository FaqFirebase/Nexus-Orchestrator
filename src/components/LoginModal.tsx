import { useState } from 'react';
import { motion } from 'motion/react';
import { Lock } from 'lucide-react';

interface LoginModalProps {
  onLogin: (key: string) => Promise<boolean | void> | void;
  onCancel: () => void;
}

export default function LoginModal({ onLogin, onCancel }: LoginModalProps) {
  const [key, setKey] = useState('');
  const [error, setError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!key.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setError(false);
    const result = await onLogin(key);
    if (result === false) {
      setError(true);
    }
    setIsSubmitting(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl space-y-6"
      >
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.1)]">
            <Lock className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-zinc-100 uppercase tracking-widest">Admin Access</h2>
            <p className="text-xs text-zinc-500">Authentication is required to access configuration and system health.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Admin API Key</label>
            <input
              type="password"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setError(false);
              }}
              placeholder="Enter your ADMIN_API_KEY..."
              className={`w-full bg-black/40 border ${error ? 'border-red-500/50' : 'border-zinc-800'} rounded-2xl px-4 py-3 text-sm font-mono text-zinc-300 focus:border-emerald-500/50 outline-none transition-all placeholder:text-zinc-700`}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
            {error && <p className="text-[10px] text-red-400 ml-1">Invalid Admin Key. Please try again.</p>}
          </div>

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-6 py-3 rounded-2xl border border-zinc-800 text-xs font-bold text-zinc-500 uppercase tracking-widest hover:bg-zinc-800 hover:text-zinc-300 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-[2] px-6 py-3 rounded-2xl bg-emerald-500 text-black text-xs font-bold uppercase tracking-widest hover:bg-emerald-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)] disabled:opacity-50"
            >
              {isSubmitting ? 'Authenticating...' : 'Authenticate'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
