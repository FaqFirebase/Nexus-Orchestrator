import { useState, useCallback } from 'react';
import type { ConnectionStatus, NexusConfig, User } from '../types';
import { DEFAULT_CONFIG } from '../constants';

interface UseConnectionDeps {
  showLoginModal: boolean;
  setAuthRequired: (v: boolean) => void;
  setIsAuthorized: (v: boolean) => void;
  setShowLoginModal: (v: boolean) => void;
  setConfig: (cfg: NexusConfig) => void;
  setUser: (u: User | null) => void;
  setRegistrationEnabled: (v: boolean) => void;
  clearConversationState: () => void;
}

export function useConnection(deps: UseConnectionDeps) {
  const { showLoginModal, setAuthRequired, setIsAuthorized, setShowLoginModal, setConfig, setUser, setRegistrationEnabled, clearConversationState } = deps;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ status: 'checking' });
  const [localModels, setLocalModels] = useState<any[]>([]);
  const [pingResult, setPingResult] = useState<{ time?: number; error?: string } | null>(null);
  const [isPinging, setIsPinging] = useState(false);

  const checkConnection = useCallback(async (includeConfig = true) => {
    try {
      const authStatusRes = await fetch(`${window.location.origin}/api/auth/status`);
      const authStatus = await authStatusRes.json();
      setAuthRequired(authStatus.authRequired);
      setRegistrationEnabled(authStatus.registrationEnabled || false);

      // If already authenticated via cookie, the server tells us
      if (authStatus.authRequired && !authStatus.isAuthenticated) {
        clearConversationState();
        setConfig(DEFAULT_CONFIG);
        setIsAuthorized(false);
        setUser(null);
        if (!showLoginModal) setShowLoginModal(true);
        return;
      }

      // Set user info from auth status
      if (authStatus.user) {
        setUser(authStatus.user);
      }

      const res = await fetch(`${window.location.origin}/api/health`);

      if (res.status === 401) {
        clearConversationState();
        setConfig(DEFAULT_CONFIG);
        setIsAuthorized(false);
        setUser(null);
        if (!showLoginModal) setShowLoginModal(true);
        return;
      }

      setIsAuthorized(true);
      const data = await res.json();
      setConnectionStatus(data);

      if (includeConfig) {
        const configRes = await fetch(`${window.location.origin}/api/config`);
        if (configRes.ok) {
          const configData = await configRes.json();
          setConfig({
            ...DEFAULT_CONFIG,
            ...configData,
            router: {
              ...DEFAULT_CONFIG.router,
              ...(configData.router || {})
            },
            categories: {
              ...DEFAULT_CONFIG.categories,
              ...(configData.categories || {})
            }
          });
        }
      }

      if (data.status === 'connected') {
        const modelsRes = await fetch(`${window.location.origin}/api/models`);
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json();
          setLocalModels(modelsData);
        }
      }
    } catch (err) {
      setConnectionStatus({ status: 'error', message: 'Failed to reach proxy' });
    }
  }, [showLoginModal, setAuthRequired, setIsAuthorized, setShowLoginModal, setConfig, setUser, setRegistrationEnabled, clearConversationState]);

  const runPing = useCallback(async () => {
    setIsPinging(true);
    setPingResult(null);
    const start = Date.now();
    try {
      const res = await fetch(`${window.location.origin}/api/health`);
      if (res.ok) {
        setPingResult({ time: Date.now() - start });
      } else {
        setPingResult({ error: `HTTP ${res.status}` });
      }
    } catch (err: any) {
      setPingResult({ error: err.message });
    } finally {
      setIsPinging(false);
    }
  }, []);

  return {
    connectionStatus,
    localModels,
    pingResult,
    isPinging,
    checkConnection,
    runPing,
  };
}
