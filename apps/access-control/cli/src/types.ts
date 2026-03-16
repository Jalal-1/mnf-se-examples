import { AccessControl, type AccessControlPrivateState } from '@mnf-se/access-control-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ImpureCircuitId } from '@midnight-ntwrk/compact-js';

export type AccessControlCircuits = ImpureCircuitId<AccessControl.Contract<AccessControlPrivateState>>;

export const AccessControlPrivateStateId = 'accessControlPrivateState';

export type AccessControlProviders = MidnightProviders<
  AccessControlCircuits,
  typeof AccessControlPrivateStateId,
  AccessControlPrivateState
>;

export type AccessControlContract = AccessControl.Contract<AccessControlPrivateState>;

export type DeployedAccessControlContract =
  | DeployedContract<AccessControlContract>
  | FoundContract<AccessControlContract>;
