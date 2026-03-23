import React from 'react';
import { WalletProvider, useWallet } from './contexts/WalletContext.js';
import { WalletConnect } from './components/WalletConnect.js';
import { Layout } from './components/Layout.js';

function AppContent() {
  const { mode } = useWallet();

  if (mode === 'disconnected') {
    return <WalletConnect />;
  }

  return <Layout />;
}

export default function App() {
  return (
    <WalletProvider>
      <AppContent />
    </WalletProvider>
  );
}
