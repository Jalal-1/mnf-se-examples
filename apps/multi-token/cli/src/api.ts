import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { MultiToken, type MultiTokenPrivateState } from '@mnf-se/multi-token-contract';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import { type Logger } from 'pino';
import { Buffer } from 'buffer';
import path from 'node:path';
import { WebSocket } from 'ws';

import {
  type Config,
  type WalletContext,
  createWalletAndMidnightProvider,
} from '@mnf-se/common';

import {
  type MultiTokenCircuits,
  type MultiTokenProviders,
  type DeployedMultiTokenContract,
  MultiTokenPrivateStateId,
} from './types.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

let logger: Logger;

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

const contractConfig = {
  privateStateStoreName: 'multi-token-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'multi-token'),
};

// ── Compiled Contract ──────────────────────────────────────────────────
// MultiToken has no local witnesses — identity comes from ownPublicKey() built-in

const multiTokenCompiledContract = CompiledContract.make(
  'MultiToken',
  MultiToken.Contract,
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

// ── Either helpers ─────────────────────────────────────────────────────

export type EitherAddress = MultiToken.Either<MultiToken.ZswapCoinPublicKey, MultiToken.ContractAddress>;

/** Wrap a ZswapCoinPublicKey as left(key) in an Either<ZswapCoinPublicKey, ContractAddress> */
export const leftPublicKey = (pubKeyBytes: Uint8Array): EitherAddress => ({
  is_left: true,
  left: { bytes: pubKeyBytes },
  right: { bytes: new Uint8Array(32) },
});

/** Wrap a ContractAddress as right(addr) in an Either<ZswapCoinPublicKey, ContractAddress> */
export const rightContractAddress = (addrBytes: Uint8Array): EitherAddress => ({
  is_left: false,
  left: { bytes: new Uint8Array(32) },
  right: { bytes: addrBytes },
});

export function eitherToHex(either: EitherAddress): string {
  if (either.is_left) {
    return `zswap:${Buffer.from(either.left.bytes).toString('hex')}`;
  } else {
    return `contract:${Buffer.from(either.right.bytes).toString('hex')}`;
  }
}

// ── Deploy / Join ──────────────────────────────────────────────────────

export const deploy = async (
  providers: MultiTokenProviders,
  uri: string,
): Promise<DeployedMultiTokenContract> => {
  logger.info(`Deploying MultiToken contract (uri="${uri}")...`);

  const contract = await deployContract(providers as any, {
    compiledContract: multiTokenCompiledContract,
    privateStateId: MultiTokenPrivateStateId,
    initialPrivateState: {} as MultiTokenPrivateState,
    args: [uri],
  });
  logger.info(`Deployed contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as any;
};

export const joinContract = async (
  providers: MultiTokenProviders,
  contractAddress: string,
): Promise<DeployedMultiTokenContract> => {
  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: multiTokenCompiledContract,
    privateStateId: MultiTokenPrivateStateId,
    initialPrivateState: {} as MultiTokenPrivateState,
  });
  logger.info(`Joined contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as any;
};

// ── Circuit Calls ──────────────────────────────────────────────────────

export const mint = async (
  contract: DeployedMultiTokenContract,
  to: EitherAddress,
  id: bigint,
  value: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Minting ${value} of token #${id}...`);
  const finalizedTxData = await contract.callTx.mint(to, id, value);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const burn = async (
  contract: DeployedMultiTokenContract,
  fromAddress: EitherAddress,
  id: bigint,
  value: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Burning ${value} of token #${id}...`);
  const finalizedTxData = await contract.callTx.burn(fromAddress, id, value);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const transferFrom = async (
  contract: DeployedMultiTokenContract,
  fromAddress: EitherAddress,
  to: EitherAddress,
  id: bigint,
  value: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Transferring ${value} of token #${id}...`);
  const finalizedTxData = await contract.callTx.transferFrom(fromAddress, to, id, value);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const balanceOf = async (
  contract: DeployedMultiTokenContract,
  account: EitherAddress,
  id: bigint,
): Promise<{ tx: FinalizedTxData; balance: bigint }> => {
  logger.info(`Querying balance of token #${id}...`);
  const finalizedTxData = await contract.callTx.balanceOf(account, id);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  const balance = finalizedTxData.private.result as unknown as bigint;
  logger.info(`Balance: ${balance}`);
  return { tx: finalizedTxData.public, balance };
};

export const uri = async (
  contract: DeployedMultiTokenContract,
  id: bigint,
): Promise<{ tx: FinalizedTxData; uri: string }> => {
  logger.info(`Querying URI for token #${id}...`);
  const finalizedTxData = await contract.callTx.uri(id);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  const uriValue = finalizedTxData.private.result as unknown as string;
  logger.info(`URI: ${uriValue}`);
  return { tx: finalizedTxData.public, uri: uriValue };
};

export const setApprovalForAll = async (
  contract: DeployedMultiTokenContract,
  operator: EitherAddress,
  approved: boolean,
): Promise<FinalizedTxData> => {
  logger.info(`Setting approval for operator (approved=${approved})...`);
  const finalizedTxData = await contract.callTx.setApprovalForAll(operator, approved);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const isApprovedForAll = async (
  contract: DeployedMultiTokenContract,
  account: EitherAddress,
  operator: EitherAddress,
): Promise<{ tx: FinalizedTxData; approved: boolean }> => {
  logger.info('Querying operator approval...');
  const finalizedTxData = await contract.callTx.isApprovedForAll(account, operator);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  const approved = finalizedTxData.private.result as unknown as boolean;
  logger.info(`Approved: ${approved}`);
  return { tx: finalizedTxData.public, approved };
};

export const setURI = async (
  contract: DeployedMultiTokenContract,
  newURI: string,
): Promise<FinalizedTxData> => {
  logger.info(`Setting new URI: ${newURI}...`);
  const finalizedTxData = await contract.callTx.setURI(newURI);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

// ── Provider Configuration ──────────────────────────────────────────────

export const configureProviders = async (ctx: WalletContext, config: Config): Promise<MultiTokenProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<MultiTokenCircuits>(contractConfig.zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof MultiTokenPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      privateStoragePasswordProvider: () => 'MnfMulti-T0ken!x',
      accountId: ctx.unshieldedKeystore.getBech32Address().asString(),
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

export function setLogger(_logger: Logger) {
  logger = _logger;
}
