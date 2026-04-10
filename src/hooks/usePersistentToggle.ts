import { useState } from 'react';

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'true';
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean): void {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}

export function usePersistentToggle(key: string, defaultValue: boolean): [boolean, () => void] {
  const [value, setValue] = useState<boolean>(() => readBool(key, defaultValue));

  function toggle() {
    setValue(prev => {
      const next = !prev;
      writeBool(key, next);
      return next;
    });
  }

  return [value, toggle];
}
