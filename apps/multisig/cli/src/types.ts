import { Multisig, type MultisigPrivateState } from '@mnf-se/multisig-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

export type MultisigCircuits = ProvableCircuitId<Multisig.Contract<MultisigPrivateState>>;

export const MultisigPrivateStateId = 'multisigPrivateState';

export type MultisigProviders = MidnightProviders<
  MultisigCircuits,
  typeof MultisigPrivateStateId,
  MultisigPrivateState
>;

export type MultisigContract = Multisig.Contract<MultisigPrivateState>;

export type DeployedMultisigContract = DeployedContract<MultisigContract> | FoundContract<MultisigContract>;
