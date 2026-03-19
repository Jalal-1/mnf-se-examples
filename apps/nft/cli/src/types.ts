import { NFT, type NftPrivateState } from '@mnf-se/nft-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

export type NftCircuits = ProvableCircuitId<NFT.Contract<NftPrivateState>>;

export const NftPrivateStateId = 'nftPrivateState';

export type NftProviders = MidnightProviders<NftCircuits, typeof NftPrivateStateId, NftPrivateState>;

export type NftContract = NFT.Contract<NftPrivateState>;

export type DeployedNftContract = DeployedContract<NftContract> | FoundContract<NftContract>;
