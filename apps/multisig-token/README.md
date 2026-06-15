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
8. Optional burn: choose a spendable shielded token coin from your wallet and send the burn amount to `shieldedBurnAddress()`.

For the simplest demo, press Enter through the ceremony prompts, use the default token name, mint `100` tokens, choose recipient `1` for your own shielded wallet, and press Enter at the signer prompt to sign with signers `1` and `2`.

The CLI keeps a fixed dashboard on screen while you work. It shows the active wallet, active token, signer ceremony, tracked proposals, recent activity, and a bottom guide strip for the current instruction. If you deploy or join more than one token in the same session, use `n` and `p` to cycle the active token. Tokens deployed by this CLI keep their local demo signer ceremony for the session; joined contracts are view/burn only unless they were deployed in the same session.

## Recipients

The mint proposal includes the recipient, so signers approve exactly who receives the token.

Supported recipient choices:

- Your shielded wallet ZSwap public key.
- Another shielded wallet ZSwap public key.
- This contract address.
- Another contract address.

Contract recipients are useful for treasury-style flows. This app focuses on multisig-controlled mint authorization. A full treasury custody and release workflow can be layered on with the `ShieldedTreasury` reference modules.

## Burn

The CLI's `burn` option sends tokens to `shieldedBurnAddress()`.

For the easiest demo, choose wallet auto-select. The CLI will show your wallet coins, including `value`, `nonce`, and `mt_index`, then call the wallet-friendly `receiveShielded + sendImmediateShielded(shieldedBurnAddress())` path. Wallet auto-select burns the selected coin whole so the example does not create untracked contract-owned change.

The burn menu also includes a manual operator path that mirrors the OZ multisig V3 pattern: `receiveShielded + sendShielded(shieldedBurnAddress())`. That path requires a contract-owned `QualifiedShieldedCoinInfo`, including `nonce`, `value`, and `mt_index`, from the operator/indexer UTXO tracking flow. This app does not add a local manifest for those operator coins.

If you mint `100` tokens as one wallet coin, the wallet demo burns the full `100`. Partial burns can create contract-owned change, which needs operator tracking for follow-up spends.

## Manual Flow

Use the manual menu to:

1. Generate signer keys.
2. Deploy a named shielded token mint controller.
3. Deploy or join additional token controllers.
4. Cycle the active token with `n` and `p`.
5. Create one or more mint proposals for the active token.
6. Approve a proposal with any two signer slots when local signer keys are available.
7. Execute the proposal.
8. Refresh active contract supply and wallet balance.
9. Burn one of your spendable shielded token coins to the shielded burn address.
