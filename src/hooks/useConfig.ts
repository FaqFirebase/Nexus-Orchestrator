import { useState, useCallback } from 'react';
import type { NexusConfig, ModelCategory } from '../types';
import { DEFAULT_CONFIG } from '../constants';

interface UseConfigDeps {
  setIsAuthorized: (v: boolean) => void;
  setShowLoginModal: (v: boolean) => void;
  checkConnection: () => void;
}

export function useConfig(deps: UseConfigDeps) {
  const { setIsAuthorized, setShowLoginModal, checkConnection } = deps;

  const [config, setConfig] = useState<NexusConfig>(DEFAULT_CONFIG);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const saveConfig = useCallback(async (newConfig: NexusConfig) => {
    if (!newConfig || typeof newConfig !== 'object') {
      console.error('Attempted to save invalid config', newConfig);
      return;
    }
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const res = await fetch(`${window.location.origin}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      if (res.ok) {
        setConfig(newConfig);
        setSaveStatus('success');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else if (res.status === 401) {
        setIsAuthorized(false);
        setShowLoginModal(true);
        setSaveStatus('error');
        setSaveError('Unauthorized: Invalid Admin API Key');
      } else {
        const errorData = await res.json().catch(() => ({}));
        setSaveError(errorData.error || `Server error: ${res.status}`);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 8000);
      }
    } catch (err: any) {
      setSaveError(err.message || 'Network error');
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 8000);
    }
    checkConnection();
  }, [setIsAuthorized, setShowLoginModal, checkConnection]);

  const addCategory = useCallback(() => {
    if (!newCategoryName.trim()) return;
    const updated = { ...config };
    updated.categories[newCategoryName.trim().toUpperCase()] = {
      models: [],
      provider: 'local'
    };
    saveConfig(updated);
    setNewCategoryName('');
  }, [newCategoryName, config, saveConfig]);

  const removeCategory = useCallback((cat: string) => {
    const updated = { ...config };
    delete updated.categories[cat];
    saveConfig(updated);
  }, [config, saveConfig]);

  return {
    config,
    setConfig,
    saveStatus,
    saveError,
    showApiKey,
    setShowApiKey,
    newCategoryName,
    setNewCategoryName,
    saveConfig,
    addCategory,
    removeCategory,
  };
}
