# MNF Solutions Engineering Examples

A collection of mini example applications on the [Midnight Network](https://midnight.network/).

Deployable apps and an AI coding knowledge base for building Midnight DApps.

## Apps

| App | Description | Concepts | Status |
|-----|-------------|----------|--------|
| [**counter**](apps/counter/) | Simple on-chain counter | Public state, basic circuit | Working |
| [**token**](apps/token/) | Shielded & unshielded token minting | Zswap, `mintShieldedToken`, access control, witnesses | Shielded working, unshielded pending node fix (error 139) |
| [**election**](apps/election/) | Privacy-preserving commit-reveal voting | MerkleTree state, nullifiers, commit-reveal, multi-party | Working |
| [**fungible-token**](apps/fungible-token/) | ERC20-like fungible token | OZ FungibleToken, Map balances, transfer, approve, allowance | New |
| [**nft**](apps/nft/) | ERC721-like non-fungible token | OZ NonFungibleToken, ownership, tokenURI, approvals | New |

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

# Build all contracts (first time only)
npm run build:all

# Start local testnet (node + indexer + proof server)
npm run docker:up

# Run any app
npm run counter
npm run token
npm run election
```

## Commands

### Run Apps

| Command | Description |
|---------|-------------|
| `npm run counter` | Run counter on local testnet |
| `npm run token` | Run shielded token on local testnet |
| `npm run election` | Run election on local testnet |
| `npm run fungible-token` | Run fungible token (ERC20) on local testnet |
| `npm run nft` | Run NFT (ERC721) on local testnet |
| `npm run counter:preview` | Run counter on preview network |
| `npm run token:preview` | Run shielded token on preview network |
| `npm run election:preview` | Run election on preview network |
| `npm run fungible-token:preview` | Run fungible token on preview network |
| `npm run nft:preview` | Run NFT on preview network |

### Docker (Local Testnet)

| Command | Description |
|---------|-------------|
| `npm run docker:up` | Start local testnet (node + indexer + proof server) |
| `npm run docker:down` | Stop local testnet |
| `npm run docker:logs` | Tail container logs |
| `npm run docker:reset` | Wipe all state and restart fresh |

### Build

| Command | Description |
|---------|-------------|
| `npm run build:all` | Compile all Compact contracts + TypeScript |
| `npm run build:counter` | Compile counter contract only |
| `npm run build:token` | Compile shielded token contract only |
| `npm run build:election` | Compile election contract only |
| `npm run build:fungible-token` | Compile fungible token contract only |
| `npm run build:nft` | Compile NFT contract only |
| `npm run typecheck` | Type-check all CLI code |

### Preview Network

For preview/preprod, only the proof server is needed locally:

```bash
docker compose -f docker/proof-server.yml up -d
npm run counter:preview
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
├── contracts/              # Shared OZ-style Compact library
│   ├── token/              # FungibleToken, NonFungibleToken, MultiToken
│   ├── security/           # Initializable, Pausable
│   ├── access/             # Ownable
│   └── utils/              # Utils (zero address checks, etc.)
├── apps/counter/           # Simple counter DApp
├── apps/token/             # Shielded token (Zswap mintShieldedToken)
├── apps/fungible-token/    # ERC20-like fungible token (OZ FungibleToken)
├── apps/nft/               # ERC721-like NFT (OZ NonFungibleToken)
├── apps/election/          # Privacy-preserving election (commit-reveal)
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
