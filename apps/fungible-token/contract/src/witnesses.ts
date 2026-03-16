// FungibleToken has no local witnesses.
// Identity is provided by the built-in ownPublicKey() in the Compact contract.
// This file exists for consistency with the per-app pattern.
// We still need a private state type for the midnight-js framework, even though it's unused.

export type FungibleTokenPrivateState = {
  readonly _unused?: undefined;
};
