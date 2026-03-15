# MNF Solutions Engineering Examples

A growing collection of mini example applications on the [Midnight Network](https://midnight.network/), built by the MNF Solutions Engineering team.

Serves as both **deployable apps** and an **AI coding knowledge base** for building Midnight DApps.

## Apps

| App | Description | Status |
|-----|-------------|--------|
| **counter** | Simple on-chain counter (public state) | Working |
| **token** | Shielded & unshielded token minting (Zswap + UTXO) | Shielded working, unshielded pending node fix |

## SDK Versions

| Package | Version |
|---------|---------|
| Compact compiler | 0.29.0 |
| midnight-js-* | 3.2.0 |
| wallet-sdk-* | 2.0.0 |
| ledger-v7 | 7.0.3 |
| compact-runtime | 0.14.0 |
| proof-server (Docker) | 7.0.0 |

## Prerequisites

- [Node.js v22.15+](https://nodejs.org/)
- [Docker](https://docs.docker.com/get-docker/) with `docker compose`
- [Compact compiler](https://github.com/midnightntwrk/compact) (`compact update 0.29.0`)

## Quick Start (Standalone / Local)

```bash
# Install dependencies
npm install

# Start local testnet (node + indexer + proof server)
docker compose -f docker/standalone.yml up -d

# Compile a contract
cd apps/counter/contract && npm run compact && npm run build && cd ../../..

# Run the counter
npm -w @mnf-se/counter-cli run standalone

# Run the token app
cd apps/token/contract && npm run compact && npm run build && cd ../../..
npm -w @mnf-se/token-cli run standalone
```

## Quick Start (Preview Testnet)

```bash
npm install

# Start proof server only (node + indexer are remote)
docker compose -f docker/proof-server.yml up -d

# Run against preview
npm -w @mnf-se/counter-cli run preview
npm -w @mnf-se/token-cli run preview
```

Fund your wallet from the [Preview faucet](https://faucet.preview.midnight.network).

## Project Structure

```
mnf-se-examples/
├── packages/common/        # @mnf-se/common — shared wallet, providers, display
├── apps/counter/           # Simple counter DApp
│   ├── contract/           # Compact contract + TypeScript bindings
│   └── cli/                # Interactive CLI
├── apps/token/             # Shielded & unshielded token DApp
│   ├── contract/           # Token contract (mint, burn, get_total_supply)
│   └── cli/                # Authority/user CLI with ANSI dashboard
├── docker/                 # Docker Compose files
│   ├── proof-server.yml    # Proof server only (for preview/preprod)
│   ├── standalone.yml      # Full local stack (node + indexer + proof server)
│   └── standalone.env      # Indexer environment variables
└── CLAUDE.md               # AI coding knowledge base
```

## Adding a New App

See [CLAUDE.md](CLAUDE.md) for detailed instructions on the per-app pattern and how to add new mini applications.

## License

Apache-2.0
