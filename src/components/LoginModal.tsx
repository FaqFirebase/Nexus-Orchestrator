import { useState } from 'react';
import { motion } from 'motion/react';
import { Lock, UserPlus } from 'lucide-react';

interface LoginModalProps {
  onLogin: (username: string, password: string) => Promise<boolean | void> | void;
  onRegister?: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  onCancel: () => void;
  registrationEnabled?: boolean;
  required?: boolean;
}

export default function LoginModal({ onLogin, onRegister, onCancel, registrationEnabled, required }: LoginModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!username.trim() || !password.trim() || isSubmitting) return;

    if (mode === 'register') {
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
      if (username.length < 3) {
        setError('Username must be at least 3 characters');
        return;
      }
    }

    setIsSubmitting(true);
    setError('');

    if (mode === 'register' && onRegister) {
      const result = await onRegister(username, password);
      if (!result.success) {
        setError(result.error || 'Registration failed');
      }
    } else {
      const result = await onLogin(username, password);
      if (result === false) {
        setError('Invalid username or password');
      }
    }
    setIsSubmitting(false);
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
    setConfirmPassword('');
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
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.1)] ${
            mode === 'login' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-blue-500/10 text-blue-500'
          }`}>
            {mode === 'login' ? <Lock className="w-8 h-8" /> : <UserPlus className="w-8 h-8" />}
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-zinc-100 uppercase tracking-widest">
              {mode === 'login' ? 'Sign In' : 'Create Account'}
            </h2>
            <p className="text-xs text-zinc-500">
              {mode === 'login'
                ? 'Enter your credentials to access Nexus Orchestrator.'
                : 'Create a new account to get started.'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              placeholder="Enter username..."
              autoComplete="username"
              className={`w-full bg-black/40 border ${error ? 'border-red-500/50' : 'border-zinc-800'} rounded-2xl px-4 py-3 text-sm font-mono text-zinc-300 focus:border-emerald-500/50 outline-none transition-all placeholder:text-zinc-700`}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              placeholder="Enter password..."
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className={`w-full bg-black/40 border ${error ? 'border-red-500/50' : 'border-zinc-800'} rounded-2xl px-4 py-3 text-sm font-mono text-zinc-300 focus:border-emerald-500/50 outline-none transition-all placeholder:text-zinc-700`}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>

          {mode === 'register' && (
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                placeholder="Confirm password..."
                autoComplete="new-password"
                className={`w-full bg-black/40 border ${error ? 'border-red-500/50' : 'border-zinc-800'} rounded-2xl px-4 py-3 text-sm font-mono text-zinc-300 focus:border-emerald-500/50 outline-none transition-all placeholder:text-zinc-700`}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>
          )}

          {error && <p className="text-[10px] text-red-400 ml-1">{error}</p>}

          <div className="flex gap-3">
            {!required && (
              <button
                onClick={onCancel}
                className="flex-1 px-6 py-3 rounded-2xl border border-zinc-800 text-xs font-bold text-zinc-500 uppercase tracking-widest hover:bg-zinc-800 hover:text-zinc-300 transition-all"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={`flex-[2] px-6 py-3 rounded-2xl text-black text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50 ${
                mode === 'login'
                  ? 'bg-emerald-500 hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                  : 'bg-blue-500 hover:bg-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.2)]'
              }`}
            >
              {isSubmitting
                ? (mode === 'login' ? 'Signing in...' : 'Creating account...')
                : (mode === 'login' ? 'Sign In' : 'Create Account')}
            </button>
          </div>

          {registrationEnabled && (
            <div className="text-center">
              <button
                onClick={switchMode}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
