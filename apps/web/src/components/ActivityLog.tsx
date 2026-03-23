import React, { useState, useRef, useEffect } from 'react';
import type { LogEntry } from '../hooks/useActivityLog.js';

interface Props {
  entries: LogEntry[];
  onClear: () => void;
}

export function ActivityLog({ entries, onClear }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && isOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, isOpen]);

  if (entries.length === 0) return null;

  return (
    <div className="border-t border-midnight-600 bg-midnight-900">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2 flex items-center justify-between text-xs text-gray-400 hover:text-gray-300"
      >
        <span>Activity Log ({entries.length})</span>
        <div className="flex gap-2">
          {isOpen && (
            <span
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="hover:text-red-400 cursor-pointer"
            >
              Clear
            </span>
          )}
          <span>{isOpen ? '\u25b2' : '\u25bc'}</span>
        </div>
      </button>

      {isOpen && (
        <div ref={scrollRef} className="max-h-48 overflow-y-auto px-4 pb-3 space-y-0.5">
          {entries.map((entry) => {
            const color =
              entry.type === 'success' ? 'text-midnight-success'
                : entry.type === 'error' ? 'text-red-400'
                  : 'text-gray-400';
            return (
              <div key={entry.id} className="flex gap-2 text-xs font-mono">
                <span className="text-gray-600 shrink-0">{entry.timestamp}</span>
                <span className={color}>{entry.message}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
