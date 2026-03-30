import { useState } from 'react';
import { motion } from 'motion/react';
import { KeyRound } from 'lucide-react';

interface ChangePasswordModalProps {
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

export default function ChangePasswordModal({ onChangePassword, onClose }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!currentPassword || !newPassword || !confirmPassword || isSubmitting) return;
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    setIsSubmitting(true);
    setError('');
    const result = await onChangePassword(currentPassword, newPassword);
    if (result.success) {
      setSuccess(true);
      setTimeout(onClose, 1500);
    } else {
      setError(result.error || 'Failed to change password');
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
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500">
            <KeyRound className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-zinc-100 uppercase tracking-widest">Change Password</h2>
            <p className="text-xs text-zinc-500">Enter your current password and choose a new one.</p>
          </div>
        </div>

        {success ? (
          <div className="text-center py-4">
            <p className="text-emerald-400 font-bold text-sm">Password changed successfully</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => { setCurrentPassword(e.target.value); setError(''); }}
                placeholder="Enter current password..."
                autoComplete="current-password"
                className="w-full bg-black/40 border border-zinc-800 rounded-2xl px-4 py-3 text-sm font-mono text-zinc-300 focus:border-amber-500/50 outline-none transition-all placeholder:text-zinc-700"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setError(''); }}
                placeholder="Enter new password (min 8 chars)..."
                autoComplete="new-password"
                className="w-full bg-black/40 border border-zinc-800 rounded-2xl px-4 py-3 text-sm font-mono text-zinc-300 focus:border-amber-500/50 outline-none transition-all placeholder:text-zinc-700"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                placeholder="Confirm new password..."
                autoComplete="new-password"
                className="w-full bg-black/40 border border-zinc-800 rounded-2xl px-4 py-3 text-sm font-mono text-zinc-300 focus:border-amber-500/50 outline-none transition-all placeholder:text-zinc-700"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>

            {error && <p className="text-[10px] text-red-400 ml-1">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-6 py-3 rounded-2xl border border-zinc-800 text-xs font-bold text-zinc-500 uppercase tracking-widest hover:bg-zinc-800 hover:text-zinc-300 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex-[2] px-6 py-3 rounded-2xl bg-amber-500 text-black text-xs font-bold uppercase tracking-widest hover:bg-amber-400 transition-all disabled:opacity-50"
              >
                {isSubmitting ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
