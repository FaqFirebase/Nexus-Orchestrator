import { useState, useCallback } from 'react';

export function useAuth() {
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [isAuthorized, setIsAuthorized] = useState<boolean>(true);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);

  const handleLogin = useCallback(async (key: string) => {
    try {
      const res = await fetch(`${window.location.origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        setIsAuthorized(true);
        setShowLoginModal(false);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${window.location.origin}/api/auth/logout`, { method: 'POST' });
    } catch { /* ignore */ }
    setIsAuthorized(false);
    setShowLoginModal(true);
  }, []);

  return {
    authRequired,
    setAuthRequired,
    isAuthorized,
    setIsAuthorized,
    showLoginModal,
    setShowLoginModal,
    handleLogin,
    logout,
  };
}
