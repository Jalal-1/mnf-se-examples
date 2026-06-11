import { webcrypto } from 'node:crypto';
import { type WitnessContext } from '@midnight-ntwrk/compact-runtime';

import { type Ledger, type Witnesses } from './managed/multisig-token/contract/index.js';

export type MultisigTokenPrivateState = {
  readonly _unused?: undefined;
};

export const witnesses: Witnesses<MultisigTokenPrivateState> = {
  local$nonce(
    context: WitnessContext<Ledger, MultisigTokenPrivateState>,
  ): [MultisigTokenPrivateState, Uint8Array] {
    const nonce = new Uint8Array(32);
    webcrypto.getRandomValues(nonce);
    return [context.privateState, nonce];
  },
};
