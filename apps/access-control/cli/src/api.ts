import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { AccessControl, type AccessControlPrivateState } from '@mnf-se/access-control-contract';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import { type Logger } from 'pino';
import path from 'node:path';
import { WebSocket } from 'ws';

import {
  type Config,
  type WalletContext,
  createWalletAndMidnightProvider,
} from '@mnf-se/common';

import {
  type AccessControlCircuits,
  type AccessControlProviders,
  type DeployedAccessControlContract,
  AccessControlPrivateStateId,
} from './types.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

let logger: Logger;

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

const contractConfig = {
  privateStateStoreName: 'access-control-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'access-control'),
};

// ── Compiled Contract ──────────────────────────────────────────────────
// AccessControl has no local witnesses — identity comes from ownPublicKey() built-in

const accessControlCompiledContract = CompiledContract.make(
  'AccessControl',
  AccessControl.Contract,
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

// ── Either helpers ─────────────────────────────────────────────────────

type Either<A, B> = { is_left: boolean; left: A; right: B };
type ZswapCoinPublicKey = { bytes: Uint8Array };
type ACContractAddress = { bytes: Uint8Array };

/** Wrap a ZswapCoinPublicKey as left(key) in an Either<ZswapCoinPublicKey, ContractAddress> */
export const leftPublicKey = (pubKeyBytes: Uint8Array): Either<ZswapCoinPublicKey, ACContractAddress> => ({
  is_left: true,
  left: { bytes: pubKeyBytes },
  right: { bytes: new Uint8Array(32) },
});

/** Wrap a ContractAddress as right(addr) in an Either<ZswapCoinPublicKey, ContractAddress> */
export const rightContractAddress = (addrBytes: Uint8Array): Either<ZswapCoinPublicKey, ACContractAddress> => ({
  is_left: false,
  left: { bytes: new Uint8Array(32) },
  right: { bytes: addrBytes },
});

// ── Deploy / Join ──────────────────────────────────────────────────────

export const deploy = async (
  providers: AccessControlProviders,
): Promise<DeployedAccessControlContract> => {
  logger.info('Deploying AccessControl contract...');

  const contract = await deployContract(providers as any, {
    compiledContract: accessControlCompiledContract,
  } as any);
  logger.info(`Deployed contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as any;
};

export const joinContract = async (
  providers: AccessControlProviders,
  contractAddress: string,
): Promise<DeployedAccessControlContract> => {
  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: accessControlCompiledContract,
    privateStateId: AccessControlPrivateStateId,
    initialPrivateState: {} as AccessControlPrivateState,
  });
  logger.info(`Joined contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as any;
};

// ── Circuit Calls ──────────────────────────────────────────────────────

export const increment = async (
  contract: DeployedAccessControlContract,
): Promise<FinalizedTxData> => {
  logger.info('Incrementing counter...');
  const finalizedTxData = await contract.callTx.increment();
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const pause = async (
  contract: DeployedAccessControlContract,
): Promise<FinalizedTxData> => {
  logger.info('Pausing contract...');
  const finalizedTxData = await contract.callTx.pause();
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const unpause = async (
  contract: DeployedAccessControlContract,
): Promise<FinalizedTxData> => {
  logger.info('Unpausing contract...');
  const finalizedTxData = await contract.callTx.unpause();
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const grantRole = async (
  contract: DeployedAccessControlContract,
  roleId: Uint8Array,
  account: Either<ZswapCoinPublicKey, ACContractAddress>,
): Promise<FinalizedTxData> => {
  logger.info('Granting role...');
  const finalizedTxData = await contract.callTx.grantRole(roleId, account);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const revokeRole = async (
  contract: DeployedAccessControlContract,
  roleId: Uint8Array,
  account: Either<ZswapCoinPublicKey, ACContractAddress>,
): Promise<FinalizedTxData> => {
  logger.info('Revoking role...');
  const finalizedTxData = await contract.callTx.revokeRole(roleId, account);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const hasRole = async (
  contract: DeployedAccessControlContract,
  roleId: Uint8Array,
  account: Either<ZswapCoinPublicKey, ACContractAddress>,
): Promise<{ tx: FinalizedTxData; result: boolean }> => {
  logger.info('Checking role...');
  const finalizedTxData = await contract.callTx.hasRole(roleId, account);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  const result = finalizedTxData.private.result as boolean;
  logger.info(`Has role: ${result}`);
  return { tx: finalizedTxData.public, result };
};

export const renounceRole = async (
  contract: DeployedAccessControlContract,
  roleId: Uint8Array,
  callerConfirmation: Either<ZswapCoinPublicKey, ACContractAddress>,
): Promise<FinalizedTxData> => {
  logger.info('Renouncing role...');
  const finalizedTxData = await contract.callTx.renounceRole(roleId, callerConfirmation);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

// ── Read Contract State (via ledger query) ─────────────────────────────

export type AccessControlState = {
  counter: bigint;
  minterRole: Uint8Array;
  pauserRole: Uint8Array;
  defaultAdminRole: Uint8Array;
};

// DEFAULT_ADMIN_ROLE is Bytes<32> of all zeros (the default value in AccessControl module)
const DEFAULT_ADMIN_ROLE_BYTES = new Uint8Array(32);

export const getContractState = (
  contract: DeployedAccessControlContract,
): AccessControlState | null => {
  try {
    const contractState = (contract as any).deployTxData?.public?.initialContractState
      ?? (contract as any).contractState;
    if (!contractState?.data) return null;
    const ledgerState = AccessControl.ledger(contractState.data);
    return {
      counter: ledgerState.counter,
      minterRole: ledgerState.MINTER_ROLE as Uint8Array,
      pauserRole: ledgerState.PAUSER_ROLE as Uint8Array,
      defaultAdminRole: DEFAULT_ADMIN_ROLE_BYTES,
    };
  } catch (e) {
    logger.warn(`Failed to read contract state: ${e}`);
    return null;
  }
};

// ── Provider Configuration ──────────────────────────────────────────────

export const configureProviders = async (ctx: WalletContext, config: Config): Promise<AccessControlProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<AccessControlCircuits>(contractConfig.zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof AccessControlPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      privateStoragePasswordProvider: () => 'MnfAccess-Ctr0l!',
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
