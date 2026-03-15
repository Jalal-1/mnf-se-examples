# Election

A privacy-preserving commit-reveal voting DApp with two roles (authority and voter) running in separate terminals.

## Concepts

- **MerkleTree state** — eligible voters stored in `MerkleTree<10, Bytes<32>>`
- **Commit-reveal** — votes committed as `hash(ballot, secret_key)`, revealed later
- **Nullifiers** — prevent double-voting via `hash("cm-nul", sk)` and `hash("rv-nul", sk)`
- **Multi-party** — authority deploys and manages, voters join and vote
- **BMT rehash** — requires the `compact-js` patch (applied automatically via `patch-package`)

## Privacy Guarantees

| Property | Mechanism |
|----------|-----------|
| **Vote secrecy** | Votes committed as `hash(ballot, secret_key)` — hidden until reveal |
| **Voter anonymity** | Merkle tree inclusion proofs verify eligibility without linking voter to vote |
| **No double voting** | Nullifiers tracked in on-chain sets |
| **Authority control** | Only deployer's derived public key can set topic, add voters, advance phases |

## Build & Run

```bash
# From monorepo root
cd apps/election/contract && npm run compact && npm run build && cd ../../..

# Start local testnet
docker compose -f docker/standalone.yml up -d
```

## Multi-Terminal Walkthrough

### Terminal 1 — Authority

```bash
npm -w @mnf-se/election-cli run standalone
```

1. Wait for wallet to sync (standalone uses the pre-funded genesis wallet)
2. Choose **[1] Deploy new Election contract**
3. **Save the contract address** that is displayed

### Terminal 2 — Voter

```bash
npm -w @mnf-se/election-cli run standalone
```

1. Wait for wallet to sync
2. Choose **[2] Join existing Election contract**
3. Paste the **contract address** from Terminal 1
4. Choose role **[2] voter**
5. **Copy the voter public key** displayed (64 hex chars)

> Both terminals share the same genesis wallet for fees. Authority/voter keys are separate — generated fresh per session.

### Register the voter (Terminal 1)

1. Choose **Set election topic** — enter a topic
2. Choose **Add eligible voter** — paste the voter's public key
3. Choose **Advance to commit phase**

### Vote (Terminal 2)

1. The voter menu now shows **Cast vote (commit)**
2. Enter **yes** or **no** — a ZK proof is generated proving voter eligibility via Merkle inclusion
3. The vote commitment is recorded on-chain (vote itself is hidden)

### Reveal (Terminal 1 then Terminal 2)

1. Terminal 1: **Advance to reveal phase**
2. Terminal 2: **Reveal vote** — proves the revealed vote matches the commitment
3. Tally updates on-chain

### Finalize (Terminal 1)

1. **Advance to final phase**
2. Both terminals show the final Yes/No tally

## Election Phases

The menu adapts to the current phase — only valid actions are shown:

| Phase | Authority actions | Voter actions |
|-------|-------------------|---------------|
| **setup** | Set topic, Add voter, Advance | Waiting... |
| **commit** | Advance | Cast vote |
| **reveal** | Advance | Reveal vote |
| **final** | (none) | (none) |
