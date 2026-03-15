# Counter

A minimal on-chain counter demonstrating the simplest possible Midnight DApp — public state with a single circuit.

## Concepts

- Public ledger state (`Counter` type)
- Impure circuits (state-modifying transactions)
- ZK proof generation for every transaction
- No witnesses needed (`CompiledContract.withVacantWitnesses`)

## Contract

```compact
export ledger round: Counter;

export circuit increment(): [] {
  round.increment(1);
}
```

The counter value is public on-chain. Each `increment()` call generates a ZK proof and submits a transaction.

## Build & Run

```bash
# From monorepo root
cd apps/counter/contract && npm run compact && npm run build && cd ../../..

# Standalone (local testnet)
docker compose -f docker/standalone.yml up -d
npm -w @mnf-se/counter-cli run standalone

# Preview testnet
docker compose -f docker/proof-server.yml up -d
npm -w @mnf-se/counter-cli run preview
```

## Menu

```
1  Deploy a new counter contract
2  Join an existing counter contract
3  Exit
```

After deploying or joining:

```
1  Increment counter
2  Refresh
3  Exit
```
