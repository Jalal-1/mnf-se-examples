import React, { useState } from 'react';
import { useWallet } from '../contexts/WalletContext.js';

function truncateAddr(addr: string): string {
  if (addr.length <= 20) return addr;
  return addr.slice(0, 12) + '...' + addr.slice(-8);
}

export function StatusBar() {
  const { mode, network, walletAddress, nightBalance, disconnect } = useWallet();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="bg-midnight-800 border-b border-midnight-600 px-4 py-2.5 flex items-center justify-between text-sm">
      <div className="flex items-center gap-6">
        {/* Connection indicator */}
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-midnight-success animate-pulse" />
          <span className="text-gray-400">
            {mode === 'lace' ? 'Lace' : 'Seed'} &middot; {network?.name}
          </span>
        </div>

        {/* Address */}
        {walletAddress && (
          <button
            onClick={handleCopy}
            className="font-mono text-gray-400 hover:text-white transition-colors"
            title={walletAddress}
          >
            {copied ? 'Copied!' : truncateAddr(walletAddress)}
          </button>
        )}

        {/* Balance */}
        {nightBalance > 0n && (
          <span className="text-gray-400">
            NIGHT: <span className="text-white">{nightBalance.toLocaleString()}</span>
          </span>
        )}
      </div>

      <button
        onClick={disconnect}
        className="text-gray-500 hover:text-red-400 transition-colors text-xs"
      >
        Disconnect
      </button>
    </div>
  );
}
