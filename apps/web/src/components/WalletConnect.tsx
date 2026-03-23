import React, { useState } from 'react';
import { useWallet } from '../contexts/WalletContext.js';
import { useWalletDetection } from '../hooks/useWalletDetection.js';
import { NetworkSelector } from './NetworkSelector.js';
import { NETWORKS, type NetworkConfig } from '../lib/config.js';

const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

export function WalletConnect() {
  const { connectLace, connectSeed, isConnecting, statusMessage, error } = useWallet();
  const { wallets, isSearching } = useWalletDetection();
  const [networkKey, setNetworkKey] = useState('standalone');
  const [seed, setSeed] = useState('');
  const network = NETWORKS[networkKey];

  const handleNetworkChange = (key: string, _config: NetworkConfig) => {
    setNetworkKey(key);
  };

  return (
    <div className="max-w-4xl mx-auto mt-16 px-4">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-2">MNF Examples</h1>
        <p className="text-gray-400">Midnight Network Solutions Engineering</p>
      </div>

      {/* Network */}
      <div className="flex justify-center mb-8">
        <NetworkSelector
          selected={networkKey}
          onChange={handleNetworkChange}
          disabled={isConnecting}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="card border-red-500/50 bg-red-950/20 mb-6 text-center">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Connecting overlay */}
      {isConnecting && (
        <div className="card mb-6 text-center">
          <div className="flex items-center justify-center gap-3">
            <div className="spinner" />
            <span className="text-gray-300">{statusMessage || 'Connecting...'}</span>
          </div>
        </div>
      )}

      {/* Two wallet cards */}
      {!isConnecting && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Lace card */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-1">Lace Wallet</h2>
            <p className="text-sm text-gray-400 mb-6">
              Connect via browser extension
            </p>

            {isSearching ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <div className="spinner" />
                <span>Detecting wallet...</span>
              </div>
            ) : wallets.length > 0 ? (
              <div className="space-y-3">
                {wallets.map((w, i) => (
                  <button
                    key={i}
                    onClick={() => connectLace(w, network)}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    Connect {w.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                No Midnight wallet detected. Install the Lace browser extension.
              </p>
            )}
          </div>

          {/* Seed card */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-1">Seed Wallet</h2>
            <p className="text-sm text-gray-400 mb-6">
              Enter a hex seed (no extension needed)
            </p>

            <div className="space-y-3">
              <input
                type="text"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="Hex seed (64+ chars)"
                className="input"
              />

              <div className="flex gap-2">
                <button
                  onClick={() => connectSeed(seed || GENESIS_SEED, network)}
                  className="btn-primary flex-1"
                  disabled={!seed && networkKey !== 'standalone'}
                >
                  {seed ? 'Connect' : 'Use Genesis Seed'}
                </button>
              </div>

              {networkKey === 'standalone' && !seed && (
                <p className="text-xs text-gray-500">
                  Genesis seed is pre-funded on standalone
                </p>
              )}
              {networkKey !== 'standalone' && !seed && (
                <p className="text-xs text-gray-500">
                  Enter your seed or generate one, then fund via faucet
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
