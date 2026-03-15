import { type Ledger, type Witnesses } from './managed/election/contract/index.js';
import {
  type WitnessContext,
  CompactTypeBytes,
  CompactTypeField,
  CompactTypeBoolean,
  type StateBoundedMerkleTree,
} from '@midnight-ntwrk/compact-runtime';

// PermissibleVotes enum values (matches contract)
export const PermissibleVotes = { yes: 0, no: 1 } as const;
export type PermissibleVote = (typeof PermissibleVotes)[keyof typeof PermissibleVotes];

// PrivateState enum values (matches contract)
export const PrivateStateEnum = { initial: 0, committed: 1, revealed: 2 } as const;
export type PrivateStateValue = (typeof PrivateStateEnum)[keyof typeof PrivateStateEnum];

// PublicState enum values (matches contract)
export const PublicStateEnum = { setup: 0, commit: 1, reveal: 2, final: 3 } as const;

export type ElectionPrivateState = {
  readonly secretKey: Uint8Array;
  readonly state: PrivateStateValue;
  readonly vote: PermissibleVote | null;
};

export type MerkleTreePathEntry = {
  sibling: { field: bigint };
  goes_left: boolean;
};

export type MerkleTreePath = {
  leaf: Uint8Array;
  path: MerkleTreePathEntry[];
};

export type MaybeMerkleTreePath = {
  is_some: boolean;
  value: MerkleTreePath;
};

/**
 * Shared context for Merkle tree witnesses.
 * Must be populated with the current contract state's Merkle trees
 * before calling circuits that need them (vote$commit, vote$reveal, add_voter).
 */
export type ElectionMerkleTreeContext = {
  eligibleVotersTree: StateBoundedMerkleTree | null;
  committedVotesTree: StateBoundedMerkleTree | null;
};

const EMPTY_PATH: MerkleTreePath = {
  leaf: new Uint8Array(32),
  path: Array.from({ length: 10 }, () => ({
    sibling: { field: 0n },
    goes_left: false,
  })),
};

const bytesType = new CompactTypeBytes(32);

/**
 * Parse the raw aligned value returned by StateBoundedMerkleTree.findPathForLeaf
 * into the typed MerkleTreePath structure expected by the circuit.
 */
function parseMerkleTreePath(rawPath: { value: Uint8Array[]; alignment: unknown[] }): MerkleTreePath {
  const valueArr: Uint8Array[] = [...rawPath.value];
  const leaf = bytesType.fromValue(valueArr);
  const path: MerkleTreePathEntry[] = [];
  for (let i = 0; i < 10; i++) {
    const field = CompactTypeField.fromValue(valueArr as Uint8Array[]);
    const goes_left = CompactTypeBoolean.fromValue(valueArr as Uint8Array[]);
    path.push({ sibling: { field }, goes_left });
  }
  return { leaf, path };
}

/**
 * Create election witnesses with a mutable Merkle tree context.
 * The merkleCtx must be updated before each circuit call that requires tree access.
 */
export function createWitnesses(
  merkleCtx: ElectionMerkleTreeContext,
): Witnesses<ElectionPrivateState> {
  return {
    private$secret_key(
      context: WitnessContext<Ledger, ElectionPrivateState>,
    ): [ElectionPrivateState, Uint8Array] {
      return [context.privateState, context.privateState.secretKey];
    },

    private$state(
      context: WitnessContext<Ledger, ElectionPrivateState>,
    ): [ElectionPrivateState, number] {
      return [context.privateState, context.privateState.state];
    },

    private$state$advance(
      context: WitnessContext<Ledger, ElectionPrivateState>,
    ): [ElectionPrivateState, []] {
      const currentState = context.privateState.state;
      let nextState: PrivateStateValue;
      if (currentState === PrivateStateEnum.initial) {
        nextState = PrivateStateEnum.committed;
      } else if (currentState === PrivateStateEnum.committed) {
        nextState = PrivateStateEnum.revealed;
      } else {
        nextState = currentState;
      }
      const newPrivateState: ElectionPrivateState = {
        ...context.privateState,
        state: nextState,
      };
      return [newPrivateState, []];
    },

    private$vote$record(
      context: WitnessContext<Ledger, ElectionPrivateState>,
      ballot_0: number,
    ): [ElectionPrivateState, []] {
      const newPrivateState: ElectionPrivateState = {
        ...context.privateState,
        vote: ballot_0 as PermissibleVote,
      };
      return [newPrivateState, []];
    },

    private$vote(
      context: WitnessContext<Ledger, ElectionPrivateState>,
    ): [ElectionPrivateState, number] {
      if (context.privateState.vote === null) {
        throw new Error('No vote recorded in private state');
      }
      return [context.privateState, context.privateState.vote];
    },

    context$eligible_voters$path_of(
      context: WitnessContext<Ledger, ElectionPrivateState>,
      pk_0: Uint8Array,
    ): [ElectionPrivateState, MaybeMerkleTreePath] {
      const tree = merkleCtx.eligibleVotersTree;
      if (!tree) {
        return [context.privateState, { is_some: false, value: EMPTY_PATH }];
      }
      const leafAligned = { value: bytesType.toValue(pk_0), alignment: bytesType.alignment() };
      const rawPath = tree.findPathForLeaf(leafAligned);
      if (rawPath === undefined) {
        return [context.privateState, { is_some: false, value: EMPTY_PATH }];
      }
      const parsedPath = parseMerkleTreePath(rawPath);
      return [context.privateState, { is_some: true, value: parsedPath }];
    },

    context$committed_votes$path_of(
      context: WitnessContext<Ledger, ElectionPrivateState>,
      cm_0: Uint8Array,
    ): [ElectionPrivateState, MaybeMerkleTreePath] {
      const tree = merkleCtx.committedVotesTree;
      if (!tree) {
        return [context.privateState, { is_some: false, value: EMPTY_PATH }];
      }
      const leafAligned = { value: bytesType.toValue(cm_0), alignment: bytesType.alignment() };
      const rawPath = tree.findPathForLeaf(leafAligned);
      if (rawPath === undefined) {
        return [context.privateState, { is_some: false, value: EMPTY_PATH }];
      }
      const parsedPath = parseMerkleTreePath(rawPath);
      return [context.privateState, { is_some: true, value: parsedPath }];
    },
  };
}
