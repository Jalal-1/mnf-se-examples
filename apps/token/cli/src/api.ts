import { type ContractAddress, CompactTypeBytes, persistentHash } from '@midnight-ntwrk/compact-runtime';
import { Token, type TokenPrivateState, createWitnesses } from '@mnf-se/token-contract';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
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
  type TokenCircuits,
  type TokenProviders,
  type DeployedTokenContract,
  TokenPrivateStateId,
} from './types.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

let logger: Logger;

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

const contractConfig = {
  privateStateStoreName: 'token-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'token'),
};

// ── Compiled Contract ──────────────────────────────────────────────────

const witnesses = createWitnesses();

const tokenCompiledContract = CompiledContract.make<Token.Contract<TokenPrivateState>>(
  'Token',
  Token.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

// ── Deploy / Join ──────────────────────────────────────────────────────

export const deploy = async (
  providers: TokenProviders,
  privateState: TokenPrivateState,
  domainSep: string,
): Promise<DeployedTokenContract> => {
  logger.info('Deploying Token contract...');
  const domainSepBytes = new Uint8Array(32);
  const encoder = new TextEncoder();
  domainSepBytes.set(encoder.encode(domainSep.substring(0, 32)));

  const contract = await deployContract(providers as any, {
    compiledContract: tokenCompiledContract,
    privateStateId: TokenPrivateStateId,
    initialPrivateState: privateState,
    args: [domainSepBytes],
  });
  logger.info(`Deployed contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as any;
};

export const joinContract = async (
  providers: TokenProviders,
  contractAddress: string,
  privateState: TokenPrivateState,
): Promise<DeployedTokenContract> => {
  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: tokenCompiledContract,
    privateStateId: TokenPrivateStateId,
    initialPrivateState: privateState,
  });
  logger.info(`Joined contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as any;
};

// ── Token Circuit Calls ────────────────────────────────────────────────

export const mintTokens = async (
  contract: DeployedTokenContract,
  amount: number,
  recipientKey: Uint8Array,
): Promise<FinalizedTxData> => {
  logger.info(`Minting ${amount} tokens to ${Buffer.from(recipientKey).toString('hex').substring(0, 16)}...`);
  const finalizedTxData = await contract.callTx.mint(BigInt(amount), { bytes: recipientKey });
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const mintUnshieldedTokens = async (
  contract: DeployedTokenContract,
  amount: number,
  recipientAddress: Uint8Array,
): Promise<FinalizedTxData> => {
  if (amount <= 0) throw new Error('Amount must be greater than zero');
  logger.info(`Minting ${amount} unshielded tokens to ${Buffer.from(recipientAddress).toString('hex').substring(0, 16)}...`);
  const finalizedTxData = await contract.callTx.mint_unshielded(BigInt(amount), { bytes: recipientAddress });
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

export const burnTokens = async (
  contract: DeployedTokenContract,
  coin: { nonce: Uint8Array; color: Uint8Array; value: bigint },
): Promise<FinalizedTxData> => {
  logger.info(`Burning ${coin.value} tokens...`);
  const finalizedTxData = await contract.callTx.burn(coin);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
};

// ── Read Contract State ────────────────────────────────────────────────

export type TokenPublicState = {
  owner: string;
  shieldedSupply: bigint;
  unshieldedSupply: bigint;
  domainSeparator: string;
  tokenColor: string;
};

export const getTokenState = async (
  providers: TokenProviders,
  contractAddress: ContractAddress,
): Promise<TokenPublicState | null> => {
  assertIsContractAddress(contractAddress);
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  if (!contractState) return null;

  try {
    const stateArr = (contractState as any).data.state.asArray()!;
    const cr = await import('@midnight-ntwrk/compact-runtime');
    const bytesType = new cr.CompactTypeBytes(32);
    const uintType = new cr.CompactTypeUnsignedInteger(18446744073709551615n, 8);

    // State layout: [0]=owner, [1]=shielded_supply, [2]=unshielded_supply, [3]=domain_separator
    const ownerCell = stateArr[0]!.asCell()!;
    const owner = Buffer.from(bytesType.fromValue([...ownerCell.value])).toString('hex');

    const shieldedCell = stateArr[1]!.asCell()!;
    const shieldedSupply = uintType.fromValue([...shieldedCell.value]);

    const unshieldedCell = stateArr[2]!.asCell()!;
    const unshieldedSupply = uintType.fromValue([...unshieldedCell.value]);

    const dsCell = stateArr[3]!.asCell()!;
    const dsBytes = bytesType.fromValue([...dsCell.value]);
    const domainSeparator = new TextDecoder().decode(dsBytes).replace(/\0+$/, '');

    return { owner, shieldedSupply, unshieldedSupply, domainSeparator, tokenColor: '' };
  } catch (e) {
    logger.warn(`Failed to parse token state: ${e}`);
    return null;
  }
};

// ── Wallet Helpers ──────────────────────────────────────────────────────

export const getShieldedTokenBalance = async (
  wallet: WalletContext['wallet'],
  tokenColor: string,
): Promise<bigint> => {
  const state = await Rx.firstValueFrom(wallet.state());
  return state.shielded?.balances[tokenColor] ?? 0n;
};

export const getAllShieldedBalances = async (wallet: WalletContext['wallet']): Promise<Record<string, bigint>> => {
  const state = await Rx.firstValueFrom(wallet.state());
  return state.shielded?.balances ?? {};
};

/**
 * Derive the public key from a secret key, matching the contract's derive_public_key circuit:
 *   persistentHash([pad(32, "midnight:token:pk:"), sk])
 */
export const derivePublicKey = (secretKey: Uint8Array): Uint8Array => {
  const bytesType = new CompactTypeBytes(32);
  const prefix = new Uint8Array(32);
  const prefixStr = 'midnight:token:pk:';
  for (let i = 0; i < prefixStr.length; i++) {
    prefix[i] = prefixStr.charCodeAt(i);
  }
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

export const configureProviders = async (ctx: WalletContext, config: Config): Promise<TokenProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<TokenCircuits>(contractConfig.zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof TokenPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      privateStoragePasswordProvider: () => 'MnfToken-Pr1vate!',
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
