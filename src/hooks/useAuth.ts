import { useState, useCallback } from 'react';
import type { User } from '../types';

export function useAuth() {
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [isAuthorized, setIsAuthorized] = useState<boolean>(true);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [user, setUser] = useState<User | null>(null);
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean>(false);

  const handleLogin = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch(`${window.location.origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setIsAuthorized(true);
        setShowLoginModal(false);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const handleRegister = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch(`${window.location.origin}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        setUser(data.user);
        setIsAuthorized(true);
        setShowLoginModal(false);
        return { success: true };
      }
      return { success: false, error: data.error || 'Registration failed' };
    } catch {
      return { success: false, error: 'Network error' };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${window.location.origin}/api/auth/logout`, { method: 'POST' });
    } catch { /* ignore */ }
    setUser(null);
    setIsAuthorized(false);
    setShowLoginModal(true);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      const res = await fetch(`${window.location.origin}/api/auth/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) return { success: true };
      return { success: false, error: data.error || 'Failed to change password' };
    } catch {
      return { success: false, error: 'Network error' };
    }
  }, []);

  return {
    authRequired,
    setAuthRequired,
    isAuthorized,
    setIsAuthorized,
    showLoginModal,
    setShowLoginModal,
    user,
    setUser,
    registrationEnabled,
    setRegistrationEnabled,
    handleLogin,
    handleRegister,
    logout,
    changePassword,
  };
}
