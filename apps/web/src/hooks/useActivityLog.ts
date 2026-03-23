import { useState, useCallback } from 'react';

export interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

let nextId = 0;

export function useActivityLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const addEntry = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const entry: LogEntry = {
      id: nextId++,
      timestamp: new Date().toLocaleTimeString(),
      message,
      type,
    };
    setEntries((prev) => [...prev, entry]);
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, addEntry, clear };
}
