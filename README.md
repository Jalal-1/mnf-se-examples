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
| [**multisig**](apps/multisig/) | Guided key ceremony + 2-of-3 Schnorr multisig | Jubjub keys, Schnorr signatures, proposal approvals | Working |
| [**multisig-token**](apps/multisig-token/) | Multisig-controlled shielded token mint | ZSwap minting, token names, Schnorr approvals, wallet/contract recipients | Working |
| [**oz-multisig-v3**](apps/oz-multisig-v3/) | OZ ShieldedMultiSigV3 mint/burn harness | Signer commitments, stub ECDSA approvals, shielded burn address | Working |

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
- [Compact devtools](https://github.com/midnightntwrk/compact) with toolchain `0.31.0` (`compact update 0.31.0`)

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
npm run multisig
npm run multisig-token
npm run oz-multisig-v3

# Or launch the web UI
npm run web
```

## Commands

### Run Apps (CLI)

| Command | Description |
|---------|-------------|
| `npm run counter` | Run counter on local undeployed network |
| `npm run token` | Run shielded token on local undeployed network |
| `npm run election` | Run election on local undeployed network |
| `npm run fungible-token` | Run fungible token (ERC20) on local undeployed network |
| `npm run nft` | Run NFT (ERC721) on local undeployed network |
| `npm run multi-token` | Run multi token (ERC1155) on local undeployed network |
| `npm run access-control` | Run access control on local undeployed network |
| `npm run multisig` | Run guided key ceremony + Schnorr multisig on local undeployed network |
| `npm run multisig-token` | Run multisig-controlled shielded token mint on local undeployed network |
| `npm run oz-multisig-v3` | Run the exact OZ ShieldedMultiSigV3 mint/burn harness on local undeployed network |

### Run Apps (Testnet)

For preview/preprod, start the proof server locally then run with the network suffix:

```bash
npm run docker:proof           # Proof server only (for testnet)
npm run counter:undeployed     # Local undeployed network
npm run counter:preview        # Preview network
npm run counter:preprod        # Preprod network
npm run multisig:preview       # Preview network
npm run multisig:preprod       # Preprod network
npm run multisig-token:preview # Preview network
npm run multisig-token:preprod # Preprod network
npm run oz-multisig-v3:preview # Preview network
npm run oz-multisig-v3:preprod # Preprod network
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

`docker:up` and `docker:proof` run a preflight that stops other Docker containers already publishing the local Midnight ports (`6300`, `8088`, `9944`) before recreating this repo's stack.

### Build

| Command | Description |
|---------|-------------|
| `npm run build:all` | Compile all Compact contracts + TypeScript |
| `npm run build:counter` | Compile counter contract only |
| `npm run build:multisig` | Compile Schnorr multisig contract only |
| `npm run build:multisig-token` | Compile multisig shielded token mint contract only |
| `npm run build:oz-multisig-v3` | Compile OZ ShieldedMultiSigV3 harness contract only |
| `npm run typecheck` | Type-check all CLI code |

## SDK Versions

| Package | Version |
|---------|---------|
| Compact devtools | 0.5.1 |
| Compact toolchain | 0.31.0 |
| compact-runtime | 0.16.0 |
| compact-js | 2.5.1 |
| platform-js | 2.2.4 |
| onchain-runtime-v3 | 3.0.0 |
| midnight-js-* | 4.1.1 |
| testkit-js | 4.1.1 |
| dapp-connector-api | 4.0.1 |
| wallet-sdk-facade | 3.0.0 |
| ledger-v8 | 8.1.0 |

The JS dependency graph pins `ledger-v8@8.1.0` to match `midnight-js-protocol@4.1.1`. The Preprod network row in the compatibility matrix still lists ledger `8.0.3` as the network component version.

## Docker Images (Standalone)

| Image | Version |
|-------|---------|
| midnight-node | 0.22.5 |
| indexer-standalone | 4.0.1 |
| proof-server | 8.0.3 |

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
├── apps/multisig/          # Guided key ceremony + 2-of-3 Schnorr multisig
├── apps/multisig-token/    # Multisig-controlled shielded token mint
├── apps/oz-multisig-v3/    # OZ ShieldedMultiSigV3 mint/burn harness
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
- **BMT rehash**: Contracts with `MerkleTree` state should use `wrapPublicDataProviderWithRehash()` from `@mnf-se/common`.

## License

Apache-2.0
