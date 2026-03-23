import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { nativeToken } from '@midnight-ntwrk/ledger-v8';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deriveKeysFromSeed } from '@mnf-se/common/wallet';
import { waitForSync, waitForFunds } from '@mnf-se/common/rx-helpers';
import type { WalletContext as WalletCtx } from '@mnf-se/common/types';
import { Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import * as Rx from 'rxjs';
import type { NetworkConfig } from '../lib/config.js';
import { applyNetworkId } from '../lib/config.js';
import { buildCounterProvidersFromLace, buildCounterProvidersFromSeed } from '../lib/providers.js';
import type { CounterProviders } from '../lib/counter-api.js';
import type { SharedProviders } from '../lib/build-providers.js';
import type { InitialWalletAPI } from '../hooks/useWalletDetection.js';
import type { ShieldedAddresses } from '../lib/walletAdapter.js';

interface WalletState {
  mode: 'disconnected' | 'lace' | 'seed';
  network: NetworkConfig | null;
  providers: CounterProviders | null;
  shared: SharedProviders | null;
  walletAddress: string;
  nightBalance: bigint;
  dustBalance: bigint;
  isConnecting: boolean;
  statusMessage: string;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connectLace: (api: InitialWalletAPI, network: NetworkConfig) => Promise<void>;
  connectSeed: (seed: string, network: NetworkConfig) => Promise<void>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}

const initialState: WalletState = {
  mode: 'disconnected',
  network: null,
  providers: null,
  shared: null,
  walletAddress: '',
  nightBalance: 0n,
  dustBalance: 0n,
  isConnecting: false,
  statusMessage: '',
  error: null,
};

// Store refs outside React for cleanup
let currentWalletFacade: WalletFacade | null = null;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>(initialState);

  const setStatus = (statusMessage: string) =>
    setState((s) => ({ ...s, statusMessage }));

  const connectLace = useCallback(async (api: InitialWalletAPI, network: NetworkConfig) => {
    setState((s) => ({ ...s, isConnecting: true, error: null, statusMessage: 'Connecting to wallet...' }));
    try {
      applyNetworkId(network.networkId);
      const connectedAPI = (await api.connect(network.networkId)) as ConnectedAPI;

      setStatus('Fetching wallet addresses...');
      const shieldedAddrs = await connectedAPI.getShieldedAddresses();
      const { unshieldedAddress } = await connectedAPI.getUnshieldedAddress();
      const shieldedAddresses: ShieldedAddresses = {
        shieldedCoinPublicKey: shieldedAddrs.shieldedCoinPublicKey as ledger.CoinPublicKey,
        shieldedEncryptionPublicKey: shieldedAddrs.shieldedEncryptionPublicKey as ledger.EncPublicKey,
      };

      setStatus('Building providers...');
      const providers = await buildCounterProvidersFromLace(connectedAPI, shieldedAddresses, network);
      const shared: SharedProviders = {
        privateStateProvider: providers.privateStateProvider,
        publicDataProvider: providers.publicDataProvider,
        walletProvider: providers.walletProvider,
        midnightProvider: providers.midnightProvider,
        proofServerUrl: network.proofServer,
      };

      setState({
        mode: 'lace',
        network,
        providers,
        shared,
        walletAddress: unshieldedAddress,
        nightBalance: 0n,
        dustBalance: 0n,
        isConnecting: false,
        statusMessage: '',
        error: null,
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        isConnecting: false,
        statusMessage: '',
        error: `Lace connection failed: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  }, []);

  const connectSeed = useCallback(async (seed: string, network: NetworkConfig) => {
    setState((s) => ({ ...s, isConnecting: true, error: null, statusMessage: 'Deriving keys...' }));
    try {
      applyNetworkId(network.networkId);

      const keys = deriveKeysFromSeed(seed);
      const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
      const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
      const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

      setStatus('Building wallet...');
      const networkId = getNetworkId();
      const shieldedConfig = {
        networkId,
        indexerClientConnection: { indexerHttpUrl: network.indexer, indexerWsUrl: network.indexerWS },
        provingServerUrl: new URL(network.proofServer),
        relayURL: new URL(network.node.replace(/^http/, 'ws')),
      };
      const unshieldedConfig = {
        networkId,
        indexerClientConnection: { indexerHttpUrl: network.indexer, indexerWsUrl: network.indexerWS },
        txHistoryStorage: new InMemoryTransactionHistoryStorage(),
      };
      const dustConfig = {
        networkId,
        costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
        indexerClientConnection: { indexerHttpUrl: network.indexer, indexerWsUrl: network.indexerWS },
        provingServerUrl: new URL(network.proofServer),
        relayURL: new URL(network.node.replace(/^http/, 'ws')),
      };

      const wallet = await WalletFacade.init({
        configuration: { ...shieldedConfig, ...unshieldedConfig, ...dustConfig },
        shielded: () => ShieldedWallet(shieldedConfig).startWithSecretKeys(shieldedSecretKeys),
        unshielded: () => UnshieldedWallet(unshieldedConfig).startWithPublicKey(
          PublicKey.fromKeyStore(unshieldedKeystore),
        ),
        dust: () => DustWallet(dustConfig).startWithSecretKey(
          dustSecretKey,
          ledger.LedgerParameters.initialParameters().dust,
        ),
      });
      await wallet.start(shieldedSecretKeys, dustSecretKey);
      currentWalletFacade = wallet;

      setStatus('Syncing with network...');
      await waitForSync(wallet);

      setStatus('Checking balance...');
      const walletState = await Rx.firstValueFrom(wallet.state());
      const nightBal = walletState.unshielded?.balances[nativeToken().raw] ?? 0n;

      if (nightBal === 0n && network.networkId === 'undeployed') {
        setStatus('Waiting for incoming tokens...');
        await waitForFunds(wallet);
      }

      setStatus('Building providers...');
      const walletCtx: WalletCtx = { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
      const providers = await buildCounterProvidersFromSeed(walletCtx, network);
      const shared: SharedProviders = {
        privateStateProvider: providers.privateStateProvider,
        publicDataProvider: providers.publicDataProvider,
        walletProvider: providers.walletProvider,
        midnightProvider: providers.midnightProvider,
        proofServerUrl: network.proofServer,
      };

      const finalState = await Rx.firstValueFrom(wallet.state());
      const finalNight = finalState.unshielded?.balances[nativeToken().raw] ?? 0n;

      setState({
        mode: 'seed',
        network,
        providers,
        shared,
        walletAddress: unshieldedKeystore.getBech32Address().toString(),
        nightBalance: finalNight,
        dustBalance: 0n,
        isConnecting: false,
        statusMessage: '',
        error: null,
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        isConnecting: false,
        statusMessage: '',
        error: `Seed connection failed: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    currentWalletFacade = null;
    setState(initialState);
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!currentWalletFacade) return;
    try {
      const walletState = await Rx.firstValueFrom(currentWalletFacade.state());
      const night = walletState.unshielded?.balances[nativeToken().raw] ?? 0n;
      setState((s) => ({ ...s, nightBalance: night }));
    } catch {
      // ignore balance refresh errors
    }
  }, []);

  const value: WalletContextValue = {
    ...state,
    connectLace,
    connectSeed,
    disconnect,
    refreshBalances,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
