import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import type {
  MidnightProvider,
  WalletProvider,
  PublicDataProvider,
  PrivateStateProvider,
  MidnightProviders,
} from '@midnight-ntwrk/midnight-js-types';

export interface SharedProviders {
  privateStateProvider: PrivateStateProvider<string, unknown>;
  publicDataProvider: PublicDataProvider;
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
  proofServerUrl: string;
}

/**
 * Build typed MidnightProviders for a specific contract.
 * Reuses shared wallet/indexer/private-state providers,
 * and creates contract-specific ZK config + proof providers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildContractProviders<C extends string>(
  zkBase: string,
  shared: SharedProviders,
): any {
  const zkConfigProvider = new FetchZkConfigProvider<C>(
    `${window.location.origin}/${zkBase}`,
    fetch.bind(window),
  );

  return {
    privateStateProvider: shared.privateStateProvider,
    publicDataProvider: shared.publicDataProvider,
    zkConfigProvider,
    proofProvider: httpClientProofProvider(shared.proofServerUrl, zkConfigProvider),
    walletProvider: shared.walletProvider,
    midnightProvider: shared.midnightProvider,
  };
}
