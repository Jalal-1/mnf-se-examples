import { MultisigToken, type MultisigTokenPrivateState, witnesses } from '@mnf-se/multisig-token-contract';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import type { Logger } from 'pino';
import * as Rx from 'rxjs';
import path from 'node:path';
import { WebSocket } from 'ws';

import {
  type Config,
  type WalletContext,
  createWalletAndMidnightProvider,
} from '@mnf-se/common';

import type { MintRecipient } from './crypto.js';
import {
  bytesToHex,
  bytesToTokenName,
} from './crypto.js';
import {
  type DeployedMultisigTokenContract,
  type MultisigTokenCircuits,
  type MultisigTokenProviders,
  MultisigTokenPrivateStateId,
} from './types.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo.
globalThis.WebSocket = WebSocket;

let logger: Logger;

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

const contractConfig = {
  privateStateStoreName: 'multisig-token-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'multisig-token'),
};

const multisigTokenCompiledContract = CompiledContract.make(
  'multisig-token',
  MultisigToken.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

export type MintProposalView = {
  readonly amount: bigint;
  readonly recipient: MintRecipient;
  readonly status: number;
  readonly approvals: bigint;
};

export type ContractSummary = {
  readonly tokenName: string;
  readonly domainSeparator: Uint8Array;
  readonly tokenColor: string;
  readonly shieldedSupply: bigint;
  readonly burnedSupply: bigint;
  readonly circulatingSupply: bigint;
  readonly signerCount: bigint;
  readonly threshold: bigint;
  readonly nextProposalId: bigint;
  readonly executedCount: bigint;
  readonly instanceSalt: Uint8Array;
};

export type ShieldedCoin = {
  readonly nonce: Uint8Array;
  readonly color: Uint8Array;
  readonly value: bigint;
};

export type QualifiedShieldedCoin = ShieldedCoin & {
  readonly mt_index: bigint;
};

export type SpendableShieldedCoin = QualifiedShieldedCoin & {
  readonly commitment: string;
  readonly nullifier: string;
};

export const deploy = async (
  providers: MultisigTokenProviders,
  tokenName: Uint8Array,
  signerPubkeys: unknown[],
  threshold: bigint,
  instanceSalt: Uint8Array,
): Promise<DeployedMultisigTokenContract> => {
  logger.info('Deploying multisig-controlled shielded token contract...');
  const contract = await deployContract(providers as any, {
    compiledContract: multisigTokenCompiledContract,
    privateStateId: MultisigTokenPrivateStateId,
    initialPrivateState: {} satisfies MultisigTokenPrivateState,
    args: [tokenName, signerPubkeys, threshold, instanceSalt],
  });
  logger.info(`Deployed contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as DeployedMultisigTokenContract;
};

export const joinContract = async (
  providers: MultisigTokenProviders,
  contractAddress: string,
): Promise<DeployedMultisigTokenContract> => {
  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: multisigTokenCompiledContract,
    privateStateId: MultisigTokenPrivateStateId,
    initialPrivateState: {} satisfies MultisigTokenPrivateState,
  });
  logger.info(`Joined contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as DeployedMultisigTokenContract;
};

export const createMintProposal = async (
  contract: DeployedMultisigTokenContract,
  amount: bigint,
  recipient: MintRecipient,
): Promise<{ tx: FinalizedTxData; proposalId: bigint }> => {
  logger.info(`Creating mint proposal for ${amount} shielded tokens...`);
  const result = await contract.callTx.createMintProposal(amount, recipient);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return { tx: result.public, proposalId: result.private.result as bigint };
};

export const approveMintProposal = async (
  contract: DeployedMultisigTokenContract,
  proposalId: bigint,
  signer: unknown,
  signature: unknown,
): Promise<FinalizedTxData> => {
  logger.info(`Submitting approval for mint proposal ${proposalId}...`);
  const result = await contract.callTx.approveMintProposal(proposalId, signer, signature);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return result.public;
};

export const executeMintProposal = async (
  contract: DeployedMultisigTokenContract,
  proposalId: bigint,
): Promise<{ tx: FinalizedTxData; coin: ShieldedCoin }> => {
  logger.info(`Executing mint proposal ${proposalId}...`);
  const result = await contract.callTx.executeMintProposal(proposalId);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return {
    tx: result.public,
    coin: result.private.result as ShieldedCoin,
  };
};

export const burnWalletCoinToShieldedBurnAddress = async (
  contract: DeployedMultisigTokenContract,
  coin: ShieldedCoin,
  amount: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Burning ${amount} from wallet coin via shielded burn address...`);
  const result = await contract.callTx.burnWalletCoinToShieldedBurnAddress(coin, amount);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return result.public;
};

export const burnTokensToShieldedBurnAddress = async (
  contract: DeployedMultisigTokenContract,
  coin: QualifiedShieldedCoin,
  amount: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Burning ${amount} via shielded burn address...`);
  const result = await contract.callTx.burnToShieldedBurnAddress(coin, amount);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return result.public;
};

export const readProposal = async (
  contract: DeployedMultisigTokenContract,
  proposalId: bigint,
): Promise<MintProposalView> => {
  const proposal = await contract.callTx.getMintProposalView(proposalId);
  const value = proposal.private.result as MintProposalView;
  return {
    amount: value.amount,
    recipient: value.recipient,
    status: value.status,
    approvals: value.approvals,
  };
};

export const getContractSummary = async (
  contract: DeployedMultisigTokenContract,
): Promise<ContractSummary> => {
  const summary = await contract.callTx.getSummary();
  const value = summary.private.result as {
    tokenName: Uint8Array;
    domainSeparator: Uint8Array;
    tokenColor: Uint8Array;
    shieldedSupply: bigint;
    burnedSupply: bigint;
    circulatingSupply: bigint;
    signerCount: bigint;
    threshold: bigint;
    nextProposalId: bigint;
    executedCount: bigint;
    instanceSalt: Uint8Array;
  };
  return {
    tokenName: bytesToTokenName(value.tokenName),
    domainSeparator: value.domainSeparator,
    tokenColor: bytesToHex(value.tokenColor),
    shieldedSupply: value.shieldedSupply,
    burnedSupply: value.burnedSupply,
    circulatingSupply: value.circulatingSupply,
    signerCount: value.signerCount,
    threshold: value.threshold,
    nextProposalId: value.nextProposalId,
    executedCount: value.executedCount,
    instanceSalt: value.instanceSalt,
  };
};

export const getShieldedTokenBalance = async (
  wallet: WalletContext['wallet'],
  tokenColor: string,
): Promise<bigint> => {
  const state = await Rx.firstValueFrom(wallet.state());
  return state.shielded?.balances[tokenColor] ?? 0n;
};

export const getSpendableShieldedTokenCoins = async (
  wallet: WalletContext['wallet'],
  tokenColor: string,
): Promise<SpendableShieldedCoin[]> => {
  const state = await Rx.firstValueFrom(wallet.state());
  return (state.shielded?.availableCoins ?? [])
    .filter(({ coin }) => coin.type === tokenColor && coin.value > 0n)
    .map(({ coin, commitment, nullifier }) => ({
      ...ledger.encodeQualifiedShieldedCoinInfo(coin),
      commitment,
      nullifier,
    }));
};

export const configureProviders = async (
  ctx: WalletContext,
  config: Config,
): Promise<MultisigTokenProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<MultisigTokenCircuits>(contractConfig.zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof MultisigTokenPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      privateStoragePasswordProvider: () => 'MnfMultisigToken-Pr1vate!',
      accountId: ctx.unshieldedKeystore.getBech32Address().asString(),
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  } as MultisigTokenProviders;
};

export function setLogger(_logger: Logger) {
  logger = _logger;
}
