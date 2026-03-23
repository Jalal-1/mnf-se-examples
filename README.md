# MNF Solutions Engineering Examples

A collection of mini example applications on the [Midnight Network](https://midnight.network/).

Deployable apps and an AI coding knowledge base for building Midnight DApps.

## Apps

| App | Description | Concepts | Status |
|-----|-------------|----------|--------|
| [**counter**](apps/counter/) | Simple on-chain counter | Public state, basic circuit | Working |
| [**token**](apps/token/) | Shielded & unshielded token minting | Zswap, `mintShieldedToken`, access control, witnesses | Shielded working, unshielded pending fix ([#235](https://github.com/LFDT-Minokawa/compact/issues/235)) |
| [**election**](apps/election/) | Privacy-preserving commit-reveal voting | MerkleTree state, nullifiers, commit-reveal, multi-party | Working |
| [**fungible-token**](apps/fungible-token/) | ERC20-like fungible token | OZ FungibleToken, Map balances, transfer, approve, allowance | Working |
| [**nft**](apps/nft/) | ERC721-like non-fungible token | OZ NonFungibleToken, ownership, tokenURI, approvals | Working |
| [**multi-token**](apps/multi-token/) | ERC1155-like multi token | OZ MultiToken, batch mint/transfer, mixed fungible/NFT | Working |
| [**access-control**](apps/access-control/) | Role-based access control | OZ AccessControl, Pausable, role grants/revokes | Working |

## Web UI

A React web interface is also available (currently supports the Counter app):

```bash
npm run docker:up    # Start local testnet
npm run web          # Open http://localhost:5173
```

Supports two wallet modes:
- **Lace wallet** — connect via browser extension (DApp Connector)
- **Seed wallet** — enter a hex seed directly (no extension needed; genesis seed pre-funded on standalone)

## Prerequisites

- [Node.js v22+](https://nodejs.org/)
- [Docker](https://docs.docker.com/get-docker/) with `docker compose`
- [Compact compiler](https://github.com/midnightntwrk/compact) (`compact update 0.30.0-rc.1`)

## Quick Start

```bash
# Clone and install
git clone https://github.com/Jalal-1/mnf-se-examples.git
cd mnf-se-examples
npm install

# Build all contracts (first time only)
npm run build:all

# Start local testnet (node + indexer + proof server)
npm run docker:up

# Run any app (CLI)
npm run counter
npm run token
npm run election

# Or launch the web UI
npm run web
```

## Commands

### Run Apps (CLI)

| Command | Description |
|---------|-------------|
| `npm run counter` | Run counter on local testnet |
| `npm run token` | Run shielded token on local testnet |
| `npm run election` | Run election on local testnet |
| `npm run fungible-token` | Run fungible token (ERC20) on local testnet |
| `npm run nft` | Run NFT (ERC721) on local testnet |
| `npm run multi-token` | Run multi token (ERC1155) on local testnet |
| `npm run access-control` | Run access control on local testnet |

### Run Apps (Testnet)

For preview/preprod, start the proof server locally then run with the network suffix:

```bash
npm run docker:proof           # Proof server only (for testnet)
npm run counter:preview        # Preview network
npm run counter:preprod        # Preprod network
```

Fund your wallet from the [Preview faucet](https://faucet.preview.midnight.network) or [Preprod faucet](https://faucet.preprod.midnight.network).

### Web UI

| Command | Description |
|---------|-------------|
| `npm run web` | Start web UI dev server (http://localhost:5173) |
| `npm run web:build` | Production build |
| `npm run web:preview` | Preview production build |

### Docker

| Command | Description |
|---------|-------------|
| `npm run docker:up` | Start full local stack (node + indexer + proof server) |
| `npm run docker:down` | Stop local testnet |
| `npm run docker:logs` | Tail container logs |
| `npm run docker:reset` | Wipe all state and restart fresh |
| `npm run docker:proof` | Start proof server only (for preview/preprod) |

### Build

| Command | Description |
|---------|-------------|
| `npm run build:all` | Compile all Compact contracts + TypeScript |
| `npm run build:counter` | Compile counter contract only |
| `npm run typecheck` | Type-check all CLI code |

## SDK Versions

| Package | Version |
|---------|---------|
| Compact compiler | 0.30.0-rc.1 |
| compact-runtime | 0.15.0 |
| compact-js | 2.5.0-rc.3 |
| midnight-js-* | 4.0.0-rc.2 |
| wallet-sdk-facade | 3.0.0-rc.0 |
| ledger-v8 | 8.0.3-rc.1 |

## Docker Images (Standalone)

| Image | Version |
|-------|---------|
| midnight-node | 0.22.2 |
| indexer-standalone | 4.0.0 |
| proof-server | 8.0.2 |

## Project Structure

```
mnf-se-examples/
├── packages/common/        # @mnf-se/common — shared wallet, providers, display
├── contracts/              # Shared OZ-style Compact library
│   ├── token/              # FungibleToken, NonFungibleToken, MultiToken
│   ├── security/           # Initializable, Pausable
│   ├── access/             # Ownable, AccessControl
│   └── utils/              # Utils (zero address checks, etc.)
├── apps/counter/           # Simple counter DApp
├── apps/token/             # Shielded/unshielded token (Zswap)
├── apps/election/          # Privacy-preserving election (commit-reveal)
├── apps/fungible-token/    # ERC20-like fungible token
├── apps/nft/               # ERC721-like NFT
├── apps/multi-token/       # ERC1155-like multi token
├── apps/access-control/    # Role-based access control + Pausable
├── apps/web/               # React web UI (Vite + Tailwind)
├── docker/                 # Docker Compose files
│   ├── proof-server.yml    # Proof server only (for preview/preprod)
│   ├── standalone.yml      # Full local stack (node + indexer + proof server)
│   └── standalone.env      # Indexer environment variables
└── CLAUDE.md               # AI coding knowledge base
```

## Adding a New App

See [CLAUDE.md](CLAUDE.md) for detailed instructions on the per-app pattern and how to add new mini applications.

## Known Issues

- **mintUnshieldedToken error 186**: Unshielded token minting fails when `assert` is used in the same circuit. Known upstream issue — see [compact#235](https://github.com/LFDT-Minokawa/compact/issues/235).
- **BMT rehash**: Contracts with `MerkleTree` state require the `compact-js` patch (applied automatically via `patch-package` on `npm install`).

## License

Apache-2.0
