import React, { useState, useCallback, useRef } from 'react';
import { useWallet } from '../contexts/WalletContext.js';
import { buildContractProviders } from '../lib/build-providers.js';
import { AccessControl } from '@mnf-se/access-control-contract';
import type { AccessControlPrivateState } from '@mnf-se/access-control-contract';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';
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
type ACCircuits = ProvableCircuitId<AccessControl.Contract<AccessControlPrivateState>>;
const ACPrivateStateId = 'accessControlPrivateState';
type ACProviders = MidnightProviders<ACCircuits, typeof ACPrivateStateId, AccessControlPrivateState>;
type DeployedAC = DeployedContract<AccessControl.Contract<AccessControlPrivateState>> | FoundContract<AccessControl.Contract<AccessControlPrivateState>>;

type EitherAddr = { is_left: boolean; left: { bytes: Uint8Array }; right: { bytes: Uint8Array } };

function leftPublicKey(pubKeyBytes: Uint8Array): EitherAddr {
  return { is_left: true, left: { bytes: pubKeyBytes }, right: { bytes: new Uint8Array(32) } };
}

// Well-known role IDs
const ROLES = [
  { label: 'DEFAULT_ADMIN_ROLE', value: new Uint8Array(32) },
  { label: 'MINTER_ROLE', value: (() => { const r = new Uint8Array(32); r[0] = 1; return r; })() },
  { label: 'PAUSER_ROLE', value: (() => { const r = new Uint8Array(32); r[0] = 2; return r; })() },
];

