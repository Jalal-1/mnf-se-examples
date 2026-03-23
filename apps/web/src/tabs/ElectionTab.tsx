import React, { useState, useCallback, useRef } from 'react';
import { useWallet } from '../contexts/WalletContext.js';
import { buildContractProviders } from '../lib/build-providers.js';
import {
  Election,
  type ElectionPrivateState,
  type ElectionMerkleTreeContext,
  createWitnesses,
  PermissibleVotes,
  PrivateStateEnum,
} from '@mnf-se/election-contract';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { CompactTypeBytes, CompactTypeUnsignedInteger, persistentHash } from '@midnight-ntwrk/compact-runtime';
import { StateValue, ChargedState, type ContractState } from '@midnight-ntwrk/compact-runtime';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import * as Rx from 'rxjs';

function extractError(e: unknown, depth = 0): string {
  if (depth > 5) return '';
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause ? ` → ${extractError(e.cause, depth + 1)}` : '';
  return `${e.message}${cause}`;
}

// ── Types ──────────────────────────────────────────────────────────────
type ElectionCircuits = 'vote$commit' | 'vote$reveal' | 'advance' | 'set_topic' | 'add_voter';
const ElectionPrivateStateId = 'electionPrivateState';
type ElectionProviders = MidnightProviders<ElectionCircuits, typeof ElectionPrivateStateId, ElectionPrivateState>;
type DeployedElection = DeployedContract<Election.Contract<ElectionPrivateState>> | FoundContract<Election.Contract<ElectionPrivateState>>;

type ElectionPublicState = {
  authority: string;
  state: number;
  topic: string;
  tallyYes: string;
  tallyNo: string;
  eligibleVoterCount: string;
};

const PHASE_NAMES = ['Setup', 'Commit', 'Reveal', 'Final'];

// ── BMT Rehash ─────────────────────────────────────────────────────────
function rehashStateValue(sv: StateValue): StateValue {
  switch (sv.type()) {
    case 'boundedMerkleTree': {
      const tree = sv.asBoundedMerkleTree();
      return tree ? StateValue.newBoundedMerkleTree(tree.rehash()) : sv;
    }
    case 'array': {
      const arr = sv.asArray();
      if (!arr) return sv;
      let result = StateValue.newArray();
      for (const child of arr) {
        result = result.arrayPush(rehashStateValue(child));
      }
      return result;
    }
    default:
      return sv;
  }
}

function rehashContractState(cs: ContractState): ContractState {
  const rehashed = rehashStateValue(cs.data.state);
  cs.data = new ChargedState(rehashed);
  return cs;
}

