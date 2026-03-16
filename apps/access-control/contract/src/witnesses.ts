// AccessControl has no local witnesses.
// Identity is provided by the built-in ownPublicKey() in the Compact contract.
// This file exists for consistency with the per-app pattern.

export type AccessControlPrivateState = {
  readonly _unused?: undefined;
};

export const witnesses = {};
