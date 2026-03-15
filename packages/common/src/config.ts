import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

export interface Config {
  readonly logDir: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export class StandaloneConfig implements Config {
  logDir: string;
  indexer = 'http://127.0.0.1:8088/api/v3/graphql';
  indexerWS = 'ws://127.0.0.1:8088/api/v3/graphql/ws';
  node = 'http://127.0.0.1:9944';
  proofServer = 'http://127.0.0.1:6300';
  constructor(appName: string) {
    this.logDir = path.resolve('logs', appName, 'standalone', `${new Date().toISOString()}.log`);
    setNetworkId('undeployed');
  }
}

export class PreviewConfig implements Config {
  logDir: string;
  indexer = 'https://indexer.preview.midnight.network/api/v3/graphql';
  indexerWS = 'wss://indexer.preview.midnight.network/api/v3/graphql/ws';
  node = 'https://rpc.preview.midnight.network';
  proofServer = 'http://127.0.0.1:6300';
  constructor(appName: string) {
    this.logDir = path.resolve('logs', appName, 'preview', `${new Date().toISOString()}.log`);
    setNetworkId('preview');
  }
}

export class PreprodConfig implements Config {
  logDir: string;
  indexer = 'https://indexer.preprod.midnight.network/api/v3/graphql';
  indexerWS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
  node = 'https://rpc.preprod.midnight.network';
  proofServer = 'http://127.0.0.1:6300';
  constructor(appName: string) {
    this.logDir = path.resolve('logs', appName, 'preprod', `${new Date().toISOString()}.log`);
    setNetworkId('preprod');
  }
}
