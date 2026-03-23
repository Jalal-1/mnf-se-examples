import { Counter, type CounterPrivateState } from '@mnf-se/counter-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';

// ── Types ──────────────────────────────────────────────────────────────────
export type CounterCircuits = ProvableCircuitId<Counter.Contract<CounterPrivateState>>;
export const CounterPrivateStateId = 'counterPrivateState';
export type CounterProviders = MidnightProviders<
  CounterCircuits,
  typeof CounterPrivateStateId,
  CounterPrivateState
>;
export type DeployedCounterContract =
  | DeployedContract<Counter.Contract<CounterPrivateState>>
  | FoundContract<Counter.Contract<CounterPrivateState>>;

// ── Compiled contract (browser — ZK assets served via HTTP) ────────────────
const COUNTER_ZK_PATH = './contract/counter';

const counterCompiledContract = CompiledContract.make('counter', Counter.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(COUNTER_ZK_PATH),
);

// ── Contract operations ────────────────────────────────────────────────────

export async function deploy(
  providers: CounterProviders,
): Promise<DeployedCounterContract> {
  return await deployContract(providers, {
    compiledContract: counterCompiledContract,
    privateStateId: CounterPrivateStateId,
    initialPrivateState: { privateCounter: 0 },
  });
}

export async function joinContract(
  providers: CounterProviders,
  contractAddress: string,
): Promise<DeployedCounterContract> {
  return await findDeployedContract(providers, {
    contractAddress,
    compiledContract: counterCompiledContract,
    privateStateId: CounterPrivateStateId,
    initialPrivateState: { privateCounter: 0 },
  });
}

export async function increment(
  contract: DeployedCounterContract,
): Promise<string> {
  const result = await contract.callTx.increment();
  return result.public.txId;
}

export async function getCounterLedgerState(
  providers: CounterProviders,
  contractAddress: string,
): Promise<bigint | null> {
  const state = await providers.publicDataProvider.queryContractState(
    contractAddress as ContractAddress,
  );
  return state != null ? Counter.ledger(state.data).round : null;
}
