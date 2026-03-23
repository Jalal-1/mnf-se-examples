import React, { useState, type ReactNode } from 'react';
import { TabBar } from './TabBar.js';
import { StatusBar } from './StatusBar.js';
import { ActivityLog } from './ActivityLog.js';
import { useActivityLog } from '../hooks/useActivityLog.js';
import { CounterTab } from '../tabs/CounterTab.js';
import { PlaceholderTab } from '../tabs/PlaceholderTab.js';

export function Layout() {
  const [activeTab, setActiveTab] = useState('counter');
  const { entries, addEntry, clear } = useActivityLog();

  const renderTab = () => {
    switch (activeTab) {
      case 'counter':
        return <CounterTab onLog={addEntry} />;
      default:
        return <PlaceholderTab name={activeTab} />;
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <StatusBar />
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {renderTab()}
      </div>

      <ActivityLog entries={entries} onClear={clear} />
    </div>
  );
}
