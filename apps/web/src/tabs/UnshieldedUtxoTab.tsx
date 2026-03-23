import React, { useState, useCallback, useRef } from 'react';
import { useWallet } from '../contexts/WalletContext.js';
import { buildContractProviders, type SharedProviders } from '../lib/build-providers.js';
import { Token, type TokenPrivateState, createWitnesses } from '@mnf-se/token-contract';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';

function extractError(e: unknown, depth = 0): string {
  if (depth > 5) return '';
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause ? ` → ${extractError(e.cause, depth + 1)}` : '';
  return `${e.message}${cause}`;
}

// ── Types ──────────────────────────────────────────────────────────────
type TokenCircuits = 'mint' | 'mint_unshielded' | 'burn' | 'get_color';
const TokenPrivateStateId = 'tokenPrivateState';
type TokenProviders = MidnightProviders<TokenCircuits, typeof TokenPrivateStateId, TokenPrivateState>;
type DeployedTokenContract = DeployedContract<Token.Contract<TokenPrivateState>> | FoundContract<Token.Contract<TokenPrivateState>>;

interface Props {
  onLog: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export function UnshieldedUtxoTab({ onLog }: Props) {
  const { shared } = useWallet();
  const providersRef = useRef<TokenProviders | null>(null);
  const secretKeyRef = useRef<Uint8Array | null>(null);

  const [contract, setContract] = useState<DeployedTokenContract | null>(null);
  const [contractAddress, setContractAddress] = useState('');
  const [joinAddress, setJoinAddress] = useState('');
  const [tokenName, setTokenName] = useState('mytoken');
  const [mintAmount, setMintAmount] = useState('100');
  const [recipientAddr, setRecipientAddr] = useState('');
  const [tokenState, setTokenState] = useState<{ domainSeparator: string; unshieldedSupply: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [lastTxId, setLastTxId] = useState('');
  const [copied, setCopied] = useState(false);

  const getProviders = useCallback((): TokenProviders => {
    if (providersRef.current) return providersRef.current;
    if (!shared) throw new Error('Wallet not connected');
    const secretKey = new Uint8Array(32);
    crypto.getRandomValues(secretKey);
    secretKeyRef.current = secretKey;
    const witnesses = createWitnesses();
    const compiled = CompiledContract.make('Token', Token.Contract).pipe(
      CompiledContract.withWitnesses(witnesses),
      CompiledContract.withCompiledFileAssets('./contract/token'),
    );
    const providers = buildContractProviders<TokenCircuits>('contract/token', shared);
    providersRef.current = providers;
    return providers;
  }, [shared]);

  const refreshState = useCallback(async (addr: string) => {
    try {
      const providers = getProviders();
      const state = await providers.publicDataProvider.queryContractState(addr as ContractAddress);
      if (state) {
        const stateArr = (state as any).data.state.asArray()!;
        const { CompactTypeBytes, CompactTypeUnsignedInteger } = await import('@midnight-ntwrk/compact-runtime');
        const bytesType = new CompactTypeBytes(32);
        const uintType = new CompactTypeUnsignedInteger(18446744073709551615n, 8);
        const dsCell = stateArr[3]!.asCell()!;
        const dsBytes = bytesType.fromValue([...dsCell.value]);
        const domainSeparator = new TextDecoder().decode(dsBytes).replace(/\0+$/, '');
        const unshieldedCell = stateArr[2]!.asCell()!;
        const unshieldedSupply = uintType.fromValue([...unshieldedCell.value]);
        setTokenState({ domainSeparator, unshieldedSupply: unshieldedSupply.toString() });
      }
    } catch (e) {
      console.warn('Failed to refresh state:', e);
    }
  }, [getProviders]);

  const handleDeploy = useCallback(async () => {
    if (!shared) return;
    setIsLoading(true);
    setLoadingMsg('Deploying token contract (generating ZK proof)...');
    onLog(`Deploying unshielded token "${tokenName}"...`);
    try {
      const providers = getProviders();
      const secretKey = secretKeyRef.current!;
      const witnesses = createWitnesses();
      const compiled = CompiledContract.make('Token', Token.Contract).pipe(
        CompiledContract.withWitnesses(witnesses),
        CompiledContract.withCompiledFileAssets('./contract/token'),
      );
      const domainSepBytes = new Uint8Array(32);
      const encoder = new TextEncoder();
      domainSepBytes.set(encoder.encode(tokenName.substring(0, 32)));
      const deployed = await deployContract(providers as any, {
        compiledContract: compiled,
        privateStateId: TokenPrivateStateId,
        initialPrivateState: { secretKey },
        args: [domainSepBytes],
      });
      const addr = deployed.deployTxData.public.contractAddress;
      setContract(deployed as any);
      setContractAddress(addr);
      await refreshState(addr);
      onLog(`Token deployed at ${addr.substring(0, 20)}...`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Deploy failed: ${msg}`, 'error');
      console.error('Deploy error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [shared, tokenName, onLog, getProviders, refreshState]);

  const handleJoin = useCallback(async () => {
    if (!shared || !joinAddress.trim()) return;
    setIsLoading(true);
    setLoadingMsg('Joining token contract...');
    onLog(`Joining token contract ${joinAddress.substring(0, 20)}...`);
    try {
      const providers = getProviders();
      const secretKey = secretKeyRef.current!;
      const witnesses = createWitnesses();
      const compiled = CompiledContract.make('Token', Token.Contract).pipe(
        CompiledContract.withWitnesses(witnesses),
        CompiledContract.withCompiledFileAssets('./contract/token'),
      );
      const found = await findDeployedContract(providers as any, {
        contractAddress: joinAddress.trim(),
        compiledContract: compiled,
        privateStateId: TokenPrivateStateId,
        initialPrivateState: { secretKey },
      });
      setContract(found as any);
      setContractAddress(joinAddress.trim());
      await refreshState(joinAddress.trim());
      onLog('Successfully joined token contract', 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Join failed: ${msg}`, 'error');
      console.error('Join error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [shared, joinAddress, onLog, getProviders, refreshState]);

  const handleMintUnshielded = useCallback(async () => {
    if (!contract) return;
    const amount = parseInt(mintAmount, 10);
    if (!amount || amount <= 0) {
      onLog('Amount must be greater than zero', 'error');
      return;
    }
    setIsLoading(true);
    setLoadingMsg('Minting unshielded tokens (generating ZK proof)...');
    onLog(`Minting ${amount} unshielded tokens...`);
    try {
      // Use own wallet address as default recipient if not specified
      const recipientBytes = new Uint8Array(32);
      if (recipientAddr.trim()) {
        const hex = recipientAddr.trim().replace(/^0x/, '');
        for (let i = 0; i < Math.min(hex.length / 2, 32); i++) {
          recipientBytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
      }
      const result = await contract.callTx.mint_unshielded(BigInt(amount), { bytes: recipientBytes });
      setLastTxId(result.public.txId);
      await refreshState(contractAddress);
      onLog(`Minted ${amount} unshielded tokens (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Mint unshielded failed: ${msg}`, 'error');
      console.error('Mint unshielded error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, contractAddress, mintAmount, recipientAddr, onLog, refreshState]);

  const handleRefresh = useCallback(async () => {
    if (!contractAddress) return;
    onLog('Refreshing token state...');
    await refreshState(contractAddress);
    onLog('Token state refreshed', 'success');
  }, [contractAddress, onLog, refreshState]);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(contractAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ── No contract yet: deploy or join ──────────────────────────────────
  if (!contract) {
    return (
      <div className="max-w-2xl mx-auto mt-16 px-4 space-y-6">
        <h2 className="text-2xl font-bold text-center mb-8">Unshielded UTXO Token</h2>

        <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-4 text-sm text-yellow-200">
          <strong>Warning:</strong> Known issue: mintUnshieldedToken may fail with error 186.
          See <span className="font-mono text-yellow-300">compact#235</span> for details.
        </div>

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
            <div className="card">
              <h3 className="text-lg font-semibold mb-2">Deploy New</h3>
              <p className="text-sm text-gray-400 mb-4">
                Create a new unshielded token contract
              </p>
              <input
                type="text"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="Token name (e.g. mytoken)"
                className="input mb-3"
              />
              <button onClick={handleDeploy} className="btn-primary w-full">
                Deploy Token
              </button>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold mb-2">Join Existing</h3>
              <p className="text-sm text-gray-400 mb-4">
                Connect to a deployed token by address
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

  // ── Contract connected: show token interaction ────────────────────────
  return (
    <div className="max-w-lg mx-auto mt-16 px-4">
      <div className="card">
        <h2 className="text-xl font-bold text-center mb-6">Unshielded UTXO Token</h2>

        <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-3 text-xs text-yellow-200 mb-6">
          <strong>Warning:</strong> mintUnshieldedToken may fail with error 186.
        </div>

        {/* Token state */}
        <div className="space-y-3 mb-8">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Token Name</span>
            <span className="text-white font-mono">{tokenState?.domainSeparator ?? '...'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Unshielded Supply</span>
            <span className="text-white font-mono">{tokenState?.unshieldedSupply ?? '...'}</span>
          </div>
        </div>

        {/* Mint unshielded */}
        <div className="border-t border-midnight-600 pt-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Mint Unshielded Tokens</h3>
          <input
            type="number"
            value={mintAmount}
            onChange={(e) => setMintAmount(e.target.value)}
            placeholder="Amount"
            className="input mb-2"
            min="1"
          />
          <input
            type="text"
            value={recipientAddr}
            onChange={(e) => setRecipientAddr(e.target.value)}
            placeholder="Recipient address (hex, defaults to own)"
            className="input mb-3"
          />
          <div className="flex gap-3">
            <button
              onClick={handleMintUnshielded}
              disabled={isLoading}
              className="btn-primary flex-1"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <div className="spinner !w-4 !h-4 !border-white/30 !border-t-white" />
                  {loadingMsg || 'Processing...'}
                </span>
              ) : (
                'Mint Unshielded'
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
