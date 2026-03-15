# MNF Solutions Engineering Examples

A growing collection of mini example applications on the [Midnight Network](https://midnight.network/), built by the MNF Solutions Engineering team.

Serves as both **deployable apps** and an **AI coding knowledge base** for building Midnight DApps.

## Apps

| App | Description | Status |
|-----|-------------|--------|
| **counter** | Simple on-chain counter (public state) | Working |
| **token** | Shielded & unshielded token minting (Zswap + UTXO) | Shielded working, unshielded pending node fix |
| **election** | Privacy-preserving commit-reveal voting | Working |

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

# Compile a contract (example: counter)
cd apps/counter/contract && npm run compact && npm run build && cd ../../..

# Run the counter
npm -w @mnf-se/counter-cli run standalone
```

## Quick Start (Preview Testnet)

```bash
npm install

# Start proof server only (node + indexer are remote)
docker compose -f docker/proof-server.yml up -d

# Run against preview
npm -w @mnf-se/counter-cli run preview
```

Fund your wallet from the [Preview faucet](https://faucet.preview.midnight.network).

---

## Election DApp — Multi-Terminal Walkthrough

The election app demonstrates a full privacy-preserving voting flow with two roles running in separate terminals. Both terminals share the same contract on-chain.

### Step 1: Build the contract

```bash
cd /home/g/Midnight_Master/mnf-se-examples
cd apps/election/contract && npm run compact && npm run build && cd ../../..
```

Make sure the local testnet is running:

```bash
docker compose -f docker/standalone.yml up -d
```

### Step 2: Terminal 1 — Authority

The authority deploys the election, sets the topic, and registers voters.

```bash
cd /home/g/Midnight_Master/mnf-se-examples
npm -w @mnf-se/election-cli run standalone
```

1. Wait for wallet to sync (standalone uses the pre-funded genesis wallet)
2. Choose **[1] Deploy new Election contract**
3. **Save the contract address and secret key** that are displayed

Once deployed, you'll see the authority menu:

```
  1  Set election topic
  2  Add eligible voter
  3  Advance to next phase
  4  Refresh
  5  Exit
```

4. Choose **[1]** and enter an election topic (e.g., "Should we adopt Midnight?")
5. **Wait** — don't advance yet. Open Terminal 2 first to get the voter's public key.

### Step 3: Terminal 2 — Voter

The voter joins the election and generates a fresh keypair for anonymous voting.

```bash
cd /home/g/Midnight_Master/mnf-se-examples
npm -w @mnf-se/election-cli run standalone
```

1. Wait for wallet to sync
2. Choose **[2] Join existing Election contract**
3. Paste the **contract address** from Terminal 1
4. Choose role **[2] voter**
5. The CLI generates a fresh voter keypair and displays:

```
  Your voter public key (give to authority):
  a1b2c3d4e5f6...  (64 hex characters)
```

6. **Copy this public key** — you need to give it to the authority

### Step 4: Back to Terminal 1 — Register the voter

1. In the authority terminal, choose **[2] Add eligible voter**
2. Paste the voter's public key (the 64-hex string from Step 3)
3. Wait for the transaction to confirm
4. Repeat for additional voters if needed

### Step 5: Authority advances to commit phase

1. Choose **[3] Advance to next phase**
2. Phase changes: **setup → commit**
3. Voters can now cast votes

### Step 6: Terminal 2 — Voter commits vote

1. In the voter terminal, choose **[1] Cast vote (commit)**
2. Enter **yes** or **no**
3. A ZK proof is generated proving the voter is registered (via Merkle tree inclusion proof) without revealing their identity
4. The vote commitment is recorded on-chain (but the vote itself is hidden)

### Step 7: Authority advances to reveal phase

1. Back in Terminal 1, choose **[3] Advance to next phase**
2. Phase changes: **commit → reveal**

### Step 8: Terminal 2 — Voter reveals vote

1. In the voter terminal, choose **[2] Reveal vote**
2. A ZK proof is generated proving the revealed vote matches the commitment
3. The tally updates on-chain (Yes/No counters)

### Step 9: Authority advances to final

1. Terminal 1: **[3] Advance to next phase**
2. Phase changes: **reveal → final**
3. Both terminals now show the final tally

### Privacy Guarantees

| Property | Mechanism |
|----------|-----------|
| **Vote secrecy** | Votes are committed as `hash(ballot, secret_key)` — hidden until reveal |
| **Voter anonymity** | Merkle tree inclusion proofs verify eligibility without linking voter to vote |
| **No double voting** | Nullifiers (`hash("cm-nul", sk)` and `hash("rv-nul", sk)`) tracked in on-chain sets |
| **Authority control** | Only the deployer's derived public key can set topic, add voters, advance phases |

---

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
└── CLAUDE.md               # AI coding knowledge base
```

## Adding a New App

See [CLAUDE.md](CLAUDE.md) for detailed instructions on the per-app pattern and how to add new mini applications.

## License

Apache-2.0
