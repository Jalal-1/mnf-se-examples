import { OzMultisigV3, type OzMultisigV3PrivateState } from '@mnf-se/oz-multisig-v3-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

export type OzMultisigV3Circuits = ProvableCircuitId<OzMultisigV3.Contract<OzMultisigV3PrivateState>>;

export const OzMultisigV3PrivateStateId = 'ozMultisigV3PrivateState';

export type OzMultisigV3Providers = MidnightProviders<
  OzMultisigV3Circuits,
  typeof OzMultisigV3PrivateStateId,
  OzMultisigV3PrivateState
>;

export type OzMultisigV3Contract = OzMultisigV3.Contract<OzMultisigV3PrivateState>;

export type DeployedOzMultisigV3Contract =
  | DeployedContract<OzMultisigV3Contract>
  | FoundContract<OzMultisigV3Contract>;
