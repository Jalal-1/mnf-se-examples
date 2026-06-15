import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { OzMultisigV3, type OzMultisigV3PrivateState, witnesses } from '@mnf-se/oz-multisig-v3-contract';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';
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

import { bytesToHex, type MintRecipient } from './crypto.js';
import {
  type DeployedOzMultisigV3Contract,
  type OzMultisigV3Circuits,
  type OzMultisigV3Providers,
  OzMultisigV3PrivateStateId,
} from './types.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo.
globalThis.WebSocket = WebSocket;

let logger: Logger;

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

const contractConfig = {
  privateStateStoreName: 'oz-multisig-v3-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'oz-multisig-v3'),
};

const compiledContract = CompiledContract.make(
  'oz-multisig-v3',
  OzMultisigV3.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

export type CompactQualifiedShieldedCoin = {
  readonly nonce: Uint8Array;
  readonly color: Uint8Array;
  readonly value: bigint;
  readonly mt_index: bigint;
};

export type SpendableShieldedCoin = CompactQualifiedShieldedCoin & {
  readonly commitment: string;
  readonly nullifier: string;
};

export type ContractSummary = {
  readonly address: string;
  readonly tokenName: string;
  readonly tokenDomain: Uint8Array;
  readonly coinNonce: Uint8Array;
  readonly tokenType: string;
  readonly counter: bigint;
  readonly instanceSalt: Uint8Array;
};

export const calculateSignerId = (pubkey: Uint8Array, instanceSalt: Uint8Array): Uint8Array =>
  OzMultisigV3.pureCircuits._calculateSignerId(pubkey, instanceSalt);

export const deploy = async (
  providers: OzMultisigV3Providers,
  instanceSalt: Uint8Array,
  initCoinNonce: Uint8Array,
  tokenDomain: Uint8Array,
  signerCommitments: Uint8Array[],
  threshold: bigint,
): Promise<DeployedOzMultisigV3Contract> => {
  logger.info('Deploying exact OZ ShieldedMultiSigV3 contract...');
  const contract = await deployContract(providers as any, {
    compiledContract,
    privateStateId: OzMultisigV3PrivateStateId,
    initialPrivateState: {} satisfies OzMultisigV3PrivateState,
    args: [instanceSalt, initCoinNonce, tokenDomain, signerCommitments, threshold],
  });
  logger.info(`Deployed contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as DeployedOzMultisigV3Contract;
};

export const joinContract = async (
  providers: OzMultisigV3Providers,
  contractAddress: string,
): Promise<DeployedOzMultisigV3Contract> => {
  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract,
    privateStateId: OzMultisigV3PrivateStateId,
    initialPrivateState: {} satisfies OzMultisigV3PrivateState,
  });
  logger.info(`Joined contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract as DeployedOzMultisigV3Contract;
};

export const mint = async (
  providers: OzMultisigV3Providers,
  contract: DeployedOzMultisigV3Contract,
  amount: bigint,
  recipient: MintRecipient,
  pubkeys: Uint8Array[],
  signatures: Uint8Array[],
): Promise<{ tx: FinalizedTxData; contractCoins: CompactQualifiedShieldedCoin[] }> => {
  logger.info(`Minting ${amount} through exact OZ V3 mint...`);
  const contractAddress = contract.deployTxData.public.contractAddress;
  const preZswapAndContractState = await providers.publicDataProvider.queryZSwapAndContractState(contractAddress);
  const result = await contract.callTx.mint(amount, recipient, pubkeys, signatures);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  const mintedToContract = isContractRecipient(recipient, contractAddress);
  return {
    tx: result.public,
    contractCoins: mintedToContract
      ? [
          ...compactCoinsFromLocalState(result.private.nextZswapLocalState),
          ...await compactCoinsFromMintOutput(
            providers,
            contractAddress,
            preZswapAndContractState?.[0],
            result.private.unprovenTx,
            amount,
          ),
        ]
      : [],
  };
};

export const burn = async (
  contract: DeployedOzMultisigV3Contract,
  coin: CompactQualifiedShieldedCoin,
  amount: bigint,
  pubkeys: Uint8Array[],
  signatures: Uint8Array[],
): Promise<{ tx: FinalizedTxData; remainingContractCoins: CompactQualifiedShieldedCoin[] }> => {
  logger.info(`Burning ${amount} through exact OZ V3 burn...`);
  const result = await contract.callTx.burn(coin, amount, pubkeys, signatures);
  logger.info(`Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return {
    tx: result.public,
    remainingContractCoins: compactCoinsFromLocalState(result.private.nextZswapLocalState),
  };
};

export const readSummary = async (
  providers: OzMultisigV3Providers,
  contractAddress: string,
): Promise<ContractSummary | null> => {
  assertIsContractAddress(contractAddress as ContractAddress);
  const state = await providers.publicDataProvider.queryContractState(contractAddress as ContractAddress);
  if (!state) return null;

  const value = OzMultisigV3.ledger(state.data);
  const tokenType = ledger.rawTokenType(value._tokenDomain, contractAddress);
  return {
    address: contractAddress,
    tokenName: new TextDecoder().decode(value._tokenDomain).replace(/\0+$/, ''),
    tokenDomain: value._tokenDomain,
    coinNonce: value._coinNonce,
    tokenType: bytesToHex(ledger.encodeRawTokenType(tokenType)),
    counter: value._counter,
    instanceSalt: value._instanceSalt,
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
): Promise<OzMultisigV3Providers> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<OzMultisigV3Circuits>(contractConfig.zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof OzMultisigV3PrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      privateStoragePasswordProvider: () => 'MnfOzMultisigV3-Pr1vate!',
      accountId: ctx.unshieldedKeystore.getBech32Address().asString(),
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  } as OzMultisigV3Providers;
};

export function setLogger(_logger: Logger) {
  logger = _logger;
}

const isContractRecipient = (
  recipient: MintRecipient,
  contractAddress: string,
): boolean =>
  !recipient.is_left &&
  bytesToHex(recipient.right.bytes) === bytesToHex(ledger.encodeContractAddress(contractAddress));

function compactCoinsFromLocalState(
  zswapLocalState: { coins?: Set<ledger.QualifiedShieldedCoinInfo> } | undefined,
): CompactQualifiedShieldedCoin[] {
  if (!zswapLocalState?.coins) return [];
  return Array.from(zswapLocalState.coins).map((coin) =>
    ledger.encodeQualifiedShieldedCoinInfo(coin),
  );
}

type AnyZswapOffer = ledger.ZswapOffer<any>;

type TxWithZswapOffers = {
  readonly guaranteedOffer?: AnyZswapOffer;
  readonly fallibleOffer?: Map<number, AnyZswapOffer>;
};

const compactCoinsFromMintOutput = async (
  providers: OzMultisigV3Providers,
  contractAddress: string,
  preMintZswapState: ledger.ZswapChainState | undefined,
  unprovenTx: unknown,
  amount: bigint,
): Promise<CompactQualifiedShieldedCoin[]> => {
  if (!preMintZswapState) return [];

  const indexes = mintContractOutputIndexes(preMintZswapState, contractAddress, unprovenTx);
  if (indexes.length === 0) return [];

  const summary = await readSummary(providers, contractAddress);
  if (!summary) return [];

  return indexes.map((mtIndex) => ({
    color: hexToBytes32(summary.tokenType),
    nonce: summary.coinNonce,
    value: amount,
    mt_index: mtIndex,
  }));
};

const mintContractOutputIndexes = (
  preMintZswapState: ledger.ZswapChainState,
  contractAddress: string,
  tx: unknown,
): bigint[] => {
  let chainState = preMintZswapState;
  const indexes: bigint[] = [];
  const whitelist = new Set<ledger.ContractAddress>([contractAddress]);
  const offers = zswapOffers(tx);

  try {
    for (const offer of offers) {
      const [nextState, inserted] = chainState.tryApply(offer, whitelist);
      chainState = nextState;

      for (const output of offer.outputs) {
        if (output.contractAddress !== contractAddress) continue;
        const mtIndex = inserted.get(output.commitment);
        if (mtIndex !== undefined) {
          indexes.push(mtIndex);
        }
      }
    }
  } catch (err) {
    const collapsedIndex = collapsedMerkleIndex(err);
    if (collapsedIndex !== null && contractOutputCount(offers, contractAddress) === 1) {
      return [collapsedIndex];
    }
    logger.warn(`Could not qualify contract-owned mint output: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  return indexes;
};

const zswapOffers = (tx: unknown): AnyZswapOffer[] => {
  const value = tx as TxWithZswapOffers;
  const offers: AnyZswapOffer[] = [];
  if (value.guaranteedOffer) {
    offers.push(value.guaranteedOffer);
  }
  if (value.fallibleOffer) {
    offers.push(...value.fallibleOffer.values());
  }
  return offers;
};

const contractOutputCount = (
  offers: AnyZswapOffer[],
  contractAddress: string,
): number =>
  offers.reduce(
    (count, offer) =>
      count + offer.outputs.filter((output) => output.contractAddress === contractAddress).length,
    0,
  );

const collapsedMerkleIndex = (err: unknown): bigint | null => {
  const message = err instanceof Error ? err.message : String(err);
  const match = /CollapsedIndex\(\s*(\d+)\s*,\s*\d+\s*\)/.exec(message);
  return match ? BigInt(match[1]) : null;
};

const hexToBytes32 = (hex: string): Uint8Array => {
  const normalized = hex.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('Expected a 32-byte hex string');
  }
  return new Uint8Array(Buffer.from(normalized, 'hex'));
};
