// MultiToken has no local witnesses.
// Identity is provided by the built-in ownPublicKey() in the Compact contract.
// This file exists for consistency with the per-app pattern.

export type MultiTokenPrivateState = Record<string, never>;

export const witnesses = {};
