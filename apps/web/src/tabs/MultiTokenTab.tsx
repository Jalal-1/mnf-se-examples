import React, { useState, useCallback, useRef } from 'react';
import { useWallet } from '../contexts/WalletContext.js';
import { buildContractProviders } from '../lib/build-providers.js';
import { MultiToken } from '@mnf-se/multi-token-contract';
import type { MultiTokenPrivateState } from '@mnf-se/multi-token-contract';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

function extractError(e: unknown, depth = 0): string {
  if (depth > 5) return '';
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause ? ` → ${extractError(e.cause, depth + 1)}` : '';
  return `${e.message}${cause}`;
}

// ── Types ──────────────────────────────────────────────────────────────
type MTCircuits = ProvableCircuitId<MultiToken.Contract<MultiTokenPrivateState>>;
const MTPrivateStateId = 'multiTokenPrivateState';
type MTProviders = MidnightProviders<MTCircuits, typeof MTPrivateStateId, MultiTokenPrivateState>;
type DeployedMT = DeployedContract<MultiToken.Contract<MultiTokenPrivateState>> | FoundContract<MultiToken.Contract<MultiTokenPrivateState>>;

type EitherAddr = { is_left: boolean; left: { bytes: Uint8Array }; right: { bytes: Uint8Array } };

function leftPublicKey(pubKeyBytes: Uint8Array): EitherAddr {
  return { is_left: true, left: { bytes: pubKeyBytes }, right: { bytes: new Uint8Array(32) } };
}

