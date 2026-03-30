import { useState, useEffect } from 'react';
import { Users, Plus, Trash2, KeyRound, Shield, User as UserIcon } from 'lucide-react';
import type { User } from '../../types';

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [createError, setCreateError] = useState('');
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [registrationEnabled, setRegistrationEnabled] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${window.location.origin}/api/admin/users`);
      if (res.ok) setUsers(await res.json());
    } catch { /* ignore */ }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${window.location.origin}/api/admin/settings`);
      if (res.ok) {
        const data = await res.json();
        setRegistrationEnabled(data.registrationEnabled || false);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchUsers(); fetchSettings(); }, []);

  const handleCreate = async () => {
    if (!newUsername.trim() || !newPassword.trim()) return;
    setCreateError('');
    try {
      const res = await fetch(`${window.location.origin}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      });
      if (res.ok) {
        setNewUsername('');
        setNewPassword('');
        setNewRole('user');
        setShowCreate(false);
        fetchUsers();
      } else {
        const data = await res.json();
        setCreateError(data.error || 'Failed to create user');
      }
    } catch {
      setCreateError('Network error');
    }
  };

  const handleDelete = async (id: string, username: string) => {
    if (!confirm(`Delete user "${username}"? This will remove all their conversations, projects, and config.`)) return;
    try {
      const res = await fetch(`${window.location.origin}/api/admin/users/${id}`, { method: 'DELETE' });
      if (res.ok) fetchUsers();
    } catch { /* ignore */ }
  };

  const handleResetPassword = async () => {
    if (!resetPassword.trim() || !resetUserId) return;
    setResetError('');
    try {
      const res = await fetch(`${window.location.origin}/api/admin/users/${resetUserId}/reset`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPassword }),
      });
      if (res.ok) {
        setResetUserId(null);
        setResetPassword('');
      } else {
        const data = await res.json();
        setResetError(data.error || 'Failed to reset password');
      }
    } catch {
      setResetError('Network error');
    }
  };

  const toggleRegistration = async () => {
    const newValue = !registrationEnabled;
    try {
      const res = await fetch(`${window.location.origin}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationEnabled: newValue }),
      });
      if (res.ok) setRegistrationEnabled(newValue);
    } catch { /* ignore */ }
  };

  return (
    <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-purple-400" />
          <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">User Management</h3>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 text-[10px] font-bold text-purple-400 uppercase tracking-widest hover:text-purple-300 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add User
        </button>
      </div>

      {/* Registration toggle */}
      <div className="flex items-center justify-between py-2 border-b border-zinc-800/50">
        <div>
          <p className="text-sm text-zinc-200 font-medium">Public Registration</p>
          <p className="text-[10px] text-zinc-500 font-mono mt-0.5">Allow new users to create accounts from the login screen.</p>
        </div>
        <button
          onClick={toggleRegistration}
          className={`relative w-11 h-6 rounded-full transition-colors ${registrationEnabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${registrationEnabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {/* Create user form */}
      {showCreate && (
        <div className="p-4 rounded-xl bg-black/40 border border-zinc-800 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Username"
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:border-purple-500/50 outline-none"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Password (min 8 chars)"
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:border-purple-500/50 outline-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300 outline-none"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <button
              onClick={handleCreate}
              className="px-4 py-2 rounded-lg bg-purple-500 text-black text-xs font-bold uppercase tracking-widest hover:bg-purple-400 transition-all"
            >
              Create
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateError(''); }}
              className="px-4 py-2 rounded-lg border border-zinc-800 text-xs font-bold text-zinc-500 uppercase tracking-widest hover:bg-zinc-800 transition-all"
            >
              Cancel
            </button>
          </div>
          {createError && <p className="text-[10px] text-red-400">{createError}</p>}
        </div>
      )}

      {/* User list */}
      <div className="space-y-1">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-zinc-800/50 group">
            <div className="flex items-center gap-3">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                u.role === 'admin' ? 'bg-amber-500/20' : 'bg-zinc-800'
              }`}>
                {u.role === 'admin' ? <Shield className="w-3.5 h-3.5 text-amber-500" /> : <UserIcon className="w-3.5 h-3.5 text-zinc-500" />}
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">{u.username}</p>
                <p className="text-[10px] text-zinc-500 font-mono">{u.role} &middot; {new Date(u.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {resetUserId === u.id ? (
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="New password"
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-300 w-36 outline-none focus:border-purple-500/50"
                    onKeyDown={(e) => e.key === 'Enter' && handleResetPassword()}
                  />
                  <button onClick={handleResetPassword} className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300">Save</button>
                  <button onClick={() => { setResetUserId(null); setResetError(''); }} className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300">Cancel</button>
                  {resetError && <span className="text-[10px] text-red-400">{resetError}</span>}
                </div>
              ) : (
                <>
                  <button
                    onClick={() => { setResetUserId(u.id); setResetPassword(''); setResetError(''); }}
                    className="p-1.5 hover:bg-zinc-700 rounded-lg text-zinc-500 hover:text-amber-400 transition-colors"
                    title="Reset password"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                  </button>
                  {u.role !== 'admin' && (
                    <button
                      onClick={() => handleDelete(u.id, u.username)}
                      className="p-1.5 hover:bg-zinc-700 rounded-lg text-zinc-500 hover:text-red-400 transition-colors"
                      title="Delete user"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
