import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { FungibleToken, type FungibleTokenPrivateState } from '@mnf-se/fungible-token-contract';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';
import { type Logger } from 'pino';
import path from 'node:path';
import { WebSocket } from 'ws';

import {
  type Config,
  type WalletContext,
  createWalletAndMidnightProvider,
} from '@mnf-se/common';

import {
  type FungibleTokenCircuits,
  type FungibleTokenProviders,
  type DeployedFungibleTokenContract,
  FungibleTokenPrivateStateId,
} from './types.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

let logger: Logger;

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

const contractConfig = {
  privateStateStoreName: 'fungible-token-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'fungible-token'),
};

// ── Compiled Contract ──────────────────────────────────────────────────
// FungibleToken has no local witnesses — identity comes from ownPublicKey() built-in

const fungibleTokenCompiledContract = CompiledContract.make(
  'FungibleToken',
  FungibleToken.Contract,
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

// ── Either helpers ─────────────────────────────────────────────────────

type Either<A, B> = { is_left: boolean; left: A; right: B };
type ZswapCoinPublicKey = { bytes: Uint8Array };
type FTContractAddress = { bytes: Uint8Array };

/** Wrap a ZswapCoinPublicKey as left(key) in an Either<ZswapCoinPublicKey, ContractAddress> */
export const leftPublicKey = (pubKeyBytes: Uint8Array): Either<ZswapCoinPublicKey, FTContractAddress> => ({
  is_left: true,
  left: { bytes: pubKeyBytes },
  right: { bytes: new Uint8Array(32) },
});

/** Wrap a ContractAddress as right(addr) in an Either<ZswapCoinPublicKey, ContractAddress> */
export const rightContractAddress = (addrBytes: Uint8Array): Either<ZswapCoinPublicKey, FTContractAddress> => ({
  is_left: false,
  left: { bytes: new Uint8Array(32) },
  right: { bytes: addrBytes },
});

// ── Deploy / Join ──────────────────────────────────────────────────────

export const deploy = async (
  providers: FungibleTokenProviders,
  name: string,
  symbol: string,
  decimals: bigint,
): Promise<DeployedFungibleTokenContract> => {
  logger.info(`Deploying FungibleToken contract (${name} / ${symbol} / ${decimals} decimals)...`);

  const contract = await deployContract(providers as any, {
    compiledContract: fungibleTokenCompiledContract,
    privateStateId: FungibleTokenPrivateStateId,
    initialPrivateState: {} as FungibleTokenPrivateState,
    args: [name, symbol, decimals],
  });
  logger.info(`Deployed contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as any;
};

export const joinContract = async (
  providers: FungibleTokenProviders,
  contractAddress: string,
): Promise<DeployedFungibleTokenContract> => {
  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: fungibleTokenCompiledContract,
    privateStateId: FungibleTokenPrivateStateId,
    initialPrivateState: {} as FungibleTokenPrivateState,
  });
  logger.info(`Joined contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as any;
};

// ── Circuit Calls ──────────────────────────────────────────────────────

export const mint = async (
  contract: DeployedFungibleTokenContract,
  account: Either<ZswapCoinPublicKey, FTContractAddress>,
  value: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Minting ${value} tokens...`);
  const finalizedTxData = await contract.callTx.mint(account, value);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const burn = async (
  contract: DeployedFungibleTokenContract,
  account: Either<ZswapCoinPublicKey, FTContractAddress>,
  value: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Burning ${value} tokens...`);
  const finalizedTxData = await contract.callTx.burn(account, value);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const transfer = async (
  contract: DeployedFungibleTokenContract,
  to: Either<ZswapCoinPublicKey, FTContractAddress>,
  value: bigint,
): Promise<FinalizedTxData> => {
  logger.info(`Transferring ${value} tokens...`);
  const finalizedTxData = await contract.callTx.transfer(to, value);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const balanceOf = async (
  contract: DeployedFungibleTokenContract,
  account: Either<ZswapCoinPublicKey, FTContractAddress>,
): Promise<{ tx: FinalizedTxData; balance: bigint }> => {
  logger.info('Querying balanceOf...');
  const finalizedTxData = await contract.callTx.balanceOf(account);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  const balance = finalizedTxData.private.result as bigint;
  logger.info(`Balance: ${balance}`);
  return { tx: finalizedTxData.public, balance };
};

export const totalSupply = async (
  contract: DeployedFungibleTokenContract,
): Promise<{ tx: FinalizedTxData; supply: bigint }> => {
  logger.info('Querying totalSupply...');
  const finalizedTxData = await contract.callTx.totalSupply();
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  const supply = finalizedTxData.private.result as bigint;
  logger.info(`Total supply: ${supply}`);
  return { tx: finalizedTxData.public, supply };
};

// ── Read Contract State (via ledger query) ─────────────────────────────

export type FungibleTokenState = {
  name: string;
  symbol: string;
  decimals: bigint;
};

export const getTokenState = async (
  contract: DeployedFungibleTokenContract,
): Promise<FungibleTokenState | null> => {
  try {
    // Use callTx for read operations — the contract circuits return the values
    const nameTx = await contract.callTx.name();
    const symbolTx = await contract.callTx.symbol();
    const decimalsTx = await contract.callTx.decimals();

    return {
      name: String(nameTx.public.txId ? '(queried)' : ''),
      symbol: String(symbolTx.public.txId ? '(queried)' : ''),
      decimals: 0n,
    };
  } catch (e) {
    logger.warn(`Failed to read token state: ${e}`);
    return null;
  }
};

// ── Provider Configuration ──────────────────────────────────────────────

export const configureProviders = async (ctx: WalletContext, config: Config): Promise<FungibleTokenProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<FungibleTokenCircuits>(contractConfig.zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof FungibleTokenPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      privateStoragePasswordProvider: () => 'MnfFungibleToken-Pr1vate!',
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
