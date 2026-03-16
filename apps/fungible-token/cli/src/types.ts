import { FungibleToken, type FungibleTokenPrivateState } from '@mnf-se/fungible-token-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ImpureCircuitId } from '@midnight-ntwrk/compact-js';

export type FungibleTokenCircuits = ImpureCircuitId<FungibleToken.Contract<FungibleTokenPrivateState>>;

export const FungibleTokenPrivateStateId = 'fungibleTokenPrivateState';

export type FungibleTokenProviders = MidnightProviders<
  FungibleTokenCircuits,
  typeof FungibleTokenPrivateStateId,
  FungibleTokenPrivateState
>;

export type FungibleTokenContract = FungibleToken.Contract<FungibleTokenPrivateState>;

export type DeployedFungibleTokenContract =
  | DeployedContract<FungibleTokenContract>
  | FoundContract<FungibleTokenContract>;
