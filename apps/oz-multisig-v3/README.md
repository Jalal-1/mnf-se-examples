# OZ ShieldedMultiSigV3 Harness

This app vendors the `ShieldedMultiSigV3.compact` shape from Andrew Fleming's
`re-add-multisig-v3` branch and wraps it in a small CLI.

The contract uses:

- signer commitments derived from 64-byte ECDSA-style public keys
- threshold `2 of 3` authorization
- stubbed ECDSA verification, matching the upstream test contract
- `mintShieldedToken(...)` for minting
- the V3 burn pattern: `receiveShielded(...)` then `sendShielded(..., shieldedBurnAddress(), ...)`

The guided flow deploys a fresh contract, mints a shielded token to the local
wallet, auto-selects the freshly minted wallet coin, and burns it through the
exact OZ V3 `receiveShielded + sendShielded(shieldedBurnAddress())` circuit.
No local manifest is used.

For an existing contract, the CLI can auto-select matching wallet-owned coins.
The manual burn path remains available when you already have qualified operator
coin fields: `color`, `nonce`, `value`, and `mt_index`.

## Run

From the repo root:

```bash
npm install
npm run build:oz-multisig-v3
npm run docker:up
npm run oz-multisig-v3:undeployed
```

Preview/preprod:

```bash
npm run docker:proof
npm run oz-multisig-v3:preview
npm run oz-multisig-v3:preprod
```
