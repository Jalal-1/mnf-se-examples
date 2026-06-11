import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { Multisig, type MultisigPrivateState, witnesses } from '@mnf-se/multisig-contract';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { Logger } from 'pino';
import path from 'node:path';
import { WebSocket } from 'ws';

import {
  type Config,
  type WalletContext,
  createWalletAndMidnightProvider,
} from '@mnf-se/common';

import {
  type DeployedMultisigContract,
  type MultisigCircuits,
  type MultisigProviders,
  MultisigPrivateStateId,
} from './types.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo.
globalThis.WebSocket = WebSocket;

let logger: Logger;

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

const contractConfig = {
  privateStateStoreName: 'multisig-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'multisig'),
};

const multisigCompiledContract = CompiledContract.make(
  'multisig',
  Multisig.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

export type ProposalView = {
  readonly actionHash: Uint8Array;
  readonly status: number;
  readonly approvals: bigint;
};

export const deploy = async (
  providers: MultisigProviders,
  signerPubkeys: unknown[],
  threshold: bigint,
  instanceSalt: Uint8Array,
): Promise<DeployedMultisigContract> => {
  logger.info('Deploying Schnorr multisig contract...');
  const contract = await deployContract(providers as any, {
    compiledContract: multisigCompiledContract,
    privateStateId: MultisigPrivateStateId,
    initialPrivateState: {} satisfies MultisigPrivateState,
    args: [signerPubkeys, threshold, instanceSalt],
  });
  logger.info(`Deployed contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as DeployedMultisigContract;
};

export const joinContract = async (
  providers: MultisigProviders,
  contractAddress: string,
): Promise<DeployedMultisigContract> => {
  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: multisigCompiledContract,
    privateStateId: MultisigPrivateStateId,
    initialPrivateState: {} satisfies MultisigPrivateState,
  });
  logger.info(`Joined contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as DeployedMultisigContract;
};

export const createProposal = async (
  contract: DeployedMultisigContract,
  actionHash: Uint8Array,
): Promise<{ tx: FinalizedTxData; proposalId: bigint }> => {
  logger.info('Creating proposal...');
  const result = await contract.callTx.createProposal(actionHash);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return { tx: result.public, proposalId: result.private.result as bigint };
};

export const approveProposal = async (
  contract: DeployedMultisigContract,
  proposalId: bigint,
  signer: unknown,
  signature: unknown,
): Promise<FinalizedTxData> => {
  logger.info(`Submitting approval for proposal ${proposalId}...`);
  const result = await contract.callTx.approveProposal(proposalId, signer, signature);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return result.public;
};

export const executeProposal = async (
  contract: DeployedMultisigContract,
  proposalId: bigint,
): Promise<{ tx: FinalizedTxData; actionHash: Uint8Array }> => {
  logger.info(`Executing proposal ${proposalId}...`);
  const result = await contract.callTx.executeProposal(proposalId);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return { tx: result.public, actionHash: result.private.result as Uint8Array };
};

export const readProposal = async (
  contract: DeployedMultisigContract,
  proposalId: bigint,
): Promise<ProposalView> => {
  const action = await contract.callTx.getProposalActionHash(proposalId);
  const status = await contract.callTx.getProposalStatus(proposalId);
  const approvals = await contract.callTx.getApprovalCount(proposalId);
  return {
    actionHash: action.private.result as Uint8Array,
    status: status.private.result as number,
    approvals: approvals.private.result as bigint,
  };
};

export const getContractSummary = async (
  providers: MultisigProviders,
  contractAddress: ContractAddress,
): Promise<{
  signerCount: bigint;
  threshold: bigint;
  nextProposalId: bigint;
  executedCount: bigint;
  instanceSalt: Uint8Array;
} | null> => {
  assertIsContractAddress(contractAddress);
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  if (!state) return null;
  const ledger = Multisig.ledger(state.data);
  return {
    signerCount: ledger._signerCount,
    threshold: ledger._threshold,
    nextProposalId: ledger._nextProposalId,
    executedCount: ledger._executedCount,
    instanceSalt: ledger._instanceSalt,
  };
};

export const configureProviders = async (ctx: WalletContext, config: Config): Promise<MultisigProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<MultisigCircuits>(contractConfig.zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof MultisigPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      privateStoragePasswordProvider: () => 'MnfMultisig-Pr1vate!',
      accountId: ctx.unshieldedKeystore.getBech32Address().asString(),
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  } as MultisigProviders;
};

export function setLogger(_logger: Logger) {
  logger = _logger;
}
