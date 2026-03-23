import React, { useState, useCallback, useRef } from 'react';
import { useWallet } from '../contexts/WalletContext.js';
import { buildContractProviders } from '../lib/build-providers.js';
import { FungibleToken } from '@mnf-se/fungible-token-contract';
import type { FungibleTokenPrivateState } from '@mnf-se/fungible-token-contract';
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
type FTCircuits = ProvableCircuitId<FungibleToken.Contract<FungibleTokenPrivateState>>;
const FTPrivateStateId = 'fungibleTokenPrivateState';
type FTProviders = MidnightProviders<FTCircuits, typeof FTPrivateStateId, FungibleTokenPrivateState>;
type DeployedFT = DeployedContract<FungibleToken.Contract<FungibleTokenPrivateState>> | FoundContract<FungibleToken.Contract<FungibleTokenPrivateState>>;

type EitherAddr = { is_left: boolean; left: { bytes: Uint8Array }; right: { bytes: Uint8Array } };

function leftPublicKey(pubKeyBytes: Uint8Array): EitherAddr {
  return { is_left: true, left: { bytes: pubKeyBytes }, right: { bytes: new Uint8Array(32) } };
}

interface Props {
  onLog: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export function FungibleTokenTab({ onLog }: Props) {
  const { shared } = useWallet();
  const providersRef = useRef<FTProviders | null>(null);
  const compiledRef = useRef<ReturnType<typeof CompiledContract.make> | null>(null);

  const [contract, setContract] = useState<DeployedFT | null>(null);
  const [contractAddress, setContractAddress] = useState('');
  const [joinAddress, setJoinAddress] = useState('');

  // Deploy inputs
  const [ftName, setFtName] = useState('MyFungibleToken');
  const [ftSymbol, setFtSymbol] = useState('MFT');
  const [ftDecimals, setFtDecimals] = useState('18');

  // Action inputs
  const [mintAmount, setMintAmount] = useState('1000');
  const [transferAmount, setTransferAmount] = useState('100');
  const [transferRecipient, setTransferRecipient] = useState('');

  // Display state
  const [totalSupply, setTotalSupply] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [displaySymbol, setDisplaySymbol] = useState('');
  const [displayDecimals, setDisplayDecimals] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [lastTxId, setLastTxId] = useState('');
  const [copied, setCopied] = useState(false);

  const getProviders = useCallback((): FTProviders => {
    if (providersRef.current) return providersRef.current;
    if (!shared) throw new Error('Wallet not connected');
    const providers = buildContractProviders<FTCircuits>('contract/fungible-token', shared);
    providersRef.current = providers;
    return providers;
  }, [shared]);

  const getCompiled = useCallback(() => {
    if (compiledRef.current) return compiledRef.current;
    const compiled = CompiledContract.make('FungibleToken', FungibleToken.Contract).pipe(
      CompiledContract.withVacantWitnesses,
      CompiledContract.withCompiledFileAssets('./contract/fungible-token'),
    );
    compiledRef.current = compiled as any;
    return compiled as any;
  }, []);

  const handleDeploy = useCallback(async () => {
    if (!shared) return;
    setIsLoading(true);
    setLoadingMsg('Deploying FungibleToken contract (generating ZK proof)...');
    onLog(`Deploying FungibleToken "${ftName}" (${ftSymbol})...`);
    try {
      const providers = getProviders();
      const compiled = getCompiled();
      const deployed = await deployContract(providers as any, {
        compiledContract: compiled,
        privateStateId: FTPrivateStateId,
        initialPrivateState: {} as FungibleTokenPrivateState,
        args: [ftName, ftSymbol, BigInt(ftDecimals)],
      });
      const addr = deployed.deployTxData.public.contractAddress;
      setContract(deployed as any);
      setContractAddress(addr);
      setDisplayName(ftName);
      setDisplaySymbol(ftSymbol);
      setDisplayDecimals(ftDecimals);
      onLog(`FungibleToken deployed at ${addr.substring(0, 20)}...`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Deploy failed: ${msg}`, 'error');
      console.error('Deploy error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [shared, ftName, ftSymbol, ftDecimals, onLog, getProviders, getCompiled]);

  const handleJoin = useCallback(async () => {
    if (!shared || !joinAddress.trim()) return;
    setIsLoading(true);
    setLoadingMsg('Joining FungibleToken contract...');
    onLog(`Joining FungibleToken at ${joinAddress.substring(0, 20)}...`);
    try {
      const providers = getProviders();
      const compiled = getCompiled();
      const found = await findDeployedContract(providers as any, {
        contractAddress: joinAddress.trim(),
        compiledContract: compiled,
        privateStateId: FTPrivateStateId,
        initialPrivateState: {} as FungibleTokenPrivateState,
      });
      setContract(found as any);
      setContractAddress(joinAddress.trim());
      onLog('Successfully joined FungibleToken contract', 'success');
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
    const amount = BigInt(mintAmount || '0');
    if (amount <= 0n) {
      onLog('Amount must be greater than zero', 'error');
      return;
    }
    setIsLoading(true);
    setLoadingMsg('Minting tokens (generating ZK proof)...');
    onLog(`Minting ${mintAmount} tokens to self...`);
    try {
      const recipientKey = shared.walletProvider.getCoinPublicKey() as unknown as Uint8Array;
      const account = leftPublicKey(recipientKey);
      const result = await contract.callTx.mint(account, amount);
      setLastTxId(result.public.txId);
      onLog(`Minted ${mintAmount} tokens (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Mint failed: ${msg}`, 'error');
      console.error('Mint error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, shared, mintAmount, onLog]);

  const handleTransfer = useCallback(async () => {
    if (!contract) return;
    const amount = BigInt(transferAmount || '0');
    if (amount <= 0n) {
      onLog('Amount must be greater than zero', 'error');
      return;
    }
    if (!transferRecipient.trim()) {
      onLog('Recipient address is required', 'error');
      return;
    }
    setIsLoading(true);
    setLoadingMsg('Transferring tokens (generating ZK proof)...');
    onLog(`Transferring ${transferAmount} tokens...`);
    try {
      const hex = transferRecipient.trim().replace(/^0x/, '');
      const recipientBytes = new Uint8Array(32);
      for (let i = 0; i < Math.min(hex.length / 2, 32); i++) {
        recipientBytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
      }
      const to = leftPublicKey(recipientBytes);
      const result = await contract.callTx.transfer(to, amount);
      setLastTxId(result.public.txId);
      onLog(`Transferred ${transferAmount} tokens (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Transfer failed: ${msg}`, 'error');
      console.error('Transfer error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, transferAmount, transferRecipient, onLog]);

  const handleBalanceOf = useCallback(async () => {
    if (!contract || !shared) return;
    setIsLoading(true);
    setLoadingMsg('Querying balance...');
    onLog('Querying own balance...');
    try {
      const recipientKey = shared.walletProvider.getCoinPublicKey() as unknown as Uint8Array;
      const account = leftPublicKey(recipientKey);
      const result = await contract.callTx.balanceOf(account);
      const bal = result.private.result as bigint;
      setBalance(bal.toString());
      setLastTxId(result.public.txId);
      onLog(`Balance: ${bal}`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Balance query failed: ${msg}`, 'error');
      console.error('BalanceOf error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, shared, onLog]);

  const handleTotalSupply = useCallback(async () => {
    if (!contract) return;
    setIsLoading(true);
    setLoadingMsg('Querying total supply...');
    onLog('Querying total supply...');
    try {
      const result = await contract.callTx.totalSupply();
      const supply = result.private.result as bigint;
      setTotalSupply(supply.toString());
      setLastTxId(result.public.txId);
      onLog(`Total supply: ${supply}`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Total supply query failed: ${msg}`, 'error');
      console.error('TotalSupply error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, onLog]);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(contractAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ── No contract yet: deploy or join ──────────────────────────────────
  if (!contract) {
    return (
      <div className="max-w-2xl mx-auto mt-16 px-4 space-y-6">
        <h2 className="text-2xl font-bold text-center mb-8">Fungible Token (ERC-20 style)</h2>

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
                Create a new ERC-20 style fungible token
              </p>
              <input
                type="text"
                value={ftName}
                onChange={(e) => setFtName(e.target.value)}
                placeholder="Token name"
                className="input mb-2"
              />
              <input
                type="text"
                value={ftSymbol}
                onChange={(e) => setFtSymbol(e.target.value)}
                placeholder="Symbol"
                className="input mb-2"
              />
              <input
                type="number"
                value={ftDecimals}
                onChange={(e) => setFtDecimals(e.target.value)}
                placeholder="Decimals"
                className="input mb-3"
                min="0"
                max="18"
              />
              <button onClick={handleDeploy} className="btn-primary w-full">
                Deploy Fungible Token
              </button>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold mb-2">Join Existing</h3>
              <p className="text-sm text-gray-400 mb-4">
                Connect to a deployed fungible token by address
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
        <h2 className="text-xl font-bold text-center mb-6">Fungible Token</h2>

        {/* Token info */}
        <div className="space-y-3 mb-6">
          {displayName && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Name</span>
              <span className="text-white">{displayName}</span>
            </div>
          )}
          {displaySymbol && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Symbol</span>
              <span className="text-white">{displaySymbol}</span>
            </div>
          )}
          {displayDecimals && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Decimals</span>
              <span className="text-white">{displayDecimals}</span>
            </div>
          )}
          {totalSupply !== null && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Total Supply</span>
              <span className="text-white font-mono">{totalSupply}</span>
            </div>
          )}
          {balance !== null && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">My Balance</span>
              <span className="text-white font-mono">{balance}</span>
            </div>
          )}
        </div>

        {/* Mint */}
        <div className="border-t border-midnight-600 pt-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Mint (to self)</h3>
          <input
            type="number"
            value={mintAmount}
            onChange={(e) => setMintAmount(e.target.value)}
            placeholder="Amount"
            className="input mb-3"
            min="1"
          />
          <button
            onClick={handleMint}
            disabled={isLoading}
            className="btn-primary w-full"
          >
            {isLoading && loadingMsg.includes('Mint') ? (
              <span className="flex items-center justify-center gap-2">
                <div className="spinner !w-4 !h-4 !border-white/30 !border-t-white" />
                {loadingMsg}
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
            value={transferRecipient}
            onChange={(e) => setTransferRecipient(e.target.value)}
            placeholder="Recipient public key (hex)"
            className="input mb-2"
          />
          <input
            type="number"
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            placeholder="Amount"
            className="input mb-3"
            min="1"
          />
          <button
            onClick={handleTransfer}
            disabled={isLoading}
            className="btn-primary w-full"
          >
            {isLoading && loadingMsg.includes('Transfer') ? (
              <span className="flex items-center justify-center gap-2">
                <div className="spinner !w-4 !h-4 !border-white/30 !border-t-white" />
                {loadingMsg}
              </span>
            ) : (
              'Transfer'
            )}
          </button>
        </div>

        {/* Query buttons */}
        <div className="border-t border-midnight-600 pt-4 mb-4">
          <div className="flex gap-3">
            <button
              onClick={handleBalanceOf}
              disabled={isLoading}
              className="btn-secondary flex-1"
            >
              View Balance
            </button>
            <button
              onClick={handleTotalSupply}
              disabled={isLoading}
              className="btn-secondary flex-1"
            >
              View Total Supply
            </button>
          </div>
        </div>

        {/* Loading indicator */}
        {isLoading && !loadingMsg.includes('Mint') && !loadingMsg.includes('Transfer') && (
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
