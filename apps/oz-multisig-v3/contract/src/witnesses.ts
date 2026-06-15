import type { Witnesses } from './managed/oz-multisig-v3/contract/index.js';

export type OzMultisigV3PrivateState = {
  readonly _unused?: undefined;
};

export const witnesses: Witnesses<OzMultisigV3PrivateState> = {};
