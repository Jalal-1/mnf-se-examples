import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { NFT, type NftPrivateState } from '@mnf-se/nft-contract';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';
import { type Logger } from 'pino';
import { WebSocket } from 'ws';
import { Buffer } from 'buffer';
import path from 'node:path';

import {
  type Config,
  type WalletContext,
  createWalletAndMidnightProvider,
} from '@mnf-se/common';

import {
  type NftCircuits,
  type NftProviders,
  type DeployedNftContract,
  NftPrivateStateId,
} from './types.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

let logger: Logger;

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

const contractConfig = {
  privateStateStoreName: 'nft-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'nft'),
};

// ── Compiled Contract ──────────────────────────────────────────────────

const nftCompiledContract = CompiledContract.make('nft', NFT.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

// ── Either helper ──────────────────────────────────────────────────────

export type EitherAddress = NFT.Either<NFT.ZswapCoinPublicKey, NFT.ContractAddress>;

export function zswapKeyToEither(keyBytes: Uint8Array): EitherAddress {
  return {
    is_left: true,
    left: { bytes: keyBytes },
    right: { bytes: new Uint8Array(32) },
  };
}

export function contractAddrToEither(addrBytes: Uint8Array): EitherAddress {
  return {
    is_left: false,
    left: { bytes: new Uint8Array(32) },
    right: { bytes: addrBytes },
  };
}

export function eitherToHex(either: EitherAddress): string {
  if (either.is_left) {
    return `zswap:${Buffer.from(either.left.bytes).toString('hex')}`;
  } else {
    return `contract:${Buffer.from(either.right.bytes).toString('hex')}`;
  }
}

// ── Deploy / Join ──────────────────────────────────────────────────────

export const deploy = async (
  providers: NftProviders,
  name: string,
  symbol: string,
): Promise<DeployedNftContract> => {
  logger.info(`Deploying NFT contract (name="${name}", symbol="${symbol}")...`);
  const contract = await deployContract(providers as any, {
    compiledContract: nftCompiledContract,
    privateStateId: NftPrivateStateId,
    initialPrivateState: {} as NftPrivateState,
    args: [name, symbol],
  });
  logger.info(`Deployed contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as any;
};

export const joinContract = async (
  providers: NftProviders,
  contractAddress: string,
): Promise<DeployedNftContract> => {
  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: nftCompiledContract,
    privateStateId: NftPrivateStateId,
    initialPrivateState: {} as NftPrivateState,
  });
  logger.info(`Joined contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as any;
};

// ── NFT Circuit Calls ────────────────────────────────────────────────

export const mintNft = async (
  contract: DeployedNftContract,
  to: EitherAddress,
  tokenId: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Minting NFT #${tokenId} to ${eitherToHex(to).substring(0, 32)}...`);
  const finalizedTxData = await contract.callTx.mint(to, tokenId);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const transferFromNft = async (
  contract: DeployedNftContract,
  from: EitherAddress,
  to: EitherAddress,
  tokenId: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Transferring NFT #${tokenId}...`);
  const finalizedTxData = await contract.callTx.transferFrom(from, to, tokenId);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const burnNft = async (
  contract: DeployedNftContract,
  tokenId: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Burning NFT #${tokenId}...`);
  const finalizedTxData = await contract.callTx.burn(tokenId);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const setTokenUri = async (
  contract: DeployedNftContract,
  tokenId: bigint,
  uri: string,
): Promise<FinalizedTxData> => {
  logger.info(`Setting URI for NFT #${tokenId}...`);
  const finalizedTxData = await contract.callTx.setTokenURI(tokenId, uri);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

// ── Read Circuit Calls ───────────────────────────────────────────────

export const ownerOf = async (
  contract: DeployedNftContract,
  tokenId: bigint,
): Promise<{ txData: FinalizedTxData; owner: EitherAddress }> => {
  logger.info(`Querying owner of NFT #${tokenId}...`);
  const result = await contract.callTx.ownerOf(tokenId);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return { txData: result.public, owner: result.private.result as unknown as EitherAddress };
};

export const balanceOf = async (
  contract: DeployedNftContract,
  account: EitherAddress,
): Promise<{ txData: FinalizedTxData; balance: bigint }> => {
  logger.info(`Querying balance of ${eitherToHex(account).substring(0, 32)}...`);
  const result = await contract.callTx.balanceOf(account);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return { txData: result.public, balance: result.private.result as unknown as bigint };
};

export const getTokenUri = async (
  contract: DeployedNftContract,
  tokenId: bigint,
): Promise<{ txData: FinalizedTxData; uri: string }> => {
  logger.info(`Querying URI of NFT #${tokenId}...`);
  const result = await contract.callTx.tokenURI(tokenId);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return { txData: result.public, uri: result.private.result as unknown as string };
};

export const getName = async (
  contract: DeployedNftContract,
): Promise<{ txData: FinalizedTxData; name: string }> => {
  logger.info('Querying collection name...');
  const result = await contract.callTx.name();
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return { txData: result.public, name: result.private.result as unknown as string };
};

export const getSymbol = async (
  contract: DeployedNftContract,
): Promise<{ txData: FinalizedTxData; symbol: string }> => {
  logger.info('Querying collection symbol...');
  const result = await contract.callTx.symbol();
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return { txData: result.public, symbol: result.private.result as unknown as string };
};

// ── Provider Configuration ──────────────────────────────────────────────

export const configureProviders = async (ctx: WalletContext, config: Config): Promise<NftProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<NftCircuits>(contractConfig.zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof NftPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      privateStoragePasswordProvider: () => 'MnfNft-Pr1vate!',
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
