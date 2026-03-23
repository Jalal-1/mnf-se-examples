import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { FungibleToken, type FungibleTokenPrivateState } from '@mnf-se/fungible-token-contract';
import type { MidnightProviders, FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

// ── Types ──────────────────────────────────────────────────────────────────

export type FTCircuits = ProvableCircuitId<FungibleToken.Contract<FungibleTokenPrivateState>>;

export const FTPrivateStateId = 'fungibleTokenPrivateState';

export type FTProviders = MidnightProviders<
  FTCircuits,
  typeof FTPrivateStateId,
  FungibleTokenPrivateState
>;

export type DeployedFTContract =
  | DeployedContract<FungibleToken.Contract<FungibleTokenPrivateState>>
  | FoundContract<FungibleToken.Contract<FungibleTokenPrivateState>>;

// ── Either helpers ─────────────────────────────────────────────────────────

type Either<A, B> = { is_left: boolean; left: A; right: B };
type ZswapCoinPublicKey = { bytes: Uint8Array };
type FTContractAddress = { bytes: Uint8Array };

export type FTEither = Either<ZswapCoinPublicKey, FTContractAddress>;

/** Wrap a ZswapCoinPublicKey as left(key) in an Either<ZswapCoinPublicKey, ContractAddress> */
export function left(pubKeyBytes: Uint8Array): FTEither {
  return {
    is_left: true,
    left: { bytes: pubKeyBytes },
    right: { bytes: new Uint8Array(32) },
  };
}

/** Wrap a ContractAddress as right(addr) in an Either<ZswapCoinPublicKey, ContractAddress> */
export function right(addrBytes: Uint8Array): FTEither {
  return {
    is_left: false,
    left: { bytes: new Uint8Array(32) },
    right: { bytes: addrBytes },
  };
}

// ── Compiled contract (browser — ZK assets served via HTTP) ────────────────

const FT_ZK_PATH = './contract/fungible-token';

const fungibleTokenCompiledContract = CompiledContract.make(
  'FungibleToken',
  FungibleToken.Contract,
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(FT_ZK_PATH),
);

// ── Deploy / Join ──────────────────────────────────────────────────────────

export async function deploy(
  providers: FTProviders,
  name: string,
  symbol: string,
  decimals: bigint,
): Promise<DeployedFTContract> {
  return await deployContract(providers as any, {
    compiledContract: fungibleTokenCompiledContract,
    privateStateId: FTPrivateStateId,
    initialPrivateState: {} as FungibleTokenPrivateState,
    args: [name, symbol, decimals],
  });
}

export async function joinContract(
  providers: FTProviders,
  contractAddress: string,
): Promise<DeployedFTContract> {
  return await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: fungibleTokenCompiledContract,
    privateStateId: FTPrivateStateId,
    initialPrivateState: {} as FungibleTokenPrivateState,
  });
}

// ── Circuit Calls ──────────────────────────────────────────────────────────

export async function mint(
  contract: DeployedFTContract,
  account: FTEither,
  value: bigint,
): Promise<FinalizedTxData> {
  const result = await contract.callTx.mint(account, value);
  return result.public;
}

export async function burn(
  contract: DeployedFTContract,
  account: FTEither,
  value: bigint,
): Promise<FinalizedTxData> {
  const result = await contract.callTx.burn(account, value);
  return result.public;
}

export async function transfer(
  contract: DeployedFTContract,
  to: FTEither,
  value: bigint,
): Promise<FinalizedTxData> {
  const result = await contract.callTx.transfer(to, value);
  return result.public;
}

export async function balanceOf(
  contract: DeployedFTContract,
  account: FTEither,
): Promise<{ tx: FinalizedTxData; balance: bigint }> {
  const result = await contract.callTx.balanceOf(account);
  return { tx: result.public, balance: result.private.result as bigint };
}

export async function totalSupply(
  contract: DeployedFTContract,
): Promise<{ tx: FinalizedTxData; supply: bigint }> {
  const result = await contract.callTx.totalSupply();
  return { tx: result.public, supply: result.private.result as bigint };
}

// ── Read Contract State (via ledger query) ─────────────────────────────────

export type FungibleTokenState = {
  name: string;
  symbol: string;
  decimals: bigint;
  totalSupply: bigint;
};

export async function getState(
  providers: FTProviders,
  contractAddress: string,
): Promise<FungibleTokenState | null> {
  const state = await providers.publicDataProvider.queryContractState(
    contractAddress as ContractAddress,
  );
  if (!state) return null;

  try {
    const ledgerState = FungibleToken.ledger(state.data) as Record<string, unknown>;
    return {
      name: (ledgerState['name'] ?? '') as string,
      symbol: (ledgerState['symbol'] ?? '') as string,
      decimals: (ledgerState['decimals'] ?? 0n) as bigint,
      totalSupply: (ledgerState['totalSupply'] ?? 0n) as bigint,
    };
  } catch {
    return null;
  }
}
