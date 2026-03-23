import React, { useState, useCallback, useRef } from 'react';
import { useWallet } from '../contexts/WalletContext.js';
import { buildContractProviders } from '../lib/build-providers.js';
import { NFT } from '@mnf-se/nft-contract';
import type { NftPrivateState } from '@mnf-se/nft-contract';
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
type NftCircuits = ProvableCircuitId<NFT.Contract<NftPrivateState>>;
const NftPrivateStateId = 'nftPrivateState';
type NftProviders = MidnightProviders<NftCircuits, typeof NftPrivateStateId, NftPrivateState>;
type DeployedNft = DeployedContract<NFT.Contract<NftPrivateState>> | FoundContract<NFT.Contract<NftPrivateState>>;

type EitherAddr = { is_left: boolean; left: { bytes: Uint8Array }; right: { bytes: Uint8Array } };

function leftPublicKey(pubKeyBytes: Uint8Array): EitherAddr {
  return { is_left: true, left: { bytes: pubKeyBytes }, right: { bytes: new Uint8Array(32) } };
}

interface Props {
  onLog: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export function NftTab({ onLog }: Props) {
  const { shared } = useWallet();
  const providersRef = useRef<NftProviders | null>(null);
  const compiledRef = useRef<ReturnType<typeof CompiledContract.make> | null>(null);

  const [contract, setContract] = useState<DeployedNft | null>(null);
  const [contractAddress, setContractAddress] = useState('');
  const [joinAddress, setJoinAddress] = useState('');

  // Deploy inputs
  const [nftName, setNftName] = useState('MyNFT');
  const [nftSymbol, setNftSymbol] = useState('MNFT');

  // Action inputs
  const [mintTokenId, setMintTokenId] = useState('1');
  const [transferTokenId, setTransferTokenId] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [ownerQueryId, setOwnerQueryId] = useState('');
  const [uriTokenId, setUriTokenId] = useState('');
  const [uriValue, setUriValue] = useState('');
  const [burnTokenId, setBurnTokenId] = useState('');

  // Display state
  const [displayName, setDisplayName] = useState('');
  const [displaySymbol, setDisplaySymbol] = useState('');
  const [ownerResult, setOwnerResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [lastTxId, setLastTxId] = useState('');
  const [copied, setCopied] = useState(false);

  const getProviders = useCallback((): NftProviders => {
    if (providersRef.current) return providersRef.current;
    if (!shared) throw new Error('Wallet not connected');
    const providers = buildContractProviders<NftCircuits>('contract/nft', shared);
    providersRef.current = providers;
    return providers;
  }, [shared]);

  const getCompiled = useCallback(() => {
    if (compiledRef.current) return compiledRef.current;
    const compiled = CompiledContract.make('nft', NFT.Contract).pipe(
      CompiledContract.withVacantWitnesses,
      CompiledContract.withCompiledFileAssets('./contract/nft'),
    );
    compiledRef.current = compiled as any;
    return compiled as any;
  }, []);

  const handleDeploy = useCallback(async () => {
    if (!shared) return;
    setIsLoading(true);
    setLoadingMsg('Deploying NFT contract (generating ZK proof)...');
    onLog(`Deploying NFT "${nftName}" (${nftSymbol})...`);
    try {
      const providers = getProviders();
      const compiled = getCompiled();
      const deployed = await deployContract(providers as any, {
        compiledContract: compiled,
        privateStateId: NftPrivateStateId,
        initialPrivateState: {} as NftPrivateState,
        args: [nftName, nftSymbol],
      });
      const addr = deployed.deployTxData.public.contractAddress;
      setContract(deployed as any);
      setContractAddress(addr);
      setDisplayName(nftName);
      setDisplaySymbol(nftSymbol);
      onLog(`NFT deployed at ${addr.substring(0, 20)}...`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Deploy failed: ${msg}`, 'error');
      console.error('Deploy error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [shared, nftName, nftSymbol, onLog, getProviders, getCompiled]);

  const handleJoin = useCallback(async () => {
    if (!shared || !joinAddress.trim()) return;
    setIsLoading(true);
    setLoadingMsg('Joining NFT contract...');
    onLog(`Joining NFT at ${joinAddress.substring(0, 20)}...`);
    try {
      const providers = getProviders();
      const compiled = getCompiled();
      const found = await findDeployedContract(providers as any, {
        contractAddress: joinAddress.trim(),
        compiledContract: compiled,
        privateStateId: NftPrivateStateId,
        initialPrivateState: {} as NftPrivateState,
      });
      setContract(found as any);
      setContractAddress(joinAddress.trim());
      onLog('Successfully joined NFT contract', 'success');
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
    const tokenId = BigInt(mintTokenId || '0');
    setIsLoading(true);
    setLoadingMsg('Minting NFT (generating ZK proof)...');
    onLog(`Minting NFT #${tokenId}...`);
    try {
      const recipientKey = shared.walletProvider.getCoinPublicKey() as unknown as Uint8Array;
      const to = leftPublicKey(recipientKey);
      const result = await contract.callTx.mint(to, tokenId);
      setLastTxId(result.public.txId);
      onLog(`Minted NFT #${tokenId} (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Mint failed: ${msg}`, 'error');
      console.error('Mint error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, shared, mintTokenId, onLog]);

  const handleTransfer = useCallback(async () => {
    if (!contract || !shared) return;
    if (!transferTo.trim()) {
      onLog('Recipient address is required', 'error');
      return;
    }
    const tokenId = BigInt(transferTokenId || '0');
    setIsLoading(true);
    setLoadingMsg('Transferring NFT (generating ZK proof)...');
    onLog(`Transferring NFT #${tokenId}...`);
    try {
      const fromKey = shared.walletProvider.getCoinPublicKey() as unknown as Uint8Array;
      const from = leftPublicKey(fromKey);
      const hex = transferTo.trim().replace(/^0x/, '');
      const toBytes = new Uint8Array(32);
      for (let i = 0; i < Math.min(hex.length / 2, 32); i++) {
        toBytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
      }
      const to = leftPublicKey(toBytes);
      const result = await contract.callTx.transferFrom(from, to, tokenId);
      setLastTxId(result.public.txId);
      onLog(`Transferred NFT #${tokenId} (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Transfer failed: ${msg}`, 'error');
      console.error('Transfer error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, shared, transferTokenId, transferTo, onLog]);

  const handleOwnerOf = useCallback(async () => {
    if (!contract) return;
    const tokenId = BigInt(ownerQueryId || '0');
    setIsLoading(true);
    setLoadingMsg('Querying owner...');
    onLog(`Querying owner of NFT #${tokenId}...`);
    try {
      const result = await contract.callTx.ownerOf(tokenId);
      const owner = result.private.result as unknown as EitherAddr;
      const ownerHex = owner.is_left
        ? Array.from(owner.left.bytes, (b) => b.toString(16).padStart(2, '0')).join('')
        : Array.from(owner.right.bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      setOwnerResult(`${owner.is_left ? 'zswap' : 'contract'}:${ownerHex.substring(0, 32)}...`);
      setLastTxId(result.public.txId);
      onLog(`Owner of #${tokenId}: ${ownerHex.substring(0, 24)}...`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Owner query failed: ${msg}`, 'error');
      console.error('OwnerOf error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, ownerQueryId, onLog]);

  const handleSetUri = useCallback(async () => {
    if (!contract) return;
    const tokenId = BigInt(uriTokenId || '0');
    if (!uriValue.trim()) {
      onLog('URI value is required', 'error');
      return;
    }
    setIsLoading(true);
    setLoadingMsg('Setting token URI (generating ZK proof)...');
    onLog(`Setting URI for NFT #${tokenId}...`);
    try {
      const result = await contract.callTx.setTokenURI(tokenId, uriValue);
      setLastTxId(result.public.txId);
      onLog(`Set URI for NFT #${tokenId} (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Set URI failed: ${msg}`, 'error');
      console.error('SetURI error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, uriTokenId, uriValue, onLog]);

  const handleBurn = useCallback(async () => {
    if (!contract) return;
    const tokenId = BigInt(burnTokenId || '0');
    setIsLoading(true);
    setLoadingMsg('Burning NFT (generating ZK proof)...');
    onLog(`Burning NFT #${tokenId}...`);
    try {
      const result = await contract.callTx.burn(tokenId);
      setLastTxId(result.public.txId);
      onLog(`Burned NFT #${tokenId} (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Burn failed: ${msg}`, 'error');
      console.error('Burn error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, burnTokenId, onLog]);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(contractAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ── No contract yet: deploy or join ──────────────────────────────────
  if (!contract) {
    return (
      <div className="max-w-2xl mx-auto mt-16 px-4 space-y-6">
        <h2 className="text-2xl font-bold text-center mb-8">NFT (ERC-721 style)</h2>

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
                Create a new NFT collection
              </p>
              <input
                type="text"
                value={nftName}
                onChange={(e) => setNftName(e.target.value)}
                placeholder="Collection name"
                className="input mb-2"
              />
              <input
                type="text"
                value={nftSymbol}
                onChange={(e) => setNftSymbol(e.target.value)}
                placeholder="Symbol"
                className="input mb-3"
              />
              <button onClick={handleDeploy} className="btn-primary w-full">
                Deploy NFT
              </button>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold mb-2">Join Existing</h3>
              <p className="text-sm text-gray-400 mb-4">
                Connect to a deployed NFT by address
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
        <h2 className="text-xl font-bold text-center mb-6">NFT Collection</h2>

        {/* Collection info */}
        <div className="space-y-3 mb-6">
          {displayName && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Collection</span>
              <span className="text-white">{displayName}</span>
            </div>
          )}
          {displaySymbol && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Symbol</span>
              <span className="text-white">{displaySymbol}</span>
            </div>
          )}
          {ownerResult && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Last Owner Query</span>
              <span className="text-white font-mono text-xs">{ownerResult}</span>
            </div>
          )}
        </div>

        {/* Mint */}
        <div className="border-t border-midnight-600 pt-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Mint NFT</h3>
          <input
            type="number"
            value={mintTokenId}
            onChange={(e) => setMintTokenId(e.target.value)}
            placeholder="Token ID"
            className="input mb-3"
            min="0"
          />
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
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Transfer NFT</h3>
          <input
            type="text"
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            placeholder="Recipient public key (hex)"
            className="input mb-2"
          />
          <input
            type="number"
            value={transferTokenId}
            onChange={(e) => setTransferTokenId(e.target.value)}
            placeholder="Token ID"
            className="input mb-3"
            min="0"
          />
          <button onClick={handleTransfer} disabled={isLoading} className="btn-primary w-full">
            Transfer
          </button>
        </div>

        {/* Owner Of */}
        <div className="border-t border-midnight-600 pt-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Owner Of</h3>
          <input
            type="number"
            value={ownerQueryId}
            onChange={(e) => setOwnerQueryId(e.target.value)}
            placeholder="Token ID"
            className="input mb-3"
            min="0"
          />
          <button onClick={handleOwnerOf} disabled={isLoading} className="btn-secondary w-full">
            Query Owner
          </button>
        </div>

        {/* Set URI */}
        <div className="border-t border-midnight-600 pt-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Set Token URI</h3>
          <input
            type="number"
            value={uriTokenId}
            onChange={(e) => setUriTokenId(e.target.value)}
            placeholder="Token ID"
            className="input mb-2"
            min="0"
          />
          <input
            type="text"
            value={uriValue}
            onChange={(e) => setUriValue(e.target.value)}
            placeholder="URI (e.g. ipfs://...)"
            className="input mb-3"
          />
          <button onClick={handleSetUri} disabled={isLoading} className="btn-primary w-full">
            Set URI
          </button>
        </div>

        {/* Burn */}
        <div className="border-t border-midnight-600 pt-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Burn NFT</h3>
          <input
            type="number"
            value={burnTokenId}
            onChange={(e) => setBurnTokenId(e.target.value)}
            placeholder="Token ID"
            className="input mb-3"
            min="0"
          />
          <button onClick={handleBurn} disabled={isLoading} className="btn-primary w-full">
            Burn
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
