import React from 'react';

export interface Tab {
  id: string;
  label: string;
  available: boolean;
}

const TABS: Tab[] = [
  { id: 'counter', label: 'Counter', available: true },
  { id: 'unshielded-utxo', label: 'Unshielded UTXO', available: true },
  { id: 'shielded-utxo', label: 'Shielded UTXO', available: true },
  { id: 'fungible-token', label: 'Fungible Token', available: true },
  { id: 'nft', label: 'NFT', available: true },
  { id: 'multi-token', label: 'Multi Token', available: true },
  { id: 'access-control', label: 'Access Control', available: true },
  { id: 'election', label: 'Election', available: true },
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
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-midnight-500'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
