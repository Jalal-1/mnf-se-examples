import { MultiToken, type MultiTokenPrivateState } from '@mnf-se/multi-token-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ImpureCircuitId } from '@midnight-ntwrk/compact-js';

export type MultiTokenCircuits = ImpureCircuitId<MultiToken.Contract<MultiTokenPrivateState>>;

export const MultiTokenPrivateStateId = 'multiTokenPrivateState';

export type MultiTokenProviders = MidnightProviders<
  MultiTokenCircuits,
  typeof MultiTokenPrivateStateId,
  MultiTokenPrivateState
>;

export type MultiTokenContract = MultiToken.Contract<MultiTokenPrivateState>;

export type DeployedMultiTokenContract =
  | DeployedContract<MultiTokenContract>
  | FoundContract<MultiTokenContract>;
