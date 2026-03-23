import { AccessControl, type AccessControlPrivateState } from '@mnf-se/access-control-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';

// ── Types ──────────────────────────────────────────────────────────────────
export type ACCircuits = ProvableCircuitId<AccessControl.Contract<AccessControlPrivateState>>;
export const AccessControlPrivateStateId = 'accessControlPrivateState';
export type ACProviders = MidnightProviders<
  ACCircuits,
  typeof AccessControlPrivateStateId,
  AccessControlPrivateState
>;
export type DeployedACContract =
  | DeployedContract<AccessControl.Contract<AccessControlPrivateState>>
  | FoundContract<AccessControl.Contract<AccessControlPrivateState>>;

// ── Either helpers (for account parameters) ────────────────────────────
type Either<A, B> = { is_left: boolean; left: A; right: B };
type ZswapCoinPublicKey = { bytes: Uint8Array };
type ACContractAddress = { bytes: Uint8Array };
type EitherAccount = Either<ZswapCoinPublicKey, ACContractAddress>;

/** Wrap a ZswapCoinPublicKey as left(key) */
export const leftPublicKey = (pubKeyBytes: Uint8Array): EitherAccount => ({
  is_left: true,
  left: { bytes: pubKeyBytes },
  right: { bytes: new Uint8Array(32) },
});

/** Wrap a ContractAddress as right(addr) */
export const rightContractAddress = (addrBytes: Uint8Array): EitherAccount => ({
  is_left: false,
  left: { bytes: new Uint8Array(32) },
  right: { bytes: addrBytes },
});

// ── Role Constants ─────────────────────────────────────────────────────
// MINTER_ROLE and PAUSER_ROLE are persistentHash of their names in the contract.
// They are read from ledger state at runtime. DEFAULT_ADMIN_ROLE is all zeros.
export const DEFAULT_ADMIN_ROLE = new Uint8Array(32);

// These will be populated from the ledger state. Export helpers to read them.
// The actual bytes are: persistentHash(pad(32, "MINTER_ROLE")) and
// persistentHash(pad(32, "PAUSER_ROLE")), which are stored in the contract ledger.
// To obtain them, call getState() and read minterRole / pauserRole.

// ── Compiled contract (browser — ZK assets served via HTTP) ────────────
const AC_ZK_PATH = './contract/access-control';

const accessControlCompiledContract = CompiledContract.make(
  'AccessControl',
  AccessControl.Contract,
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(AC_ZK_PATH),
);

// ── Contract operations ────────────────────────────────────────────────

export async function deploy(
  providers: ACProviders,
): Promise<DeployedACContract> {
  return await deployContract(providers as any, {
    compiledContract: accessControlCompiledContract,
  } as any) as any;
}

export async function joinContract(
  providers: ACProviders,
  contractAddress: string,
): Promise<DeployedACContract> {
  return await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: accessControlCompiledContract,
    privateStateId: AccessControlPrivateStateId,
    initialPrivateState: {} as AccessControlPrivateState,
  }) as any;
}

export async function increment(
  contract: DeployedACContract,
): Promise<string> {
  const result = await contract.callTx.increment();
  return result.public.txId;
}

export async function pause(
  contract: DeployedACContract,
): Promise<string> {
  const result = await contract.callTx.pause();
  return result.public.txId;
}

export async function unpause(
  contract: DeployedACContract,
): Promise<string> {
  const result = await contract.callTx.unpause();
  return result.public.txId;
}

export async function grantRole(
  contract: DeployedACContract,
  roleId: Uint8Array,
  account: EitherAccount,
): Promise<string> {
  const result = await contract.callTx.grantRole(roleId, account);
  return result.public.txId;
}

export async function revokeRole(
  contract: DeployedACContract,
  roleId: Uint8Array,
  account: EitherAccount,
): Promise<string> {
  const result = await contract.callTx.revokeRole(roleId, account);
  return result.public.txId;
}

export async function hasRole(
  contract: DeployedACContract,
  roleId: Uint8Array,
  account: EitherAccount,
): Promise<boolean> {
  const result = await contract.callTx.hasRole(roleId, account);
  return result.private.result as boolean;
}

// ── Read Contract State ────────────────────────────────────────────────

export type AccessControlState = {
  counter: bigint;
  minterRole: Uint8Array;
  pauserRole: Uint8Array;
  defaultAdminRole: Uint8Array;
};

export async function getState(
  providers: ACProviders,
  addr: string,
): Promise<AccessControlState | null> {
  const contractState = await providers.publicDataProvider.queryContractState(
    addr as ContractAddress,
  );
  if (!contractState?.data) return null;
  const ledgerState = AccessControl.ledger(contractState.data);
  return {
    counter: ledgerState.counter,
    minterRole: ledgerState.MINTER_ROLE as Uint8Array,
    pauserRole: ledgerState.PAUSER_ROLE as Uint8Array,
    defaultAdminRole: DEFAULT_ADMIN_ROLE,
  };
}
