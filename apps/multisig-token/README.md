# Multisig Shielded Token Mint + Burn

Guided 2-of-3 multisig example that controls minting of a shielded ZSwap token and lets holders burn their own shielded token coins.

The user chooses the token name during deployment. The CLI then guides one person through a demo key ceremony, creates a mint proposal, signs that exact mint intent with any two of the three local demo signer keys, and executes the mint after the threshold is met.

This app does not use `ownPublicKey()` for authorization. The transaction submitter only pays fees. Mint authorization comes from Schnorr signatures verified by the contract. Burn authorization comes from shielded coin ownership enforced by ZSwap.

## Run

```bash
npm run build:multisig-token
npm run docker:up
npm run multisig-token
```

For testnets:

```bash
npm run docker:proof
npm run multisig-token:preview
npm run multisig-token:preprod
```

## Guided Flow

Choose `Guided key ceremony + shielded mint walkthrough` from the CLI. The CLI pauses between stages so the user can see what is happening before moving on.

1. Key ceremony: generate three local Jubjub signing keys and review their public keys.
2. Token setup: choose the shielded token name and deploy the mint controller with threshold `2`.
3. Mint proposal: choose amount and recipient.
4. Signing ceremony: choose any two signer slots, for example `1 3`.
5. Approval submission: produce two Schnorr signatures locally and submit both approvals.
6. Execute: mint the shielded ZSwap token after the threshold is met.
7. Review: inspect supply and wallet balance.
8. Optional burn: choose one spendable shielded token coin from your wallet and burn it.

For the simplest demo, press Enter through the ceremony prompts, use the default token name, mint `100` tokens, choose recipient `1` for your own shielded wallet, and press Enter at the signer prompt to sign with signers `1` and `2`.

## Recipients

The mint proposal includes the recipient, so signers approve exactly who receives the token.

Supported recipient choices:

- Your shielded wallet ZSwap public key.
- Another shielded wallet ZSwap public key.
- This contract address.
- Another contract address.

Contract recipients are useful for treasury-style flows. This app focuses on multisig-controlled mint authorization. A full treasury custody and release workflow can be layered on with the `ShieldedTreasury` reference modules.

## Burn

Burning is holder-controlled. The CLI lists spendable shielded coins in your wallet for this token color, asks which coin to burn, and submits the selected coin to the contract's `burn` circuit.

The current demo burns the selected shielded coin whole. If you mint `100` tokens as one coin, burning that coin burns all `100`. Partial burns would require a split/change flow and are intentionally left out of this simple example.

## Manual Flow

Use the manual menu to:

1. Generate signer keys.
2. Deploy a named shielded token mint controller.
3. Create one or more mint proposals.
4. Approve a proposal with any two signer slots.
5. Execute the proposal.
6. View contract supply and wallet balance.
7. Burn one of your spendable shielded token coins.
