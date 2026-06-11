import { MultisigToken, type MultisigTokenPrivateState } from '@mnf-se/multisig-token-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

export type MultisigTokenCircuits = ProvableCircuitId<MultisigToken.Contract<MultisigTokenPrivateState>>;

export const MultisigTokenPrivateStateId = 'multisigTokenPrivateState';

export type MultisigTokenProviders = MidnightProviders<
  MultisigTokenCircuits,
  typeof MultisigTokenPrivateStateId,
  MultisigTokenPrivateState
>;

export type MultisigTokenContract = MultisigToken.Contract<MultisigTokenPrivateState>;

export type DeployedMultisigTokenContract =
  | DeployedContract<MultisigTokenContract>
  | FoundContract<MultisigTokenContract>;
