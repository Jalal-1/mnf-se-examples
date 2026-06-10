# MNF Solutions Engineering Examples

A monorepo of mini example applications on the Midnight Network.
Serves as both deployable apps and an AI coding knowledge base.

## Architecture

```
mnf-se-examples/
├── packages/common/        # @mnf-se/common — shared wallet, providers, display, config
├── apps/<name>/contract/   # Compact smart contract + TypeScript bindings
├── apps/<name>/cli/        # Interactive CLI using @mnf-se/common
├── docker/proof-server.yml # Shared proof server (all apps use port 6300)
└── templates/app-template/ # Copy to create a new app
```

**Package manager**: npm workspaces
**Node.js**: >= 22.0.0
**Compact toolchain**: 0.31.0 (contracts use `pragma >= 0.20`)

## SDK Versions (stable, proven on preview + preprod)

| Package | Version |
|---|---|
| @midnight-ntwrk/midnight-js-* | 4.1.1 |
| @midnight-ntwrk/testkit-js | 4.1.1 |
| @midnight-ntwrk/dapp-connector-api | 4.0.1 |
| @midnight-ntwrk/wallet-sdk-facade | 3.0.0 |
| @midnight-ntwrk/wallet-sdk-hd | 3.0.1 |
| @midnight-ntwrk/wallet-sdk-shielded | 2.1.0 |
| @midnight-ntwrk/wallet-sdk-dust-wallet | 3.0.0 |
| @midnight-ntwrk/wallet-sdk-unshielded-wallet | 2.1.0 |
| @midnight-ntwrk/compact-runtime | 0.16.0 |
| @midnight-ntwrk/compact-js | 2.5.1 |
| @midnight-ntwrk/platform-js | 2.2.4 |
| @midnight-ntwrk/onchain-runtime-v3 | 3.0.0 |
| @midnight-ntwrk/ledger-v8 | 8.1.0 |
| Docker: midnightntwrk/proof-server | 8.0.3 |

`ledger-v8@8.1.0` is pinned to match `midnight-js-protocol@4.1.1`; the Preprod/Mainnet network rows in the compatibility matrix still list ledger `8.0.3` as the network component version.

## Network Endpoints

| Network | Indexer | RPC Node | Proof Server |
|---|---|---|---|
| Preview | https://indexer.preview.midnight.network/api/v4/graphql | https://rpc.preview.midnight.network | localhost:6300 |
| Preprod | https://indexer.preprod.midnight.network/api/v4/graphql | https://rpc.preprod.midnight.network | localhost:6300 |
| Standalone/undeployed | http://127.0.0.1:8088/api/v4/graphql | http://127.0.0.1:9944 | localhost:6300 |

Preview is faster for iteration (more peers, faster sync). Use preprod for final testing.

## Shared Package: @mnf-se/common

All wallet, provider, and utility code lives in `packages/common/src/`:

| File | Exports | Purpose |
|---|---|---|
| `wallet.ts` | `buildWalletAndWaitForFunds()`, `buildFreshWallet()`, `deriveKeysFromSeed()` | HD wallet lifecycle: derive keys, create 3 sub-wallets (Shielded, Unshielded, Dust), sync, fund, register DUST |
| `providers.ts` | `createWalletAndMidnightProvider()` | Bridges wallet-sdk-facade to midnight-js contract API using the facade balance/finalize/submit flow |
| `config.ts` | `Config`, `PreviewConfig`, `PreprodConfig`, `StandaloneConfig` | Network endpoint configuration. Constructor calls `setNetworkId()` |
| `dust.ts` | `registerForDustGeneration()`, `getDustBalance()`, `monitorDustBalance()` | DUST token lifecycle: register NIGHT UTXOs, wait for generation, monitor balance |
| `rx-helpers.ts` | `waitForSync()`, `waitForFunds()` | RxJS observable patterns for wallet state |
| `display.ts` | `withStatus()`, `clearScreen()`, `formatBalance()`, `c` (ANSI colors), `DIVIDER` | Terminal UI helpers with animated spinners |
| `logger.ts` | `createLogger()` | Pino logger with pretty console + file output |
| `bmt-rehash.ts` | `wrapPublicDataProviderWithRehash()` | Opt-in BMT rehash wrapper for contracts using MerkleTree state |
| `types.ts` | `WalletContext` | Shared type: `{ wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore }` |

