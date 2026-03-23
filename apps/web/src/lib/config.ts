import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

export interface NetworkConfig {
  readonly name: string;
  readonly networkId: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

// In dev, Vite proxies /prove, /check, /version → proof-server:6300
// and /api/v3/* → indexer:8088 to avoid CORS issues.
const DEV_ORIGIN = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';

export const NETWORKS: Record<string, NetworkConfig> = {
  standalone: {
    name: 'Standalone',
    networkId: 'undeployed',
    indexer: `${DEV_ORIGIN}/api/v3/graphql`,
    indexerWS: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
    node: 'ws://127.0.0.1:9944',
    proofServer: DEV_ORIGIN,
  },
  preview: {
    name: 'Preview',
    networkId: 'preview',
    indexer: 'https://indexer.preview.midnight.network/api/v3/graphql',
    indexerWS: 'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
    node: 'https://rpc.preview.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
  },
  preprod: {
    name: 'Preprod',
    networkId: 'preprod',
    indexer: 'https://indexer.preprod.midnight.network/api/v3/graphql',
    indexerWS: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
    node: 'https://rpc.preprod.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
  },
};

export function applyNetworkId(networkId: string): void {
  setNetworkId(networkId as Parameters<typeof setNetworkId>[0]);
}
