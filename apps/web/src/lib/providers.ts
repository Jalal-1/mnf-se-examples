import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import type { WalletContext } from '@mnf-se/common/types';
import { createWalletAndMidnightProvider } from '@mnf-se/common/providers';
import { createWalletProviderFromConnectedAPI, type ShieldedAddresses } from './walletAdapter.js';
import type { NetworkConfig } from './config.js';
import type { CounterCircuits, CounterProviders } from './counter-api.js';

const COUNTER_ZK_BASE = './contract/counter';
const PRIVATE_STATE_STORE = 'mnf-web-private-state';
const PRIVATE_STATE_PASSWORD = 'MnfWebApp-Pr1vate!State2026';

function makeZkConfigProvider() {
  return new FetchZkConfigProvider<CounterCircuits>(
    `${window.location.origin}/${COUNTER_ZK_BASE}`,
    fetch.bind(window),
  );
}

export async function buildCounterProvidersFromLace(
  api: ConnectedAPI,
  shieldedAddresses: ShieldedAddresses,
  config: NetworkConfig,
): Promise<CounterProviders> {
  const walletAndMidnight = createWalletProviderFromConnectedAPI(api, shieldedAddresses);
  const zkConfigProvider = makeZkConfigProvider();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: PRIVATE_STATE_STORE,
      privateStoragePasswordProvider: () => PRIVATE_STATE_PASSWORD,
      accountId: 'lace',
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnight,
    midnightProvider: walletAndMidnight,
  };
}

export async function buildCounterProvidersFromSeed(
  walletCtx: WalletContext,
  config: NetworkConfig,
): Promise<CounterProviders> {
  const walletAndMidnight = await createWalletAndMidnightProvider(walletCtx);
  const zkConfigProvider = makeZkConfigProvider();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: PRIVATE_STATE_STORE,
      privateStoragePasswordProvider: () => PRIVATE_STATE_PASSWORD,
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnight,
    midnightProvider: walletAndMidnight,
  };
}
