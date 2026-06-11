# Schnorr Multisig

Guided 2-of-3 multisig example using real Schnorr-on-Jubjub signature verification in Compact.

The CLI is intentionally demo-friendly: one user steps through a key ceremony, generates three local signing keys, chooses any two signer slots, signs the proposal with those keys, submits the two approvals, and executes the proposal.

This app does not use `ownPublicKey()` for authorization (ownPublicKey is not reliable as a source of identity). The transaction submitter only pays fees; authorization comes from the signatures verified by the contract.

## Run

```bash
npm run build:multisig
npm run docker:up
npm run multisig
```

For testnets:

```bash
npm run docker:proof
npm run multisig:preview
npm run multisig:preprod
```

## Guided Flow

Choose `Guided key ceremony + approval walkthrough` from the CLI. It is the recommended first path. The CLI pauses between stages so the user can see what is happening before moving on.

1. Key ceremony: generate three local Jubjub signing keys and review their public keys.
2. Deploy: store those three public keys with threshold `2`.
3. Propose: create a proposal from your action text.
4. Sign and approve: choose any two signer slots, produce two Schnorr signatures locally, and submit both approvals.
5. Execute: execute the proposal after the threshold is met.
6. Review: inspect the final contract state.

For the simplest demo, press Enter through the ceremony prompts, press Enter at the proposal prompt to use the default action text, then press Enter again at the signer prompt to sign with signers `1` and `2`. To show that any two signers work, enter a pair such as `1 3` or `2 3`.

The first contract version is an approved-action multisig. It records the approved action hash and execution status. Treasury movement can be layered on later once the signature UX is clear.
