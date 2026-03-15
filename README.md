# MNF Solutions Engineering Examples

A growing collection of mini example applications on the [Midnight Network](https://midnight.network/), built by the MNF Solutions Engineering team.

Serves as both **deployable apps** and an **AI coding knowledge base** for building Midnight DApps.

## Apps

| App | Description | Concepts | Status |
|-----|-------------|----------|--------|
| [**counter**](apps/counter/) | Simple on-chain counter | Public state, basic circuit | Working |
| [**token**](apps/token/) | Shielded & unshielded token minting | Zswap, `mintShieldedToken`, access control, witnesses | Shielded working, unshielded pending node fix (error 139) |
| [**election**](apps/election/) | Privacy-preserving commit-reveal voting | MerkleTree state, nullifiers, commit-reveal, multi-party | Working |

## Prerequisites

- [Node.js v22.15+](https://nodejs.org/)
- [Docker](https://docs.docker.com/get-docker/) with `docker compose`
- [Compact compiler](https://github.com/midnightntwrk/compact) (`compact update 0.29.0`)

## Quick Start

```bash
# Clone and install
git clone https://github.com/Jalal-1/mnf-se-examples.git
cd mnf-se-examples
npm install

# Start local testnet (node + indexer + proof server)
docker compose -f docker/standalone.yml up -d

# Compile and run any app (e.g. counter)
cd apps/counter/contract && npm run compact && npm run build && cd ../../..
npm -w @mnf-se/counter-cli run standalone
```

For preview/preprod, only the proof server is needed locally:

```bash
docker compose -f docker/proof-server.yml up -d
npm -w @mnf-se/counter-cli run preview
```

Fund your wallet from the [Preview faucet](https://faucet.preview.midnight.network).

See each app's README for app-specific setup and walkthrough instructions.

## SDK Versions

| Package | Version |
|---------|---------|
| Compact compiler | 0.29.0 |
| midnight-js-* | 3.2.0 |
| wallet-sdk-* | 2.0.0 |
| ledger-v7 | 7.0.3 |
| compact-runtime | 0.14.0 |

## Docker Images (Standalone)

| Image | Version |
|-------|---------|
| midnight-node | 0.22.0-rc.10 |
| indexer-standalone | 4.0.0-rc.7 |
| proof-server | 8.0.2 |

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
├── apps/election/          # Privacy-preserving election DApp
│   ├── contract/           # Election contract (commit-reveal, MerkleTree)
│   └── cli/                # Authority/voter CLI
├── docker/                 # Docker Compose files
│   ├── proof-server.yml    # Proof server only (for preview/preprod)
│   ├── standalone.yml      # Full local stack (node + indexer + proof server)
│   └── standalone.env      # Indexer environment variables
├── patches/                # BMT rehash patch for compact-js (MerkleTree contracts)
└── CLAUDE.md               # AI coding knowledge base
```

## Shared Package: @mnf-se/common

All apps share a common package (`packages/common/`) that handles:

- **Wallet lifecycle** — HD key derivation, sub-wallet creation, sync, funding, DUST registration
- **Provider wiring** — bridges wallet-sdk to midnight-js contract API
- **Display utilities** — ANSI colors, spinners, balance formatting
- **Network config** — preview, preprod, and standalone endpoints
- **BMT rehash** — wrapper for contracts using MerkleTree state

## Adding a New App

See [CLAUDE.md](CLAUDE.md) for detailed instructions on the per-app pattern and how to add new mini applications.

## Known Issues

- **Error 139** (`Invalid Transaction: Custom error: 139`): Affects unshielded token minting. Known node-level issue, fix expected in upcoming SDK release.
- **BMT rehash**: Contracts with `MerkleTree` state require the `compact-js` patch (applied automatically via `patch-package` on `npm install`).
- **WebSocket disconnections**: Transient `RPC-CORE: subscribeRuntimeVersion()` disconnections during wallet sync are normal — the SDK reconnects automatically.

## License

Apache-2.0