## Per-App Pattern (4 files)

Each app's CLI follows this structure:

### `types.ts` — Contract-specific type aliases
```typescript
export type MyCircuits = ImpureCircuitId<MyContract.Contract<MyPrivateState>>;
export const MyPrivateStateId = 'myPrivateState';
export type MyProviders = MidnightProviders<MyCircuits, typeof MyPrivateStateId, MyPrivateState>;
export type DeployedMyContract = DeployedContract<...> | FoundContract<...>;
```

### `api.ts` — Contract operations
```typescript
import { type Config, type WalletContext, createWalletAndMidnightProvider } from '@mnf-se/common';
// 1. Assemble CompiledContract with witnesses and ZK assets
// 2. deploy() and joinContract() functions
// 3. Circuit call wrappers (e.g., increment(), mint())
// 4. configureProviders() — wires wallet, indexer, proof server, private state
```

### `cli.ts` — Interactive menu
```typescript
import { buildWalletAndWaitForFunds, withStatus, getDustBalance } from '@mnf-se/common';
// Readline-based menu loop: wallet setup → deploy/join → interact
```

### `main.ts` — Entry point
```typescript
import { createLogger, PreviewConfig } from '@mnf-se/common';
// Parse --network arg, create config, run CLI
```

## How to Add a New App

1. Copy `templates/app-template/` to `apps/<name>/`
2. Write the `.compact` contract in `apps/<name>/contract/src/<name>.compact`
3. Implement witnesses in `witnesses.ts`
4. Update `index.ts` to re-export managed contract + witnesses
5. Compile: `cd apps/<name>/contract && npm run compact && npm run build` (`compact compile +0.31.0`)
6. Define circuit types in `cli/src/types.ts`
7. Implement contract operations in `cli/src/api.ts`
8. Build the interactive menu in `cli/src/cli.ts`
9. From root: `npm install` (workspaces auto-link)
10. Run: `npm -w @mnf-se/<name>-cli run preview`

## Build & Run Commands

```bash
# Install all dependencies
npm install

# Compile a contract (generates managed/ with TS bindings + ZK keys)
cd apps/counter/contract && npm run compact && npm run build

# Start proof server (required for all contract operations)
docker compose -f docker/proof-server.yml up -d

# Run an app
npm -w @mnf-se/counter-cli run preview
npm -w @mnf-se/counter-cli run preprod

# Type-check
npx tsc -p apps/counter/cli/tsconfig.json --noEmit
```

## Compact Contract Patterns

### Simple public state (Counter)
```compact
pragma language_version >= 0.20;
import CompactStandardLibrary;
export ledger round: Counter;
export circuit increment(): [] { round.increment(1); }
```
- No witnesses needed
- `CompiledContract.withVacantWitnesses` in api.ts
- Public state read via `Counter.ledger(contractState.data).round`

### Access control with witnesses (Token/Election)
```compact
export ledger owner: Bytes<32>;
witness local$secret_key(): Bytes<32>;

circuit derive_public_key(sk: Bytes<32>): Bytes<32> {
  persistentHash([pad(32, "midnight:token:pk:"), sk])
}

circuit assert_owner() {
  assert owner == derive_public_key(local$secret_key())
    "caller is not the owner";
}
```
- Private key never leaves the client
- Witness returns secret key from local private state
- Contract verifies ownership by hashing and comparing

### Shielded tokens (mintShieldedToken / receiveShielded)
```compact
export circuit mint(amount: Uint<16>, recipient_key: ZswapCoinPublicKey): ShieldedCoinInfo {
  assert_owner();
  assert amount > 0 "amount must be positive";
  total_supply.increment(amount as Field);
  disclose(domain_separator);
  mintShieldedToken(domain_separator, recipient_key, amount as Field, local$nonce())
}
```
- Token color = `tokenType(domain_separator, contract_address)`
- Transfers happen at Zswap protocol level (no contract call needed)
- Burns use `receiveShielded` to destroy coins