interface Props {
  onLog: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export function MultiTokenTab({ onLog }: Props) {
  const { shared } = useWallet();
  const providersRef = useRef<MTProviders | null>(null);
  const compiledRef = useRef<ReturnType<typeof CompiledContract.make> | null>(null);

  const [contract, setContract] = useState<DeployedMT | null>(null);
  const [contractAddress, setContractAddress] = useState('');
  const [joinAddress, setJoinAddress] = useState('');

  // Deploy inputs
  const [baseUri, setBaseUri] = useState('https://example.com/tokens/{id}.json');

  // Action inputs
  const [mintId, setMintId] = useState('1');
  const [mintAmount, setMintAmount] = useState('100');
  const [transferId, setTransferId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [queryId, setQueryId] = useState('');

  // Display state
  const [displayUri, setDisplayUri] = useState('');
  const [balanceResult, setBalanceResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [lastTxId, setLastTxId] = useState('');
  const [copied, setCopied] = useState(false);

  const getProviders = useCallback((): MTProviders => {
    if (providersRef.current) return providersRef.current;
    if (!shared) throw new Error('Wallet not connected');
    const providers = buildContractProviders<MTCircuits>('contract/multi-token', shared);
    providersRef.current = providers;
    return providers;
  }, [shared]);

  const getCompiled = useCallback(() => {
    if (compiledRef.current) return compiledRef.current;
    const compiled = CompiledContract.make('MultiToken', MultiToken.Contract).pipe(
      CompiledContract.withVacantWitnesses,
      CompiledContract.withCompiledFileAssets('./contract/multi-token'),
    );
    compiledRef.current = compiled as any;
    return compiled as any;
  }, []);

  const handleDeploy = useCallback(async () => {
    if (!shared) return;
    setIsLoading(true);
    setLoadingMsg('Deploying MultiToken contract (generating ZK proof)...');
    onLog(`Deploying MultiToken with URI "${baseUri}"...`);
    try {
      const providers = getProviders();
      const compiled = getCompiled();
      const deployed = await deployContract(providers as any, {
        compiledContract: compiled,
        privateStateId: MTPrivateStateId,
        initialPrivateState: {} as MultiTokenPrivateState,
        args: [baseUri],
      });
      const addr = deployed.deployTxData.public.contractAddress;
      setContract(deployed as any);
      setContractAddress(addr);
      setDisplayUri(baseUri);
      onLog(`MultiToken deployed at ${addr.substring(0, 20)}...`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Deploy failed: ${msg}`, 'error');
      console.error('Deploy error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [shared, baseUri, onLog, getProviders, getCompiled]);

  const handleJoin = useCallback(async () => {
    if (!shared || !joinAddress.trim()) return;
    setIsLoading(true);
    setLoadingMsg('Joining MultiToken contract...');
    onLog(`Joining MultiToken at ${joinAddress.substring(0, 20)}...`);
    try {
      const providers = getProviders();
      const compiled = getCompiled();
      const found = await findDeployedContract(providers as any, {
        contractAddress: joinAddress.trim(),
        compiledContract: compiled,
        privateStateId: MTPrivateStateId,
        initialPrivateState: {} as MultiTokenPrivateState,
      });
      setContract(found as any);
      setContractAddress(joinAddress.trim());
      onLog('Successfully joined MultiToken contract', 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Join failed: ${msg}`, 'error');
      console.error('Join error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [shared, joinAddress, onLog, getProviders, getCompiled]);

  const handleMint = useCallback(async () => {
    if (!contract || !shared) return;
    const id = BigInt(mintId || '0');
    const amount = BigInt(mintAmount || '0');
    if (amount <= 0n) {
      onLog('Amount must be greater than zero', 'error');
      return;
    }
    setIsLoading(true);
    setLoadingMsg('Minting tokens (generating ZK proof)...');
    onLog(`Minting ${mintAmount} of token #${mintId}...`);
    try {
      const recipientKey = shared.walletProvider.getCoinPublicKey() as unknown as Uint8Array;
      const to = leftPublicKey(recipientKey);
      const result = await contract.callTx.mint(to, id, amount);
      setLastTxId(result.public.txId);
      onLog(`Minted ${mintAmount} of #${mintId} (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Mint failed: ${msg}`, 'error');
      console.error('Mint error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, shared, mintId, mintAmount, onLog]);

  const handleTransfer = useCallback(async () => {
    if (!contract || !shared) return;
    if (!transferTo.trim()) {
      onLog('Recipient address is required', 'error');
      return;
    }
    const id = BigInt(transferId || '0');
    const amount = BigInt(transferAmount || '0');
    if (amount <= 0n) {
      onLog('Amount must be greater than zero', 'error');
      return;
    }
    setIsLoading(true);
    setLoadingMsg('Transferring tokens (generating ZK proof)...');
    onLog(`Transferring ${transferAmount} of token #${transferId}...`);
    try {
      const fromKey = shared.walletProvider.getCoinPublicKey() as unknown as Uint8Array;
      const from = leftPublicKey(fromKey);
      const hex = transferTo.trim().replace(/^0x/, '');
      const toBytes = new Uint8Array(32);
      for (let i = 0; i < Math.min(hex.length / 2, 32); i++) {
        toBytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
      }
      const to = leftPublicKey(toBytes);
      const result = await contract.callTx.transferFrom(from, to, id, amount);
      setLastTxId(result.public.txId);
      onLog(`Transferred ${transferAmount} of #${transferId} (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Transfer failed: ${msg}`, 'error');
      console.error('Transfer error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, shared, transferId, transferAmount, transferTo, onLog]);

  const handleBalanceOf = useCallback(async () => {
    if (!contract || !shared) return;
    const id = BigInt(queryId || '0');
    setIsLoading(true);
    setLoadingMsg('Querying balance...');
    onLog(`Querying balance of token #${queryId}...`);
    try {
      const recipientKey = shared.walletProvider.getCoinPublicKey() as unknown as Uint8Array;
      const account = leftPublicKey(recipientKey);
      const result = await contract.callTx.balanceOf(account, id);
      const bal = result.private.result as unknown as bigint;
      setBalanceResult(`Token #${queryId}: ${bal.toString()}`);
      setLastTxId(result.public.txId);
      onLog(`Balance of #${queryId}: ${bal}`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Balance query failed: ${msg}`, 'error');
      console.error('BalanceOf error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, shared, queryId, onLog]);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(contractAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ── No contract yet: deploy or join ──────────────────────────────────
  if (!contract) {
    return (
      <div className="max-w-2xl mx-auto mt-16 px-4 space-y-6">
        <h2 className="text-2xl font-bold text-center mb-8">Multi Token (ERC-1155 style)</h2>

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
                Create a new multi-token collection
              </p>
              <input
                type="text"
                value={baseUri}
                onChange={(e) => setBaseUri(e.target.value)}
                placeholder="Base URI (e.g. https://example.com/{id}.json)"
                className="input mb-3"
              />
              <button onClick={handleDeploy} className="btn-primary w-full">
                Deploy Multi Token
              </button>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold mb-2">Join Existing</h3>
              <p className="text-sm text-gray-400 mb-4">
                Connect to a deployed multi-token by address
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

  // ── Contract connected: show interaction ──────────────────────────────
  return (
    <div className="max-w-lg mx-auto mt-16 px-4 space-y-4">
      <div className="card">
        <h2 className="text-xl font-bold text-center mb-6">Multi Token</h2>

        {/* Collection info */}
        <div className="space-y-3 mb-6">
          {displayUri && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Base URI</span>
              <span className="text-white font-mono text-xs truncate ml-4 max-w-[250px]">{displayUri}</span>
            </div>
          )}
          {balanceResult && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Last Balance Query</span>
              <span className="text-white font-mono">{balanceResult}</span>
            </div>
          )}
        </div>

        {/* Mint */}
        <div className="border-t border-midnight-600 pt-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Mint</h3>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <input
              type="number"
              value={mintId}
              onChange={(e) => setMintId(e.target.value)}
              placeholder="Token ID"
              className="input"
              min="0"
            />
            <input
              type="number"
              value={mintAmount}
              onChange={(e) => setMintAmount(e.target.value)}
              placeholder="Amount"
              className="input"
              min="1"
            />
          </div>
          <button onClick={handleMint} disabled={isLoading} className="btn-primary w-full">
            {isLoading && loadingMsg.includes('Minting') ? (
              <span className="flex items-center justify-center gap-2">
                <div className="spinner !w-4 !h-4 !border-white/30 !border-t-white" />
                Minting...
              </span>
            ) : (
              'Mint'
            )}
          </button>
        </div>

        {/* Transfer */}
        <div className="border-t border-midnight-600 pt-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Transfer</h3>
          <input
            type="text"
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            placeholder="Recipient public key (hex)"
            className="input mb-2"
          />
          <div className="grid grid-cols-2 gap-2 mb-3">
            <input
              type="number"
              value={transferId}
              onChange={(e) => setTransferId(e.target.value)}
              placeholder="Token ID"
              className="input"
              min="0"
            />
            <input
              type="number"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              placeholder="Amount"
              className="input"
              min="1"
            />
          </div>
          <button onClick={handleTransfer} disabled={isLoading} className="btn-primary w-full">
            Transfer
          </button>
        </div>

        {/* Balance query */}
        <div className="border-t border-midnight-600 pt-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Balance Query</h3>
          <input
            type="number"
            value={queryId}
            onChange={(e) => setQueryId(e.target.value)}
            placeholder="Token ID"
            className="input mb-3"
            min="0"
          />
          <button onClick={handleBalanceOf} disabled={isLoading} className="btn-secondary w-full">
            Query Balance
          </button>
        </div>

        {/* Loading indicator */}
        {isLoading && !loadingMsg.includes('Minting') && (
          <div className="flex items-center justify-center gap-2 py-2 text-sm text-gray-400">
            <div className="spinner !w-4 !h-4" />
            {loadingMsg || 'Processing...'}
          </div>
        )}

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
