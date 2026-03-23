import React, { useState } from 'react';
import { TabBar } from './TabBar.js';
import { StatusBar } from './StatusBar.js';
import { ActivityLog } from './ActivityLog.js';
import { useActivityLog } from '../hooks/useActivityLog.js';
import { CounterTab } from '../tabs/CounterTab.js';
import { UnshieldedUtxoTab } from '../tabs/UnshieldedUtxoTab.js';
import { ShieldedUtxoTab } from '../tabs/ShieldedUtxoTab.js';
import { FungibleTokenTab } from '../tabs/FungibleTokenTab.js';
import { NftTab } from '../tabs/NftTab.js';
import { MultiTokenTab } from '../tabs/MultiTokenTab.js';
import { AccessControlTab } from '../tabs/AccessControlTab.js';
import { ElectionTab } from '../tabs/ElectionTab.js';

export function Layout() {
  const [activeTab, setActiveTab] = useState('counter');
  const { entries, addEntry, clear } = useActivityLog();

  return (
    <div className="flex flex-col h-screen">
      <StatusBar />
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* All tabs rendered, inactive ones hidden — preserves state across switches */}
      <div className="flex-1 overflow-y-auto">
        <div className={activeTab === 'counter' ? '' : 'hidden'}>
          <CounterTab onLog={addEntry} />
        </div>
        <div className={activeTab === 'unshielded-utxo' ? '' : 'hidden'}>
          <UnshieldedUtxoTab onLog={addEntry} />
        </div>
        <div className={activeTab === 'shielded-utxo' ? '' : 'hidden'}>
          <ShieldedUtxoTab onLog={addEntry} />
        </div>
        <div className={activeTab === 'fungible-token' ? '' : 'hidden'}>
          <FungibleTokenTab onLog={addEntry} />
        </div>
        <div className={activeTab === 'nft' ? '' : 'hidden'}>
          <NftTab onLog={addEntry} />
        </div>
        <div className={activeTab === 'multi-token' ? '' : 'hidden'}>
          <MultiTokenTab onLog={addEntry} />
        </div>
        <div className={activeTab === 'access-control' ? '' : 'hidden'}>
          <AccessControlTab onLog={addEntry} />
        </div>
        <div className={activeTab === 'election' ? '' : 'hidden'}>
          <ElectionTab onLog={addEntry} />
        </div>
      </div>

      <ActivityLog entries={entries} onClear={clear} />
    </div>
  );
}
