import { createLogger, PreviewConfig, PreprodConfig, StandaloneConfig } from '@mnf-se/common';
import { run } from './cli.js';

const networkArg = process.argv.find((_, i, arr) => arr[i - 1] === '--network') ?? 'preview';

let config;
switch (networkArg) {
  case 'preprod':
    config = new PreprodConfig('counter');
    break;
  case 'standalone':
    config = new StandaloneConfig('counter');
    break;
  case 'preview':
  default:
    config = new PreviewConfig('counter');
    break;
}

const logger = await createLogger(config.logDir);
await run(config, logger);
