import { pino } from 'pino';

import { PreprodConfig, PreviewConfig, StandaloneConfig } from '@mnf-se/common';

import { run } from './cli.js';

const network = process.argv[2] ?? 'standalone';

let config;
switch (network) {
  case 'preprod':
    config = new PreprodConfig('multisig-token');
    break;
  case 'undeployed':
  case 'local':
  case 'standalone':
    config = new StandaloneConfig('multisig-token');
    break;
  case 'preview':
    config = new PreviewConfig('multisig-token');
    break;
  default:
    console.error(`Unknown network: ${network}`);
    process.exit(1);
}

await run(config, pino({ level: process.env.LOG_LEVEL ?? 'info' }));
