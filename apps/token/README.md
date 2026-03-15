# Shielded Token

A token contract demonstrating shielded (Zswap) and unshielded (UTXO) token minting with owner-only access control.

## Concepts

- **Shielded tokens** via `mintShieldedToken()` — privacy-preserving, Zswap protocol layer
- **Token color** derived from `(domain_separator, contract_address)` — unique per deployment
- **Access control** via `assert_owner()` — only the deployer can mint/burn
- **Witnesses** — `local$secret_key` and `local$nonce` provide private data to circuits
- **`disclose()`** — selectively reveals values in ZK proofs

## Contract

```compact
export circuit mint(amount: Uint<16>, recipient_key: ZswapCoinPublicKey): ShieldedCoinInfo {
  assert_owner();
  assert(disclose(amount) > 0, "Amount must be greater than zero");
  total_supply.increment(amount as Field);
  disclose(domain_separator);
  mintShieldedToken(domain_separator, recipient_key, amount as Field, local$nonce())
}
```

## Build & Run

```bash
# From monorepo root
cd apps/token/contract && npm run compact && npm run build && cd ../../..

# Standalone (local testnet)
docker compose -f docker/standalone.yml up -d
npm -w @mnf-se/token-cli run standalone

# Preview testnet
docker compose -f docker/proof-server.yml up -d
npm -w @mnf-se/token-cli run preview
```

## Menu (Authority)

```
1  Mint tokens (shielded)
2  View total supply
3  View all shielded balances
4  Refresh
5  Exit
```

When minting, choose to mint to self or another address by providing a recipient's ZswapCoinPublicKey.

## Known Issues

- **Unshielded minting** hits error 139 (`Invalid Transaction: Custom error: 139`) — a known node-level issue pending fix.
- Shielded minting works end-to-end on standalone and preview.
