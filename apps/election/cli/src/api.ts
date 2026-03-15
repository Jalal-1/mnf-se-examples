import { type ContractAddress, CompactTypeBytes, persistentHash } from '@midnight-ntwrk/compact-runtime';
import { type ContractState, ChargedState, StateValue } from '@midnight-ntwrk/compact-runtime';
import {
  Election,
  type ElectionPrivateState,
  type ElectionMerkleTreeContext,
  createWitnesses,
} from '@mnf-se/election-contract';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { FinalizedTxData, PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';
import { webcrypto } from 'crypto';
import { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { Buffer } from 'buffer';
import path from 'node:path';

import {
  type Config,
  type WalletContext,
  createWalletAndMidnightProvider,
} from '@mnf-se/common';

import {
  type ElectionCircuits,
  type ElectionProviders,
  type DeployedElectionContract,
  ElectionPrivateStateId,
} from './types.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

let logger: Logger;

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

const contractConfig = {
  privateStateStoreName: 'election-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'election'),
};

// ── BMT Rehash (required for MerkleTree state) ─────────────────────────

function rehashStateValue(sv: StateValue): StateValue {
  switch (sv.type()) {
    case 'boundedMerkleTree': {
      const tree = sv.asBoundedMerkleTree();
      return tree ? StateValue.newBoundedMerkleTree(tree.rehash()) : sv;
    }
    case 'array': {
      const arr = sv.asArray();
      if (!arr) return sv;
      let result = StateValue.newArray();
      for (const child of arr) {
        result = result.arrayPush(rehashStateValue(child));
      }
      return result;
    }
    default:
      return sv;
  }
}

function rehashContractState(cs: ContractState): ContractState {
  const rehashed = rehashStateValue(cs.data.state);
  cs.data = new ChargedState(rehashed);
  return cs;
}

function wrapPublicDataProviderWithRehash(inner: PublicDataProvider): PublicDataProvider {
  return {
    ...inner,
    async queryContractState(...args) {
      const result = await inner.queryContractState(...args);
      return result ? rehashContractState(result) : null;
    },
    async queryZSwapAndContractState(...args) {
      const result = await inner.queryZSwapAndContractState(...args);
      return result ? [result[0], rehashContractState(result[1])] : null;
    },
    async queryDeployContractState(...args) {
      const result = await inner.queryDeployContractState(...args);
      return result ? rehashContractState(result) : null;
    },
    async watchForContractState(...args) {
      const result = await inner.watchForContractState(...args);
      return rehashContractState(result);
    },
    contractStateObservable(address, config) {
      return inner.contractStateObservable(address, config).pipe(
        Rx.map((cs) => rehashContractState(cs)),
      );
    },
  };
}

// ── Compiled Contract ──────────────────────────────────────────────────

export const merkleTreeContext: ElectionMerkleTreeContext = {
  eligibleVotersTree: null,
  committedVotesTree: null,
};

const witnesses = createWitnesses(merkleTreeContext);

const electionCompiledContract = CompiledContract.make<Election.Contract<ElectionPrivateState>>(
  'Election',
  Election.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

// ── Merkle Tree Context ────────────────────────────────────────────────

export const updateMerkleTreeContext = async (
  providers: ElectionProviders,
  contractAddress: ContractAddress,
): Promise<void> => {
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
  } catch (e) {
    logger.warn(`Failed to extract Merkle trees from state: ${e}`);
  }
};

// ── Deploy / Join ──────────────────────────────────────────────────────

export const deploy = async (
  providers: ElectionProviders,
  privateState: ElectionPrivateState,
): Promise<DeployedElectionContract> => {
  logger.info('Deploying Election contract...');
  const contract = await deployContract(providers as any, {
    compiledContract: electionCompiledContract,
    privateStateId: ElectionPrivateStateId,
    initialPrivateState: privateState,
  });
  logger.info(`Deployed contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as any;
};

export const joinContract = async (
  providers: ElectionProviders,
  contractAddress: string,
  privateState: ElectionPrivateState,
): Promise<DeployedElectionContract> => {
  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: electionCompiledContract,
    privateStateId: ElectionPrivateStateId,
    initialPrivateState: privateState,
  });
  logger.info(`Joined contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as any;
};

// ── Circuit Calls ──────────────────────────────────────────────────────

export const setTopic = async (contract: DeployedElectionContract, topic: string): Promise<FinalizedTxData> => {
  logger.info(`Setting election topic: "${topic}"`);
  const r = await contract.callTx.set_topic(topic);
  logger.info(`Transaction ${r.public.txId} in block ${r.public.blockHeight}`);
  return r.public;
};

export const addVoter = async (
  contract: DeployedElectionContract,
  providers: ElectionProviders,
  voterPk: Uint8Array,
): Promise<FinalizedTxData> => {
  await updateMerkleTreeContext(providers, contract.deployTxData.public.contractAddress);
  logger.info(`Adding voter: ${Buffer.from(voterPk).toString('hex').substring(0, 16)}...`);
  const r = await contract.callTx.add_voter(voterPk);
  logger.info(`Transaction ${r.public.txId} in block ${r.public.blockHeight}`);
  return r.public;
};

export const advance = async (contract: DeployedElectionContract): Promise<FinalizedTxData> => {
  logger.info('Advancing election state...');
  const r = await contract.callTx.advance();
  logger.info(`Transaction ${r.public.txId} in block ${r.public.blockHeight}`);
  return r.public;
};

export const voteCommit = async (
  contract: DeployedElectionContract,
  providers: ElectionProviders,
  ballot: number,
): Promise<FinalizedTxData> => {
  await updateMerkleTreeContext(providers, contract.deployTxData.public.contractAddress);
  logger.info(`Committing vote: ${ballot === 0 ? 'yes' : 'no'}`);
  const r = await contract.callTx['vote$commit'](ballot);
  logger.info(`Transaction ${r.public.txId} in block ${r.public.blockHeight}`);
  return r.public;
};

export const voteReveal = async (
  contract: DeployedElectionContract,
  providers: ElectionProviders,
): Promise<FinalizedTxData> => {
  await updateMerkleTreeContext(providers, contract.deployTxData.public.contractAddress);
  logger.info('Revealing vote...');
  const r = await contract.callTx['vote$reveal']();
  logger.info(`Transaction ${r.public.txId} in block ${r.public.blockHeight}`);
  return r.public;
};

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

export const getElectionState = async (
  providers: ElectionProviders,
  contractAddress: ContractAddress,
): Promise<ElectionPublicState | null> => {
  assertIsContractAddress(contractAddress);
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  if (!contractState) return null;

  try {
    const stateArr = contractState.data.state.asArray()!;
    const cr = await import('@midnight-ntwrk/compact-runtime');
    const bytesType = new cr.CompactTypeBytes(32);
    const enumType = new cr.CompactTypeEnum(3, 1);
    const uintType = new cr.CompactTypeUnsignedInteger(18446744073709551615n, 8);

    const authorityCell = stateArr[0]!.asCell()!;
    const authority = Buffer.from(bytesType.fromValue([...authorityCell.value])).toString('hex');

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

    return { authority, state: publicState, topic: { is_some: isSome, value: topicStr }, tallyYes, tallyNo, eligibleVoterCount, committedVoteCount };
  } catch (e) {
    logger.warn(`Failed to parse election state: ${e}`);
    return null;
  }
};

// ── Helpers ────────────────────────────────────────────────────────────

export const derivePublicKey = (secretKey: Uint8Array): Uint8Array => {
  const bytesType = new CompactTypeBytes(32);
  const prefix = new Uint8Array(32);
  const prefixStr = 'lares:election:pk:';
  for (let i = 0; i < prefixStr.length; i++) prefix[i] = prefixStr.charCodeAt(i);
  return persistentHash(
    {
      alignment: () => bytesType.alignment().concat(bytesType.alignment()),
      toValue: (v: Uint8Array[]) => bytesType.toValue(v[0]).concat(bytesType.toValue(v[1])),
      fromValue: () => { throw new Error('not needed'); },
    },
    [prefix, secretKey],
  );
};

export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return bytes;
};

// ── Provider Configuration ──────────────────────────────────────────────

export const configureProviders = async (ctx: WalletContext, config: Config): Promise<ElectionProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<ElectionCircuits>(contractConfig.zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof ElectionPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      privateStoragePasswordProvider: () => 'MnfElection-Pr1vate!',
      accountId: ctx.unshieldedKeystore.getBech32Address().asString(),
    }),
    publicDataProvider: wrapPublicDataProviderWithRehash(
      indexerPublicDataProvider(config.indexer, config.indexerWS),
    ),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

export function setLogger(_logger: Logger) {
  logger = _logger;
}
