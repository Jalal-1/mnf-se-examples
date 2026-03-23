import React, { useState, useCallback } from 'react';
import { useWallet } from '../contexts/WalletContext.js';
import * as counterApi from '../lib/counter-api.js';
import type { DeployedCounterContract } from '../lib/counter-api.js';

function extractError(e: unknown, depth = 0): string {
  if (depth > 5) return '';
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause ? ` → ${extractError(e.cause, depth + 1)}` : '';
  return `${e.message}${cause}`;
}

interface Props {
  onLog: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export function CounterTab({ onLog }: Props) {
  const { providers } = useWallet();
  const [contract, setContract] = useState<DeployedCounterContract | null>(null);
  const [contractAddress, setContractAddress] = useState('');
  const [counterValue, setCounterValue] = useState<bigint | null>(null);
  const [joinAddress, setJoinAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [lastTxId, setLastTxId] = useState('');
  const [copied, setCopied] = useState(false);

  const refreshState = useCallback(async (addr: string) => {
    if (!providers) return;
    const value = await counterApi.getCounterLedgerState(providers, addr);
    setCounterValue(value);
  }, [providers]);

  const handleDeploy = useCallback(async () => {
    if (!providers) return;
    setIsLoading(true);
    setLoadingMsg('Deploying contract (generating ZK proof)...');
    onLog('Deploying new counter contract...');
    try {
      const deployed = await counterApi.deploy(providers);
      const addr = deployed.deployTxData.public.contractAddress;
      setContract(deployed);
      setContractAddress(addr);
      await refreshState(addr);
      onLog(`Contract deployed at ${addr.substring(0, 20)}...`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Deploy failed: ${msg}`, 'error');
      console.error('Deploy error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [providers, onLog, refreshState]);

  const handleJoin = useCallback(async () => {
    if (!providers || !joinAddress.trim()) return;
    setIsLoading(true);
    setLoadingMsg('Joining contract...');
    onLog(`Joining contract ${joinAddress.substring(0, 20)}...`);
    try {
      const found = await counterApi.joinContract(providers, joinAddress.trim());
      setContract(found);
      setContractAddress(joinAddress.trim());
      await refreshState(joinAddress.trim());
      onLog('Successfully joined contract', 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Join failed: ${msg}`, 'error');
      console.error('Join error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [providers, joinAddress, onLog, refreshState]);

  const handleIncrement = useCallback(async () => {
    if (!contract) return;
    setIsLoading(true);
    setLoadingMsg('Generating ZK proof and submitting...');
    onLog('Incrementing counter...');
    try {
      const txId = await counterApi.increment(contract);
      setLastTxId(txId);
      await refreshState(contractAddress);
      onLog(`Counter incremented (tx: ${txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Increment failed: ${msg}`, 'error');
      console.error('Increment error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, contractAddress, onLog, refreshState]);

  const handleRefresh = useCallback(async () => {
    if (!contractAddress) return;
    onLog('Refreshing counter state...');
    await refreshState(contractAddress);
    onLog('Counter state refreshed', 'success');
  }, [contractAddress, onLog, refreshState]);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(contractAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ── No contract yet: deploy or join ──────────────────────────────
  if (!contract) {
    return (
      <div className="max-w-2xl mx-auto mt-16 px-4 space-y-6">
        <h2 className="text-2xl font-bold text-center mb-8">Counter</h2>

        {isLoading && (
          <div className="card text-center">
            <div className="flex items-center justify-center gap-3">
              <div className="spinner" />
              <span className="text-gray-300">{loadingMsg}</span>
            </div>
          </div>
        )}

        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card text-center">
              <h3 className="text-lg font-semibold mb-2">Deploy New</h3>
              <p className="text-sm text-gray-400 mb-6">
                Create a fresh counter contract on-chain
              </p>
              <button onClick={handleDeploy} className="btn-primary w-full">
                Deploy Counter
              </button>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold mb-2">Join Existing</h3>
              <p className="text-sm text-gray-400 mb-4">
                Connect to a deployed counter by address
              </p>
              <input
                type="text"
                value={joinAddress}
                onChange={(e) => setJoinAddress(e.target.value)}
                placeholder="Contract address"
                className="input mb-3"
              />
              <button
                onClick={handleJoin}
                disabled={!joinAddress.trim()}
                className="btn-primary w-full"
              >
                Join
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Contract connected: show counter ─────────────────────────────
  return (
    <div className="max-w-lg mx-auto mt-16 px-4">
      <div className="card text-center">
        {/* Counter value */}
        <div className="mb-8">
          <p className="text-sm text-gray-400 mb-2 uppercase tracking-wider">Counter Value</p>
          <p className="text-7xl font-bold text-white tabular-nums">
            {counterValue?.toString() ?? '...'}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-center mb-8">
          <button
            onClick={handleIncrement}
            disabled={isLoading}
            className="btn-primary px-8"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <div className="spinner !w-4 !h-4 !border-white/30 !border-t-white" />
                {loadingMsg || 'Processing...'}
              </span>
            ) : (
              'Increment'
            )}
          </button>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="btn-secondary"
          >
            Refresh
          </button>
        </div>

        {/* Contract info */}
        <div className="border-t border-midnight-600 pt-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Contract</span>
            <button
              onClick={copyAddress}
              className="font-mono text-gray-300 hover:text-white text-xs transition-colors"
            >
              {copied ? 'Copied!' : contractAddress.substring(0, 24) + '...'}
            </button>
          </div>
          {lastTxId && (
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Last Tx</span>
              <span className="font-mono text-gray-500 text-xs">
                {lastTxId.substring(0, 24)}...
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
