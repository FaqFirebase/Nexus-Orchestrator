import { useState } from 'react';

type Tab = 'chat' | 'models' | 'system';

const VALID_TABS = new Set<Tab>(['chat', 'models', 'system']);
const LS_KEY = 'nexus:active-tab';

function readTab(): Tab {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v && VALID_TABS.has(v as Tab) ? (v as Tab) : 'chat';
  } catch {
    return 'chat';
  }
}

export function usePersistentTab(): [Tab, (tab: Tab) => void] {
  const [activeTab, setActiveTabState] = useState<Tab>(readTab);

  function setActiveTab(tab: Tab) {
    try { localStorage.setItem(LS_KEY, tab); } catch { /* ignore */ }
    setActiveTabState(tab);
  }

  return [activeTab, setActiveTab];
}