### Unshielded tokens (mintUnshieldedToken) — CRITICAL CONSTRAINT
```compact
// MUST be a guaranteed circuit (no assert anywhere in the call tree).
// assert makes a circuit fallible; fallible transcripts discard unshielded
// mint effects, causing EffectsCheckFailure (error 186) at the ledger.
circuit mint_unshielded(amount: Uint<16>, recipient: UserAddress): Bytes<32> {
  // No assert_owner(), no assert() — move validation to TypeScript
  total_supply.increment(disclose(amount));
  return mintUnshieldedToken(
    domain_separator,
    disclose(amount) as Uint<64>,
    right<ContractAddress, UserAddress>(disclose(recipient))
  );
}
```
- In TypeScript: use `encodeUserAddress(keystore.getAddress())` to get the recipient bytes
- Validate amount > 0 on the TypeScript side before calling the circuit
- See: https://github.com/LFDT-Minokawa/compact/issues/235

### MerkleTree state (Election)
```compact
export ledger eligible_voters: MerkleTree<10, Bytes<32>>;
```
- Requires BMT rehash wrapper (`wrapPublicDataProviderWithRehash()`)
- Context witnesses provide Merkle inclusion proofs
- Nullifier sets prevent double-actions

## Common Pitfalls

1. **Old signRecipe workaround**: Older wallet SDKs needed manual intent signing for proven intents. The current `wallet-sdk-facade@3.0.0` flow does not need that workaround; avoid reintroducing it unless testing an older SDK line.

2. **BMT rehash**: Contracts with `MerkleTree<N,T>` ledger state crash with "attempted to take root of non-rehashed bmt" unless you wrap the PublicDataProvider with `wrapPublicDataProviderWithRehash()`.

3. **smoldot override**: Always include `"smoldot": "npm:@aspect-build/empty@0.0.0"` in overrides. Without it, the Substrate node client pulls a WASM binary that causes build failures.

4. **WebSocket polyfill**: Must set `globalThis.WebSocket = WebSocket` from the `ws` package for GraphQL subscriptions to work in Node.js.

5. **DUST registration**: NIGHT UTXOs must be explicitly registered for dust generation on preview/preprod before you can submit transactions. `buildWalletAndWaitForFunds()` handles this automatically.

6. **Proof server**: Must be running locally on port 6300 for all contract operations (deploy, circuit calls). Start with `docker compose -f docker/proof-server.yml up -d`.

7. **Compact compiler output**: The `managed/` directory is generated by `compact compile`. First run may download ~500MB ZK parameters.

## Wallet Lifecycle

1. **Derive keys**: `HDWallet.fromSeed()` → `selectAccount(0)` → `selectRoles([Zswap, NightExternal, Dust])` → `deriveKeysAt(0)`
2. **Create sub-wallets**: `ShieldedWallet()`, `UnshieldedWallet()`, `DustWallet()` with network-specific config
3. **Start facade**: `new WalletFacade(shielded, unshielded, dust)` → `wallet.start()`
4. **Sync**: Wait for `state.isSynced` via RxJS observable
5. **Fund**: Send tNight from faucet to unshielded address
6. **Register DUST**: `wallet.registerNightUtxosForDustGeneration()` → wait for `dust.walletBalance() > 0n`

## Midnight Token Model

- **NIGHT**: Unshielded utility token (secp256k1 keys). Used for staking and generating DUST.
- **DUST**: Shielded fee token (BLS12-381 keys). Non-transferable. Generated by holding NIGHT. Required for all transactions.
- **Custom tokens**: Created via `mintShieldedToken()` in Compact. Each has a unique "color" derived from (domain_separator, contract_address).

## Key Type Patterns

```typescript
// Circuit types — extracts impure circuit IDs from the contract
type MyCircuits = ImpureCircuitId<MyContract.Contract<MyPrivateState>>;

// Provider types — bundles all midnight-js providers for a specific contract
type MyProviders = MidnightProviders<MyCircuits, 'myPrivateState', MyPrivateState>;

// Deployed contract — union of newly deployed or found (joined) contract
type DeployedMyContract = DeployedContract<MyContract> | FoundContract<MyContract>;

// CompiledContract assembly — pipe pattern
const compiled = CompiledContract.make('name', MyContract.Contract).pipe(
  CompiledContract.withVacantWitnesses,          // or withWitnesses(myWitnesses)
  CompiledContract.withCompiledFileAssets(path),  // ZK keys + ZKIR from managed/
);
```
