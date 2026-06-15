import { pino } from 'pino';

import { PreprodConfig, PreviewConfig, StandaloneConfig } from '@mnf-se/common';

import { run } from './cli.js';

const network = process.argv[2] ?? 'standalone';

let config;
switch (network) {
  case 'preprod':
    config = new PreprodConfig('oz-multisig-v3');
    break;
  case 'preview':
    config = new PreviewConfig('oz-multisig-v3');
    break;
  case 'undeployed':
  case 'local':
  case 'standalone':
    config = new StandaloneConfig('oz-multisig-v3');
    break;
  default:
    console.error(`Unknown network: ${network}`);
    process.exit(1);
}

await run(config, pino({ level: process.env.LOG_LEVEL ?? 'info' }));
