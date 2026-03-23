import {
  Election,
  type ElectionPrivateState,
  type ElectionMerkleTreeContext,
  createWitnesses,
} from '@mnf-se/election-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
  type ContractAddress,
  CompactTypeBytes,
  CompactTypeField,
  CompactTypeBoolean,
  CompactTypeOpaqueString,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { wrapPublicDataProviderWithRehash } from '@mnf-se/common/bmt-rehash';

// ── Types ──────────────────────────────────────────────────────────────────
export type ElectionCircuits = 'vote$commit' | 'vote$reveal' | 'advance' | 'set_topic' | 'add_voter';
export const ElectionPrivateStateId = 'electionPrivateState';
export type ElectionProviders = MidnightProviders<
  ElectionCircuits,
  typeof ElectionPrivateStateId,
  ElectionPrivateState
>;
export type DeployedElectionContract =
  | DeployedContract<Election.Contract<ElectionPrivateState>>
  | FoundContract<Election.Contract<ElectionPrivateState>>;

// ── Merkle Tree Context ────────────────────────────────────────────────
export const merkleTreeContext: ElectionMerkleTreeContext = {
  eligibleVotersTree: null,
  committedVotesTree: null,
};

const witnesses = createWitnesses(merkleTreeContext);

// ── Compiled contract (browser — ZK assets served via HTTP) ────────────
const ELECTION_ZK_PATH = './contract/election';

const electionCompiledContract = CompiledContract.make<Election.Contract<ElectionPrivateState>>(
  'Election',
  Election.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(ELECTION_ZK_PATH),
);

// ── Merkle Tree State Update ───────────────────────────────────────────

export async function updateMerkleTreeContext(
  providers: ElectionProviders,
  contractAddress: ContractAddress,
): Promise<void> {
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  if (!contractState) return;

  try {
    const stateArr = contractState.data.state.asArray()!;
    const committedContainer = stateArr[5]!.asArray()!;
    const committedTree = committedContainer[0]!.asBoundedMerkleTree() ?? null;
    merkleTreeContext.committedVotesTree = committedTree?.rehash() ?? null;
    const votersContainer = stateArr[6]!.asArray()!;
    const votersTree = votersContainer[0]!.asBoundedMerkleTree() ?? null;
    merkleTreeContext.eligibleVotersTree = votersTree?.rehash() ?? null;
  } catch {
    // Merkle tree extraction may fail if state is not yet populated
  }
}

// ── Contract operations ────────────────────────────────────────────────

export async function deploy(
  providers: ElectionProviders,
): Promise<DeployedElectionContract> {
  const privateState: ElectionPrivateState = {
    secretKey: crypto.getRandomValues(new Uint8Array(32)),
    state: 0,
    vote: null,
  };
  return await deployContract(providers as any, {
    compiledContract: electionCompiledContract,
    privateStateId: ElectionPrivateStateId,
    initialPrivateState: privateState,
  }) as any;
}

export async function joinContract(
  providers: ElectionProviders,
  contractAddress: string,
): Promise<DeployedElectionContract> {
  const privateState: ElectionPrivateState = {
    secretKey: crypto.getRandomValues(new Uint8Array(32)),
    state: 0,
    vote: null,
  };
  return await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: electionCompiledContract,
    privateStateId: ElectionPrivateStateId,
    initialPrivateState: privateState,
  }) as any;
}

export async function setTopic(
  contract: DeployedElectionContract,
  topic: string,
): Promise<string> {
  const result = await contract.callTx.set_topic(topic);
  return result.public.txId;
}

export async function addVoter(
  contract: DeployedElectionContract,
  voterPk: Uint8Array,
): Promise<string> {
  const result = await contract.callTx.add_voter(voterPk);
  return result.public.txId;
}

export async function advance(
  contract: DeployedElectionContract,
): Promise<string> {
  const result = await contract.callTx.advance();
  return result.public.txId;
}

export async function voteCommit(
  contract: DeployedElectionContract,
  ballot: 0 | 1,
): Promise<string> {
  const result = await contract.callTx['vote$commit'](ballot);
  return result.public.txId;
}

export async function voteReveal(
  contract: DeployedElectionContract,
): Promise<string> {
  const result = await contract.callTx['vote$reveal']();
  return result.public.txId;
}

// ── Read Contract State ────────────────────────────────────────────────

export type ElectionPublicState = {
  authority: string;
  state: number;
  topic: { is_some: boolean; value: string };
  tallyYes: bigint;
  tallyNo: bigint;
  eligibleVoterCount: bigint;
  committedVoteCount: bigint;
};

const PHASE_NAMES = ['setup', 'commit', 'reveal', 'final'];
export const phaseName = (state: number): string => PHASE_NAMES[state] ?? 'unknown';

export async function getElectionState(
  providers: ElectionProviders,
  addr: string,
): Promise<ElectionPublicState | null> {
  const contractState = await providers.publicDataProvider.queryContractState(
    addr as ContractAddress,
  );
  if (!contractState) return null;

  try {
    const cr = await import('@midnight-ntwrk/compact-runtime');
    const stateArr = contractState.data.state.asArray()!;
    const bytesType = new cr.CompactTypeBytes(32);
    const enumType = new cr.CompactTypeEnum(3, 1);
    const uintType = new cr.CompactTypeUnsignedInteger(18446744073709551615n, 8);

    const authorityCell = stateArr[0]!.asCell()!;
    const authority = Array.from(bytesType.fromValue([...authorityCell.value]))
      .map((b: number) => b.toString(16).padStart(2, '0'))
      .join('');

    const stateCell = stateArr[1]!.asCell()!;
    const publicState = enumType.fromValue([...stateCell.value]);

    const topicCell = stateArr[2]!.asCell()!;
    const topicVal: Uint8Array[] = [...topicCell.value];
    const isSome = cr.CompactTypeBoolean.fromValue(topicVal);
    const topicStr = cr.CompactTypeOpaqueString.fromValue(topicVal);

    const tallyYes = uintType.fromValue([...stateArr[3]!.asCell()!.value]);
    const tallyNo = uintType.fromValue([...stateArr[4]!.asCell()!.value]);

    let committedVoteCount = 0n;
    try {
      const c = stateArr[5]!.asArray()!;
      committedVoteCount = uintType.fromValue([...c[1]!.asCell()!.value]);
    } catch {}

    let eligibleVoterCount = 0n;
    try {
      const v = stateArr[6]!.asArray()!;
      eligibleVoterCount = uintType.fromValue([...v[1]!.asCell()!.value]);
    } catch {}

    return {
      authority,
      state: publicState,
      topic: { is_some: isSome, value: topicStr },
      tallyYes,
      tallyNo,
      eligibleVoterCount,
      committedVoteCount,
    };
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

export function derivePublicKey(secretKey: Uint8Array): Uint8Array {
  const bytesType = new CompactTypeBytes(32);
  const prefix = new Uint8Array(32);
  const prefixStr = 'lares:election:pk:';
  for (let i = 0; i < prefixStr.length; i++) prefix[i] = prefixStr.charCodeAt(i);
  return persistentHash(
    {
      alignment: () => bytesType.alignment().concat(bytesType.alignment()),
      toValue: (v: Uint8Array[]) => bytesType.toValue(v[0]).concat(bytesType.toValue(v[1])),
      fromValue: () => {
        throw new Error('not needed');
      },
    },
    [prefix, secretKey],
  );
}
