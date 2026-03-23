import { MultiToken, type MultiTokenPrivateState } from '@mnf-se/multi-token-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';

// ── Types ──────────────────────────────────────────────────────────────────
export type MTCircuits = ProvableCircuitId<MultiToken.Contract<MultiTokenPrivateState>>;
export const MultiTokenPrivateStateId = 'multiTokenPrivateState';
export type MTProviders = MidnightProviders<
  MTCircuits,
  typeof MultiTokenPrivateStateId,
  MultiTokenPrivateState
>;
export type DeployedMTContract =
  | DeployedContract<MultiToken.Contract<MultiTokenPrivateState>>
  | FoundContract<MultiToken.Contract<MultiTokenPrivateState>>;

// ── Either helpers ─────────────────────────────────────────────────────
export type EitherAddress = MultiToken.Either<MultiToken.ZswapCoinPublicKey, MultiToken.ContractAddress>;

/** Wrap a ZswapCoinPublicKey as left(key) in an Either<ZswapCoinPublicKey, ContractAddress> */
export const leftPublicKey = (pubKeyBytes: Uint8Array): EitherAddress => ({
  is_left: true,
  left: { bytes: pubKeyBytes },
  right: { bytes: new Uint8Array(32) },
});

/** Wrap a ContractAddress as right(addr) in an Either<ZswapCoinPublicKey, ContractAddress> */
export const rightContractAddress = (addrBytes: Uint8Array): EitherAddress => ({
  is_left: false,
  left: { bytes: new Uint8Array(32) },
  right: { bytes: addrBytes },
});

// ── Compiled contract (browser — ZK assets served via HTTP) ────────────
const MT_ZK_PATH = './contract/multi-token';

const multiTokenCompiledContract = CompiledContract.make(
  'MultiToken',
  MultiToken.Contract,
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(MT_ZK_PATH),
);

// ── Contract operations ────────────────────────────────────────────────

export async function deploy(
  providers: MTProviders,
  uri: string,
): Promise<DeployedMTContract> {
  return await deployContract(providers as any, {
    compiledContract: multiTokenCompiledContract,
    privateStateId: MultiTokenPrivateStateId,
    initialPrivateState: {} as MultiTokenPrivateState,
    args: [uri],
  }) as any;
}

export async function joinContract(
  providers: MTProviders,
  contractAddress: string,
): Promise<DeployedMTContract> {
  return await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: multiTokenCompiledContract,
    privateStateId: MultiTokenPrivateStateId,
    initialPrivateState: {} as MultiTokenPrivateState,
  }) as any;
}

export async function mint(
  contract: DeployedMTContract,
  to: { bytes: Uint8Array },
  id: bigint,
  value: bigint,
): Promise<string> {
  const toEither = leftPublicKey(to.bytes);
  const result = await contract.callTx.mint(toEither, id, value);
  return result.public.txId;
}

export async function transferFrom(
  contract: DeployedMTContract,
  from: { bytes: Uint8Array },
  to: { bytes: Uint8Array },
  id: bigint,
  value: bigint,
): Promise<string> {
  const fromEither = leftPublicKey(from.bytes);
  const toEither = leftPublicKey(to.bytes);
  const result = await contract.callTx.transferFrom(fromEither, toEither, id, value);
  return result.public.txId;
}

export async function balanceOf(
  contract: DeployedMTContract,
  account: { bytes: Uint8Array },
  id: bigint,
): Promise<bigint> {
  const accountEither = leftPublicKey(account.bytes);
  const result = await contract.callTx.balanceOf(accountEither, id);
  return result.private.result as unknown as bigint;
}

export async function setURI(
  contract: DeployedMTContract,
  uri: string,
): Promise<string> {
  const result = await contract.callTx.setURI(uri);
  return result.public.txId;
}
