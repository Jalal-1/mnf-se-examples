import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';

import {
  type Config,
  type WalletContext,
  StandaloneConfig,
  buildWalletAndWaitForFunds,
  buildFreshWallet,
  getDustBalance,
  monitorDustBalance,
  withStatus,
} from '@mnf-se/common';

import type { CounterProviders, DeployedCounterContract } from './types.js';
import * as api from './api.js';

let logger: Logger;

const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const BANNER = `
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551                                                              \u2551
\u2551              Midnight Counter Example                        \u2551
\u2551              \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500                           \u2551
\u2551              MNF Solutions Engineering                       \u2551
\u2551                                                              \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`;

const DIVIDER = '\u2500'.repeat(62);

const WALLET_MENU = `
${DIVIDER}
  Wallet Setup
${DIVIDER}
  [1] Create a new wallet
  [2] Restore wallet from seed
  [3] Exit
${DIVIDER}
> `;

const contractMenu = (dustBalance: string) => `
${DIVIDER}
  Contract Actions${dustBalance ? `                    DUST: ${dustBalance}` : ''}
${DIVIDER}
  [1] Deploy a new counter contract
  [2] Join an existing counter contract
  [3] Monitor DUST balance
  [4] Exit
${DIVIDER}
> `;

const counterMenu = (dustBalance: string) => `
${DIVIDER}
  Counter Actions${dustBalance ? `                     DUST: ${dustBalance}` : ''}
${DIVIDER}
  [1] Increment counter
  [2] Display current counter value
  [3] Exit
${DIVIDER}
> `;

const buildWallet = async (config: Config, rli: Interface): Promise<WalletContext | null> => {
  if (config instanceof StandaloneConfig) {
    return await buildWalletAndWaitForFunds(config, GENESIS_MINT_WALLET_SEED);
  }

  while (true) {
    const choice = await rli.question(WALLET_MENU);
    switch (choice.trim()) {
      case '1':
        return await buildFreshWallet(config);
      case '2': {
        const seed = await rli.question('Enter your wallet seed: ');
        return await buildWalletAndWaitForFunds(config, seed);
      }
      case '3':
        return null;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

const getDustLabel = async (wallet: WalletContext['wallet']): Promise<string> => {
  try {
    const dust = await getDustBalance(wallet);
    return dust.available.toLocaleString();
  } catch {
    return '';
  }
};

const startDustMonitor = async (wallet: WalletContext['wallet'], rli: Interface): Promise<void> => {
  console.log('');
  const stopPromise = rli.question('  Press Enter to return to menu...\n').then(() => {});
  await monitorDustBalance(wallet, stopPromise);
  console.log('');
};

const deployOrJoin = async (
  providers: CounterProviders,
  walletCtx: WalletContext,
  rli: Interface,
): Promise<DeployedCounterContract | null> => {
  while (true) {
    const dustLabel = await getDustLabel(walletCtx.wallet);
    const choice = await rli.question(contractMenu(dustLabel));
    switch (choice.trim()) {
      case '1':
        try {
          const contract = await withStatus('Deploying counter contract', () =>
            api.deploy(providers, { privateCounter: 0 }),
          );
          console.log(`  Contract deployed at: ${contract.deployTxData.public.contractAddress}\n`);
          return contract;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log(`\n  \u2717 Deploy failed: ${msg}`);
          if (e instanceof Error && e.cause) {
            let cause: unknown = e.cause;
            let depth = 0;
            while (cause && depth < 5) {
              const causeMsg =
                cause instanceof Error
                  ? `${cause.message}\n      ${cause.stack?.split('\n').slice(1, 3).join('\n      ') ?? ''}`
                  : String(cause);
              console.log(`    cause: ${causeMsg}`);
              cause = cause instanceof Error ? cause.cause : undefined;
              depth++;
            }
          }
          if (msg.toLowerCase().includes('dust') || msg.toLowerCase().includes('no dust')) {
            console.log('    Insufficient DUST for transaction fees. Use option [3] to monitor your balance.');
          }
          console.log('');
        }
        break;
      case '2':
        try {
          const contractAddress = await rli.question('Enter the contract address (hex): ');
          return await api.joinContract(providers, contractAddress);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log(`  \u2717 Failed to join contract: ${msg}\n`);
        }
        break;
      case '3':
        await startDustMonitor(walletCtx.wallet, rli);
        break;
      case '4':
        return null;
      default:
        console.log(`  Invalid choice: ${choice}`);
    }
  }
};

const mainLoop = async (providers: CounterProviders, walletCtx: WalletContext, rli: Interface): Promise<void> => {
  const counterContract = await deployOrJoin(providers, walletCtx, rli);
  if (counterContract === null) return;

  while (true) {
    const dustLabel = await getDustLabel(walletCtx.wallet);
    const choice = await rli.question(counterMenu(dustLabel));
    switch (choice.trim()) {
      case '1':
        try {
          await withStatus('Incrementing counter', () => api.increment(counterContract));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log(`  \u2717 Increment failed: ${msg}\n`);
        }
        break;
      case '2':
        await api.displayCounterValue(providers, counterContract);
        break;
      case '3':
        return;
      default:
        console.log(`  Invalid choice: ${choice}`);
    }
  }
};

export const run = async (config: Config, _logger: Logger): Promise<void> => {
  logger = _logger;
  api.setLogger(_logger);

  console.log(BANNER);

  const rli = createInterface({ input, output, terminal: true });

  try {
    const walletCtx = await buildWallet(config, rli);
    if (walletCtx === null) return;

    try {
      const providers = await withStatus('Configuring providers', () => api.configureProviders(walletCtx, config));
      console.log('');
      await mainLoop(providers, walletCtx, rli);
    } catch (e) {
      if (e instanceof Error) {
        logger.error(`Error: ${e.message}`);
        logger.debug(`${e.stack}`);
      } else {
        throw e;
      }
    } finally {
      try {
        await walletCtx.wallet.stop();
      } catch (e) {
        logger.error(`Error stopping wallet: ${e}`);
      }
    }
  } finally {
    rli.close();
    rli.removeAllListeners();
    logger.info('Goodbye.');
  }
};
