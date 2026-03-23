import React from 'react';

export interface Tab {
  id: string;
  label: string;
  available: boolean;
}

const TABS: Tab[] = [
  { id: 'counter', label: 'Counter', available: true },
  { id: 'token', label: 'Token', available: false },
  { id: 'election', label: 'Election', available: false },
  { id: 'fungible-token', label: 'Fungible Token', available: false },
  { id: 'nft', label: 'NFT', available: false },
  { id: 'multi-token', label: 'Multi Token', available: false },
  { id: 'access-control', label: 'Access Control', available: false },
];

interface Props {
  activeTab: string;
  onTabChange: (id: string) => void;
}

export function TabBar({ activeTab, onTabChange }: Props) {
  return (
    <div className="border-b border-midnight-600 bg-midnight-900">
      <div className="flex gap-0 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors
              border-b-2 -mb-px
              ${
                activeTab === tab.id
                  ? 'border-midnight-accent text-white'
                  : tab.available
                    ? 'border-transparent text-gray-400 hover:text-gray-200 hover:border-midnight-500'
                    : 'border-transparent text-gray-600 cursor-default'
              }
            `}
          >
            {tab.label}
            {!tab.available && (
              <span className="ml-1.5 text-[10px] text-gray-600 uppercase">soon</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