function wrapPublicDataProviderWithRehash(inner: PublicDataProvider): PublicDataProvider {
  return {
    ...inner,
    async queryContractState(...args: Parameters<PublicDataProvider['queryContractState']>) {
      const result = await inner.queryContractState(...args);
      return result ? rehashContractState(result) : null;
    },
    async queryZSwapAndContractState(...args: Parameters<PublicDataProvider['queryZSwapAndContractState']>) {
      const result = await inner.queryZSwapAndContractState(...args);
      return result ? [result[0], rehashContractState(result[1]), result[2]] as any : null;
    },
    async queryDeployContractState(...args: Parameters<PublicDataProvider['queryDeployContractState']>) {
      const result = await inner.queryDeployContractState(...args);
      return result ? rehashContractState(result) : null;
    },
    async watchForContractState(...args: Parameters<PublicDataProvider['watchForContractState']>) {
      const result = await inner.watchForContractState(...args);
      return rehashContractState(result);
    },
    contractStateObservable(address: ContractAddress, config: any) {
      return inner.contractStateObservable(address, config).pipe(
        Rx.map((cs: ContractState) => rehashContractState(cs)),
      );
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────
function derivePublicKey(secretKey: Uint8Array): Uint8Array {
  const bytesType = new CompactTypeBytes(32);
  const prefix = new Uint8Array(32);
  const prefixStr = 'lares:election:pk:';
  for (let i = 0; i < prefixStr.length; i++) prefix[i] = prefixStr.charCodeAt(i);
  return persistentHash(
    {
      alignment: () => bytesType.alignment().concat(bytesType.alignment()),
      toValue: (v: Uint8Array[]) => bytesType.toValue(v[0]).concat(bytesType.toValue(v[1])),
      fromValue: () => { throw new Error('not needed'); },
    },
    [prefix, secretKey],
  );
}

interface Props {
  onLog: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export function ElectionTab({ onLog }: Props) {
  const { shared } = useWallet();
  const providersRef = useRef<ElectionProviders | null>(null);
  const secretKeyRef = useRef<Uint8Array | null>(null);
  const merkleCtxRef = useRef<ElectionMerkleTreeContext>({ eligibleVotersTree: null, committedVotesTree: null });
  const compiledRef = useRef<ReturnType<typeof CompiledContract.make> | null>(null);

  const [contract, setContract] = useState<DeployedElection | null>(null);
  const [contractAddress, setContractAddress] = useState('');
  const [joinAddress, setJoinAddress] = useState('');
  const [role, setRole] = useState<'none' | 'authority' | 'voter'>('none');

  // Authority inputs
  const [topicInput, setTopicInput] = useState('');
  const [voterPkInput, setVoterPkInput] = useState('');

  // Display state
  const [electionState, setElectionState] = useState<ElectionPublicState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [lastTxId, setLastTxId] = useState('');
  const [copied, setCopied] = useState(false);

  const getSecretKey = useCallback((): Uint8Array => {
    if (secretKeyRef.current) return secretKeyRef.current;
    const sk = new Uint8Array(32);
    crypto.getRandomValues(sk);
    secretKeyRef.current = sk;
    return sk;
  }, []);

  const getProviders = useCallback((): ElectionProviders => {
    if (providersRef.current) return providersRef.current;
    if (!shared) throw new Error('Wallet not connected');
    const base = buildContractProviders<ElectionCircuits>('contract/election', shared);
    // Wrap public data provider with rehash for MerkleTree state
    const providers: ElectionProviders = {
      ...base,
      publicDataProvider: wrapPublicDataProviderWithRehash(base.publicDataProvider),
    };
    providersRef.current = providers;
    return providers;
  }, [shared]);

  const getCompiled = useCallback(() => {
    if (compiledRef.current) return compiledRef.current;
    const witnesses = createWitnesses(merkleCtxRef.current);
    const compiled = CompiledContract.make('Election', Election.Contract).pipe(
      CompiledContract.withWitnesses(witnesses),
      CompiledContract.withCompiledFileAssets('./contract/election'),
    );
    compiledRef.current = compiled as any;
    return compiled as any;
  }, []);

  const updateMerkleContext = useCallback(async (addr: string) => {
    try {
      const providers = getProviders();
      const contractState = await providers.publicDataProvider.queryContractState(addr as ContractAddress);
      if (!contractState) return;
      const stateArr = contractState.data.state.asArray()!;
      try {
        const committedContainer = stateArr[5]!.asArray()!;
        const committedTree = committedContainer[0]!.asBoundedMerkleTree() ?? null;
        merkleCtxRef.current.committedVotesTree = committedTree?.rehash() ?? null;
      } catch {}
      try {
        const votersContainer = stateArr[6]!.asArray()!;
        const votersTree = votersContainer[0]!.asBoundedMerkleTree() ?? null;
        merkleCtxRef.current.eligibleVotersTree = votersTree?.rehash() ?? null;
      } catch {}
    } catch (e) {
      console.warn('Failed to update Merkle context:', e);
    }
  }, [getProviders]);

  const refreshState = useCallback(async (addr: string) => {
    try {
      const providers = getProviders();
      const contractState = await providers.publicDataProvider.queryContractState(addr as ContractAddress);
      if (!contractState) return;

      const stateArr = contractState.data.state.asArray()!;
      const bytesType = new CompactTypeBytes(32);
      const { CompactTypeEnum, CompactTypeBoolean, CompactTypeOpaqueString, CompactTypeUnsignedInteger } = await import('@midnight-ntwrk/compact-runtime');
      const enumType = new CompactTypeEnum(3, 1);
      const uintType = new CompactTypeUnsignedInteger(18446744073709551615n, 8);

      const authorityCell = stateArr[0]!.asCell()!;
      const authority = Array.from(bytesType.fromValue([...authorityCell.value]), (b: number) => b.toString(16).padStart(2, '0')).join('');

      const stateCell = stateArr[1]!.asCell()!;
      const publicState = enumType.fromValue([...stateCell.value]);

      const topicCell = stateArr[2]!.asCell()!;
      const topicVal: Uint8Array[] = [...topicCell.value];
      const isSome = CompactTypeBoolean.fromValue(topicVal);
      const topicStr = isSome ? CompactTypeOpaqueString.fromValue(topicVal) : '';

      const tallyYes = uintType.fromValue([...stateArr[3]!.asCell()!.value]);
      const tallyNo = uintType.fromValue([...stateArr[4]!.asCell()!.value]);

      let eligibleVoterCount = 0n;
      try {
        const v = stateArr[6]!.asArray()!;
        eligibleVoterCount = uintType.fromValue([...v[1]!.asCell()!.value]);
      } catch {}

      setElectionState({
        authority,
        state: publicState,
        topic: topicStr,
        tallyYes: tallyYes.toString(),
        tallyNo: tallyNo.toString(),
        eligibleVoterCount: eligibleVoterCount.toString(),
      });
    } catch (e) {
      console.warn('Failed to refresh election state:', e);
    }
  }, [getProviders]);

  const handleDeploy = useCallback(async () => {
    if (!shared) return;
    setIsLoading(true);
    setLoadingMsg('Deploying Election contract (generating ZK proof)...');
    onLog('Deploying Election contract (you become authority)...');
    try {
      const providers = getProviders();
      const sk = getSecretKey();
      const compiled = getCompiled();
      const deployed = await (deployContract as any)(providers, {
        compiledContract: compiled,
        privateStateId: ElectionPrivateStateId,
        initialPrivateState: {
          secretKey: sk,
          state: PrivateStateEnum.initial,
          vote: null,
        },
      });
      const addr = deployed.deployTxData.public.contractAddress;
      setContract(deployed as any);
      setContractAddress(addr);
      setRole('authority');
      await refreshState(addr);
      const pk = derivePublicKey(sk);
      const pkHex = Array.from(pk, (b) => b.toString(16).padStart(2, '0')).join('');
      onLog(`Election deployed at ${addr.substring(0, 20)}... (your pk: ${pkHex.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Deploy failed: ${msg}`, 'error');
      console.error('Deploy error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [shared, onLog, getProviders, getSecretKey, getCompiled, refreshState]);

  const handleJoin = useCallback(async () => {
    if (!shared || !joinAddress.trim()) return;
    setIsLoading(true);
    setLoadingMsg('Joining Election contract...');
    onLog(`Joining Election at ${joinAddress.substring(0, 20)}... (as voter)`);
    try {
      const providers = getProviders();
      const sk = getSecretKey();
      const compiled = getCompiled();
      const found = await findDeployedContract(providers as any, {
        contractAddress: joinAddress.trim(),
        compiledContract: compiled,
        privateStateId: ElectionPrivateStateId,
        initialPrivateState: {
          secretKey: sk,
          state: PrivateStateEnum.initial,
          vote: null,
        },
      });
      setContract(found as any);
      setContractAddress(joinAddress.trim());
      setRole('voter');
      await refreshState(joinAddress.trim());
      const pk = derivePublicKey(sk);
      const pkHex = Array.from(pk, (b) => b.toString(16).padStart(2, '0')).join('');
      onLog(`Joined as voter (your pk: ${pkHex.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Join failed: ${msg}`, 'error');
      console.error('Join error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [shared, joinAddress, onLog, getProviders, getSecretKey, getCompiled, refreshState]);

  const handleSetTopic = useCallback(async () => {
    if (!contract || !topicInput.trim()) return;
    setIsLoading(true);
    setLoadingMsg('Setting topic...');
    onLog(`Setting election topic: "${topicInput}"...`);
    try {
      const result = await contract.callTx.set_topic(topicInput);
      setLastTxId(result.public.txId);
      await refreshState(contractAddress);
      onLog(`Topic set (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Set topic failed: ${msg}`, 'error');
      console.error('SetTopic error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, contractAddress, topicInput, onLog, refreshState]);

  const handleAddVoter = useCallback(async () => {
    if (!contract || !voterPkInput.trim()) return;
    setIsLoading(true);
    setLoadingMsg('Adding voter (generating ZK proof)...');
    onLog(`Adding voter ${voterPkInput.substring(0, 16)}...`);
    try {
      await updateMerkleContext(contractAddress);
      const hex = voterPkInput.trim().replace(/^0x/, '');
      const pkBytes = new Uint8Array(32);
      for (let i = 0; i < Math.min(hex.length / 2, 32); i++) {
        pkBytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
      }
      const result = await contract.callTx.add_voter(pkBytes);
      setLastTxId(result.public.txId);
      await refreshState(contractAddress);
      onLog(`Voter added (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Add voter failed: ${msg}`, 'error');
      console.error('AddVoter error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, contractAddress, voterPkInput, onLog, updateMerkleContext, refreshState]);

  const handleAdvance = useCallback(async () => {
    if (!contract) return;
    setIsLoading(true);
    setLoadingMsg('Advancing election phase...');
    onLog('Advancing election phase...');
    try {
      const result = await contract.callTx.advance();
      setLastTxId(result.public.txId);
      await refreshState(contractAddress);
      onLog(`Phase advanced (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Advance failed: ${msg}`, 'error');
      console.error('Advance error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, contractAddress, onLog, refreshState]);

  const handleVote = useCallback(async (ballot: number) => {
    if (!contract) return;
    const voteLabel = ballot === PermissibleVotes.yes ? 'YES' : 'NO';
    setIsLoading(true);
    setLoadingMsg(`Casting ${voteLabel} vote (generating ZK proof)...`);
    onLog(`Casting ${voteLabel} vote...`);
    try {
      await updateMerkleContext(contractAddress);
      const result = await contract.callTx['vote$commit'](ballot);
      setLastTxId(result.public.txId);
      await refreshState(contractAddress);
      onLog(`Vote committed: ${voteLabel} (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Vote failed: ${msg}`, 'error');
      console.error('VoteCommit error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, contractAddress, onLog, updateMerkleContext, refreshState]);

  const handleReveal = useCallback(async () => {
    if (!contract) return;
    setIsLoading(true);
    setLoadingMsg('Revealing vote (generating ZK proof)...');
    onLog('Revealing vote...');
    try {
      await updateMerkleContext(contractAddress);
      const result = await contract.callTx['vote$reveal']();
      setLastTxId(result.public.txId);
      await refreshState(contractAddress);
      onLog(`Vote revealed (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Reveal failed: ${msg}`, 'error');
      console.error('VoteReveal error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, contractAddress, onLog, updateMerkleContext, refreshState]);

  const handleRefresh = useCallback(async () => {
    if (!contractAddress) return;
    onLog('Refreshing election state...');
    await refreshState(contractAddress);
    onLog('Election state refreshed', 'success');
  }, [contractAddress, onLog, refreshState]);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(contractAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const currentPhase = electionState?.state ?? 0;

  // ── No contract yet: deploy or join ──────────────────────────────────
  if (!contract) {
    return (
      <div className="max-w-2xl mx-auto mt-16 px-4 space-y-6">
        <h2 className="text-2xl font-bold text-center mb-8">Election</h2>

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
                Create a new election (you become the authority)
              </p>
              <button onClick={handleDeploy} className="btn-primary w-full">
                Deploy Election
              </button>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold mb-2">Join as Voter</h3>
              <p className="text-sm text-gray-400 mb-4">
                Connect to an existing election to vote
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
                Join as Voter
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Contract connected: show election interaction ─────────────────────
  return (
    <div className="max-w-lg mx-auto mt-16 px-4 space-y-4">
      <div className="card">
        <h2 className="text-xl font-bold text-center mb-2">Election</h2>
        <p className="text-center text-sm text-gray-400 mb-6">
          Role: <span className="text-white font-semibold capitalize">{role}</span>
        </p>

        {/* Election state */}
        <div className="space-y-3 mb-6">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Phase</span>
            <span className={`font-semibold ${
              currentPhase === 3 ? 'text-green-400' : 'text-white'
            }`}>
              {PHASE_NAMES[currentPhase] ?? 'Unknown'}
            </span>
          </div>
          {electionState?.topic && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Topic</span>
              <span className="text-white">{electionState.topic}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Voters</span>
            <span className="text-white font-mono">{electionState?.eligibleVoterCount ?? '0'}</span>
          </div>
          {(currentPhase >= 3) && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Yes Votes</span>
                <span className="text-green-400 font-mono">{electionState?.tallyYes ?? '0'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">No Votes</span>
                <span className="text-red-400 font-mono">{electionState?.tallyNo ?? '0'}</span>
              </div>
            </>
          )}
        </div>

        {/* Authority actions — Setup phase */}
        {role === 'authority' && currentPhase === 0 && (
          <div className="border-t border-midnight-600 pt-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Authority: Setup</h3>
            <input
              type="text"
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              placeholder="Election topic"
              className="input mb-2"
            />
            <button onClick={handleSetTopic} disabled={isLoading} className="btn-primary w-full mb-3">
              Set Topic
            </button>
            <input
              type="text"
              value={voterPkInput}
              onChange={(e) => setVoterPkInput(e.target.value)}
              placeholder="Voter public key (hex)"
              className="input mb-2"
            />
            <button onClick={handleAddVoter} disabled={isLoading} className="btn-primary w-full mb-3">
              Add Voter
            </button>
            <button onClick={handleAdvance} disabled={isLoading} className="btn-secondary w-full">
              Advance to Commit Phase
            </button>
          </div>
        )}

        {/* Authority actions — Commit/Reveal phases */}
        {role === 'authority' && (currentPhase === 1 || currentPhase === 2) && (
          <div className="border-t border-midnight-600 pt-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">
              Authority: Advance Phase
            </h3>
            <button onClick={handleAdvance} disabled={isLoading} className="btn-secondary w-full">
              Advance to {PHASE_NAMES[currentPhase + 1]} Phase
            </button>
          </div>
        )}

        {/* Voter actions — Commit phase */}
        {role === 'voter' && currentPhase === 1 && (
          <div className="border-t border-midnight-600 pt-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Cast Your Vote</h3>
            <div className="flex gap-3">
              <button
                onClick={() => handleVote(PermissibleVotes.yes)}
                disabled={isLoading}
                className="btn-primary flex-1"
              >
                {isLoading && loadingMsg.includes('YES') ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="spinner !w-4 !h-4 !border-white/30 !border-t-white" />
                    Voting...
                  </span>
                ) : (
                  'Vote YES'
                )}
              </button>
              <button
                onClick={() => handleVote(PermissibleVotes.no)}
                disabled={isLoading}
                className="btn-secondary flex-1"
              >
                {isLoading && loadingMsg.includes('NO') ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="spinner !w-4 !h-4" />
                    Voting...
                  </span>
                ) : (
                  'Vote NO'
                )}
              </button>
            </div>
          </div>
        )}

        {/* Voter actions — Reveal phase */}
        {role === 'voter' && currentPhase === 2 && (
          <div className="border-t border-midnight-600 pt-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Reveal Your Vote</h3>
            <button onClick={handleReveal} disabled={isLoading} className="btn-primary w-full">
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="spinner !w-4 !h-4 !border-white/30 !border-t-white" />
                  Revealing...
                </span>
              ) : (
                'Reveal Vote'
              )}
            </button>
          </div>
        )}

        {/* Final phase — Results */}
        {currentPhase === 3 && (
          <div className="border-t border-midnight-600 pt-4 mb-4">
            <div className="text-center p-4 bg-midnight-800 rounded-lg">
              <p className="text-sm text-gray-400 mb-2">Final Results</p>
              <div className="flex justify-center gap-8">
                <div>
                  <p className="text-3xl font-bold text-green-400">{electionState?.tallyYes ?? '0'}</p>
                  <p className="text-xs text-gray-400">YES</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-red-400">{electionState?.tallyNo ?? '0'}</p>
                  <p className="text-xs text-gray-400">NO</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Refresh */}
        <div className="flex justify-center mb-4">
          <button onClick={handleRefresh} disabled={isLoading} className="btn-secondary">
            Refresh State
          </button>
        </div>

        {/* Loading indicator */}
        {isLoading && (
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
