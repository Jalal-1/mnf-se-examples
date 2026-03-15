import { type Ledger, type Witnesses } from './managed/token/contract/index.js';
import { type WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { webcrypto } from 'crypto';

export type TokenPrivateState = {
  readonly secretKey: Uint8Array;
};

export function createWitnesses(): Witnesses<TokenPrivateState> {
  return {
    local$secret_key(
      context: WitnessContext<Ledger, TokenPrivateState>,
    ): [TokenPrivateState, Uint8Array] {
      return [context.privateState, context.privateState.secretKey];
    },

    local$nonce(
      context: WitnessContext<Ledger, TokenPrivateState>,
    ): [TokenPrivateState, Uint8Array] {
      const nonce = new Uint8Array(32);
      webcrypto.getRandomValues(nonce);
      return [context.privateState, nonce];
    },
  };
}
