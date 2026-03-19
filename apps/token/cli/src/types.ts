import { Token, type TokenPrivateState } from '@mnf-se/token-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';

export type TokenCircuits = 'mint' | 'mint_unshielded' | 'burn' | 'get_color';

export const TokenPrivateStateId = 'tokenPrivateState';

export type TokenProviders = MidnightProviders<TokenCircuits, typeof TokenPrivateStateId, TokenPrivateState>;

export type TokenContract = Token.Contract<TokenPrivateState>;

export type DeployedTokenContract = DeployedContract<TokenContract> | FoundContract<TokenContract>;
