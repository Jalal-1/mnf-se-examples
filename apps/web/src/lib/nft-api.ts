import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { NFT, type NftPrivateState } from '@mnf-se/nft-contract';
import type { MidnightProviders, FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

// ── Types ──────────────────────────────────────────────────────────────────

export type NftCircuits = ProvableCircuitId<NFT.Contract<NftPrivateState>>;

export const NftPrivateStateId = 'nftPrivateState';

export type NftProviders = MidnightProviders<
  NftCircuits,
  typeof NftPrivateStateId,
  NftPrivateState
>;

export type DeployedNftContract =
  | DeployedContract<NFT.Contract<NftPrivateState>>
  | FoundContract<NFT.Contract<NftPrivateState>>;

// ── Either helper ──────────────────────────────────────────────────────────

export type EitherAddress = {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
};

/** Wrap a ZswapCoinPublicKey as left(key) */
export function zswapKeyToEither(keyBytes: Uint8Array): EitherAddress {
  return {
    is_left: true,
    left: { bytes: keyBytes },
    right: { bytes: new Uint8Array(32) },
  };
}

/** Wrap a ContractAddress as right(addr) */
export function contractAddrToEither(addrBytes: Uint8Array): EitherAddress {
  return {
    is_left: false,
    left: { bytes: new Uint8Array(32) },
    right: { bytes: addrBytes },
  };
}

/** Format an EitherAddress to a hex string for display */
export function eitherToHex(either: EitherAddress): string {
  const bytes = either.is_left ? either.left.bytes : either.right.bytes;
  const prefix = either.is_left ? 'zswap:' : 'contract:';
  return prefix + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Compiled contract (browser — ZK assets served via HTTP) ────────────────

const NFT_ZK_PATH = './contract/nft';

const nftCompiledContract = CompiledContract.make('nft', NFT.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(NFT_ZK_PATH),
);

// ── Deploy / Join ──────────────────────────────────────────────────────────

export async function deploy(
  providers: NftProviders,
  name: string,
  symbol: string,
): Promise<DeployedNftContract> {
  return await deployContract(providers as any, {
    compiledContract: nftCompiledContract,
    privateStateId: NftPrivateStateId,
    initialPrivateState: {} as NftPrivateState,
    args: [name, symbol],
  });
}

export async function joinContract(
  providers: NftProviders,
  contractAddress: string,
): Promise<DeployedNftContract> {
  return await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: nftCompiledContract,
    privateStateId: NftPrivateStateId,
    initialPrivateState: {} as NftPrivateState,
  });
}

// ── NFT Circuit Calls ──────────────────────────────────────────────────────

export async function mint(
  contract: DeployedNftContract,
  to: EitherAddress,
  tokenId: bigint,
): Promise<FinalizedTxData> {
  const result = await contract.callTx.mint(to, tokenId);
  return result.public;
}

export async function transferFrom(
  contract: DeployedNftContract,
  from: EitherAddress,
  to: EitherAddress,
  tokenId: bigint,
): Promise<FinalizedTxData> {
  const result = await contract.callTx.transferFrom(from, to, tokenId);
  return result.public;
}

export async function burn(
  contract: DeployedNftContract,
  tokenId: bigint,
): Promise<FinalizedTxData> {
  const result = await contract.callTx.burn(tokenId);
  return result.public;
}

export async function setTokenURI(
  contract: DeployedNftContract,
  tokenId: bigint,
  uri: string,
): Promise<FinalizedTxData> {
  const result = await contract.callTx.setTokenURI(tokenId, uri);
  return result.public;
}

// ── Read Circuit Calls ─────────────────────────────────────────────────────

export async function ownerOf(
  contract: DeployedNftContract,
  tokenId: bigint,
): Promise<{ txData: FinalizedTxData; owner: EitherAddress }> {
  const result = await contract.callTx.ownerOf(tokenId);
  return { txData: result.public, owner: result.private.result as unknown as EitherAddress };
}

export async function balanceOf(
  contract: DeployedNftContract,
  account: EitherAddress,
): Promise<{ txData: FinalizedTxData; balance: bigint }> {
  const result = await contract.callTx.balanceOf(account);
  return { txData: result.public, balance: result.private.result as unknown as bigint };
}

export async function getTokenUri(
  contract: DeployedNftContract,
  tokenId: bigint,
): Promise<{ txData: FinalizedTxData; uri: string }> {
  const result = await contract.callTx.tokenURI(tokenId);
  return { txData: result.public, uri: result.private.result as unknown as string };
}

export async function getName(
  contract: DeployedNftContract,
): Promise<{ txData: FinalizedTxData; name: string }> {
  const result = await contract.callTx.name();
  return { txData: result.public, name: result.private.result as unknown as string };
}

export async function getSymbol(
  contract: DeployedNftContract,
): Promise<{ txData: FinalizedTxData; symbol: string }> {
  const result = await contract.callTx.symbol();
  return { txData: result.public, symbol: result.private.result as unknown as string };
}