interface Props {
  onLog: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export function AccessControlTab({ onLog }: Props) {
  const { shared } = useWallet();
  const providersRef = useRef<ACProviders | null>(null);
  const compiledRef = useRef<ReturnType<typeof CompiledContract.make> | null>(null);

  const [contract, setContract] = useState<DeployedAC | null>(null);
  const [contractAddress, setContractAddress] = useState('');
  const [joinAddress, setJoinAddress] = useState('');

  // Action inputs
  const [selectedRole, setSelectedRole] = useState(0);
  const [roleAccountHex, setRoleAccountHex] = useState('');

  // Display state
  const [counterValue, setCounterValue] = useState<bigint | null>(null);
  const [isPaused, setIsPaused] = useState<boolean | null>(null);
  const [roleCheckResult, setRoleCheckResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [lastTxId, setLastTxId] = useState('');
  const [copied, setCopied] = useState(false);

  const getProviders = useCallback((): ACProviders => {
    if (providersRef.current) return providersRef.current;
    if (!shared) throw new Error('Wallet not connected');
    const providers = buildContractProviders<ACCircuits>('contract/access-control', shared);
    providersRef.current = providers;
    return providers;
  }, [shared]);

  const getCompiled = useCallback(() => {
    if (compiledRef.current) return compiledRef.current;
    const compiled = CompiledContract.make('AccessControl', AccessControl.Contract).pipe(
      CompiledContract.withVacantWitnesses,
      CompiledContract.withCompiledFileAssets('./contract/access-control'),
    );
    compiledRef.current = compiled as any;
    return compiled as any;
  }, []);

  const refreshState = useCallback(async (addr: string) => {
    try {
      const providers = getProviders();
      const state = await providers.publicDataProvider.queryContractState(addr as ContractAddress);
      if (state?.data) {
        const ledgerState = AccessControl.ledger(state.data);
        setCounterValue(ledgerState.counter);
      }
    } catch (e) {
      console.warn('Failed to refresh state:', e);
    }
  }, [getProviders]);

  const handleDeploy = useCallback(async () => {
    if (!shared) return;
    setIsLoading(true);
    setLoadingMsg('Deploying AccessControl contract (generating ZK proof)...');
    onLog('Deploying AccessControl contract...');
    try {
      const providers = getProviders();
      const compiled = getCompiled();
      const deployed = await deployContract(providers as any, {
        compiledContract: compiled,
      } as any);
      const addr = deployed.deployTxData.public.contractAddress;
      setContract(deployed as any);
      setContractAddress(addr);
      await refreshState(addr);
      onLog(`AccessControl deployed at ${addr.substring(0, 20)}...`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Deploy failed: ${msg}`, 'error');
      console.error('Deploy error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [shared, onLog, getProviders, getCompiled, refreshState]);

  const handleJoin = useCallback(async () => {
    if (!shared || !joinAddress.trim()) return;
    setIsLoading(true);
    setLoadingMsg('Joining AccessControl contract...');
    onLog(`Joining AccessControl at ${joinAddress.substring(0, 20)}...`);
    try {
      const providers = getProviders();
      const compiled = getCompiled();
      const found = await findDeployedContract(providers as any, {
        contractAddress: joinAddress.trim(),
        compiledContract: compiled,
        privateStateId: ACPrivateStateId,
        initialPrivateState: {} as AccessControlPrivateState,
      });
      setContract(found as any);
      setContractAddress(joinAddress.trim());
      await refreshState(joinAddress.trim());
      onLog('Successfully joined AccessControl contract', 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Join failed: ${msg}`, 'error');
      console.error('Join error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [shared, joinAddress, onLog, getProviders, getCompiled, refreshState]);

  const handleIncrement = useCallback(async () => {
    if (!contract) return;
    setIsLoading(true);
    setLoadingMsg('Incrementing counter (generating ZK proof)...');
    onLog('Incrementing counter...');
    try {
      const result = await contract.callTx.increment();
      setLastTxId(result.public.txId);
      await refreshState(contractAddress);
      onLog(`Counter incremented (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Increment failed: ${msg}`, 'error');
      console.error('Increment error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, contractAddress, onLog, refreshState]);

  const handlePause = useCallback(async () => {
    if (!contract) return;
    setIsLoading(true);
    setLoadingMsg('Pausing contract...');
    onLog('Pausing contract...');
    try {
      const result = await contract.callTx.pause();
      setLastTxId(result.public.txId);
      setIsPaused(true);
      onLog(`Contract paused (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Pause failed: ${msg}`, 'error');
      console.error('Pause error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, onLog]);

  const handleUnpause = useCallback(async () => {
    if (!contract) return;
    setIsLoading(true);
    setLoadingMsg('Unpausing contract...');
    onLog('Unpausing contract...');
    try {
      const result = await contract.callTx.unpause();
      setLastTxId(result.public.txId);
      setIsPaused(false);
      onLog(`Contract unpaused (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Unpause failed: ${msg}`, 'error');
      console.error('Unpause error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, onLog]);

  const parseAccountBytes = useCallback((hex: string): Uint8Array => {
    const cleaned = hex.trim().replace(/^0x/, '');
    const bytes = new Uint8Array(32);
    for (let i = 0; i < Math.min(cleaned.length / 2, 32); i++) {
      bytes[i] = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }, []);

  const handleGrantRole = useCallback(async () => {
    if (!contract) return;
    if (!roleAccountHex.trim()) {
      onLog('Account address is required', 'error');
      return;
    }
    setIsLoading(true);
    setLoadingMsg('Granting role (generating ZK proof)...');
    onLog(`Granting ${ROLES[selectedRole].label}...`);
    try {
      const roleId = ROLES[selectedRole].value;
      const accountBytes = parseAccountBytes(roleAccountHex);
      const account = leftPublicKey(accountBytes);
      const result = await contract.callTx.grantRole(roleId, account);
      setLastTxId(result.public.txId);
      onLog(`Role granted (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Grant role failed: ${msg}`, 'error');
      console.error('GrantRole error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, selectedRole, roleAccountHex, onLog, parseAccountBytes]);

  const handleRevokeRole = useCallback(async () => {
    if (!contract) return;
    if (!roleAccountHex.trim()) {
      onLog('Account address is required', 'error');
      return;
    }
    setIsLoading(true);
    setLoadingMsg('Revoking role (generating ZK proof)...');
    onLog(`Revoking ${ROLES[selectedRole].label}...`);
    try {
      const roleId = ROLES[selectedRole].value;
      const accountBytes = parseAccountBytes(roleAccountHex);
      const account = leftPublicKey(accountBytes);
      const result = await contract.callTx.revokeRole(roleId, account);
      setLastTxId(result.public.txId);
      onLog(`Role revoked (tx: ${result.public.txId.substring(0, 16)}...)`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Revoke role failed: ${msg}`, 'error');
      console.error('RevokeRole error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, selectedRole, roleAccountHex, onLog, parseAccountBytes]);

  const handleCheckRole = useCallback(async () => {
    if (!contract) return;
    if (!roleAccountHex.trim()) {
      onLog('Account address is required', 'error');
      return;
    }
    setIsLoading(true);
    setLoadingMsg('Checking role...');
    onLog(`Checking ${ROLES[selectedRole].label}...`);
    try {
      const roleId = ROLES[selectedRole].value;
      const accountBytes = parseAccountBytes(roleAccountHex);
      const account = leftPublicKey(accountBytes);
      const result = await contract.callTx.hasRole(roleId, account);
      const hasIt = result.private.result as boolean;
      setRoleCheckResult(`${ROLES[selectedRole].label}: ${hasIt ? 'YES' : 'NO'}`);
      setLastTxId(result.public.txId);
      onLog(`Has ${ROLES[selectedRole].label}: ${hasIt}`, 'success');
    } catch (e) {
      const msg = extractError(e);
      onLog(`Check role failed: ${msg}`, 'error');
      console.error('HasRole error:', e);
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, [contract, selectedRole, roleAccountHex, onLog, parseAccountBytes]);

  const handleRefresh = useCallback(async () => {
    if (!contractAddress) return;
    onLog('Refreshing contract state...');
    await refreshState(contractAddress);
    onLog('Contract state refreshed', 'success');
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
        <h2 className="text-2xl font-bold text-center mb-8">Access Control</h2>

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
                Create a new access-controlled contract (you become admin)
              </p>
              <button onClick={handleDeploy} className="btn-primary w-full">
                Deploy Access Control
              </button>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold mb-2">Join Existing</h3>
              <p className="text-sm text-gray-400 mb-4">
                Connect to a deployed contract by address
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
        <h2 className="text-xl font-bold text-center mb-6">Access Control</h2>

        {/* State display */}
        <div className="space-y-3 mb-6">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Counter Value</span>
            <span className="text-white font-mono text-2xl">{counterValue?.toString() ?? '...'}</span>
          </div>
          {isPaused !== null && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Paused</span>
              <span className={`font-semibold ${isPaused ? 'text-red-400' : 'text-green-400'}`}>
                {isPaused ? 'YES' : 'NO'}
              </span>
            </div>
          )}
          {roleCheckResult && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Role Check</span>
              <span className="text-white font-mono">{roleCheckResult}</span>
            </div>
          )}
        </div>

        {/* Counter + Pause */}
        <div className="border-t border-midnight-600 pt-4 mb-4">
          <div className="flex gap-3 mb-3">
            <button
              onClick={handleIncrement}
              disabled={isLoading}
              className="btn-primary flex-1"
            >
              {isLoading && loadingMsg.includes('Increment') ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="spinner !w-4 !h-4 !border-white/30 !border-t-white" />
                  Incrementing...
                </span>
              ) : (
                'Increment'
              )}
            </button>
            <button onClick={handleRefresh} disabled={isLoading} className="btn-secondary">
              Refresh
            </button>
          </div>
          <div className="flex gap-3">
            <button onClick={handlePause} disabled={isLoading} className="btn-secondary flex-1">
              Pause
            </button>
            <button onClick={handleUnpause} disabled={isLoading} className="btn-secondary flex-1">
              Unpause
            </button>
          </div>
        </div>

        {/* Role management */}
        <div className="border-t border-midnight-600 pt-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Role Management</h3>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(Number(e.target.value))}
            className="input mb-2"
          >
            {ROLES.map((role, idx) => (
              <option key={role.label} value={idx}>
                {role.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={roleAccountHex}
            onChange={(e) => setRoleAccountHex(e.target.value)}
            placeholder="Account public key (hex)"
            className="input mb-3"
          />
          <div className="grid grid-cols-3 gap-2">
            <button onClick={handleGrantRole} disabled={isLoading} className="btn-primary">
              Grant
            </button>
            <button onClick={handleRevokeRole} disabled={isLoading} className="btn-primary">
              Revoke
            </button>
            <button onClick={handleCheckRole} disabled={isLoading} className="btn-secondary">
              Check
            </button>
          </div>
        </div>

        {/* Loading indicator */}
        {isLoading && !loadingMsg.includes('Increment') && (
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
