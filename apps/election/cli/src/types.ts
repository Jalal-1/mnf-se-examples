import { Election, type ElectionPrivateState } from '@mnf-se/election-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';

export type ElectionCircuits = 'vote$commit' | 'vote$reveal' | 'advance' | 'set_topic' | 'add_voter';

export const ElectionPrivateStateId = 'electionPrivateState';

export type ElectionProviders = MidnightProviders<ElectionCircuits, typeof ElectionPrivateStateId, ElectionPrivateState>;

export type ElectionContract = Election.Contract<ElectionPrivateState>;

export type DeployedElectionContract = DeployedContract<ElectionContract> | FoundContract<ElectionContract>;
