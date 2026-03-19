import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { nativeToken, encodeUserAddress } from '@midnight-ntwrk/ledger-v8';
import * as Rx from 'rxjs';
import { Buffer } from 'buffer';
import { type Logger } from 'pino';

import {
  type Config,
  type WalletContext,
  StandaloneConfig,
  buildWalletAndWaitForFunds,
  buildFreshWallet,
  withStatus,
  c,
} from '@mnf-se/common';

import { type TokenPrivateState } from '@mnf-se/token-contract';
import type { TokenProviders, DeployedTokenContract } from './types.js';
import * as api from './api.js';
import {
  renderScreen,
  clearScreen,
  type TokenDisplayState,
  type WalletDisplayState,
  type Message,
} from './display.js';

const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const rli = createInterface({ input, output });

async function prompt(text: string): Promise<string> {
  return (await rli.question(`  ${c.cyan}>${c.reset} ${text}`)).trim();
}

async function promptChoice(): Promise<string> {
  return (await rli.question(`  ${c.cyan}>${c.reset} `)).trim();
}

// ── Wallet Setup ───────────────────────────────────────────────────────

async function setupWallet(config: Config): Promise<WalletContext> {
  if (config instanceof StandaloneConfig) {
    return await buildWalletAndWaitForFunds(config, GENESIS_SEED);
  }

  console.log('');
  console.log(`  ${c.white}Wallet setup:${c.reset}`);
  console.log('');
  console.log(`    ${c.cyan}1${c.reset}  Create new wallet`);
  console.log(`    ${c.cyan}2${c.reset}  Restore from hex seed`);
  console.log('');

  while (true) {
    const choice = await promptChoice();
    switch (choice) {
      case '1':
        return await buildFreshWallet(config);
      case '2': {
        const seed = await prompt('Enter hex seed: ');
        return await buildWalletAndWaitForFunds(config, seed);
      }
      default:
        console.log(`    ${c.red}Invalid choice${c.reset}`);
    }
  }
}

// ── Fetch State ────────────────────────────────────────────────────────

async function fetchTokenState(
  providers: TokenProviders,
  contractAddress: string,
): Promise<TokenDisplayState> {
  try {
    return await api.getTokenState(providers, contractAddress);
  } catch {
    return null;
  }
}

async function getWalletDisplayState(
  walletContext: WalletContext,
  tokenColor?: string,
): Promise<WalletDisplayState> {
  const walletState = await Rx.firstValueFrom(walletContext.wallet.state());
  const unshieldedBalance = walletState.unshielded?.balances[nativeToken().raw] ?? 0n;
  const shieldedNightBalance = walletState.shielded?.balances[nativeToken().raw] ?? 0n;
  const tokenBalance = tokenColor ? (walletState.shielded?.balances[tokenColor] ?? 0n) : 0n;

  return {
    address: walletContext.unshieldedKeystore.getBech32Address().toString(),
    zswapPublicKey: String(walletContext.shieldedSecretKeys.coinPublicKey),
    unshieldedBalance,
    shieldedNightBalance,
    tokenBalance,
    tokenColor: tokenColor ?? '',
  };
}

// ── Authority Loop ────────────────────────────────────────────────────

async function authorityLoop(
  contract: DeployedTokenContract,
  providers: TokenProviders,
  walletContext: WalletContext,
  contractAddress: string,
): Promise<void> {
  let message: Message | undefined;
  const zswapPubKey = ledger.encodeCoinPublicKey(walletContext.shieldedSecretKeys.coinPublicKey);

  while (true) {
    const state = await fetchTokenState(providers, contractAddress);
    const walletDisplay = await getWalletDisplayState(walletContext);
    renderScreen({ role: 'authority', state, contractAddress, wallet: walletDisplay, message });
    message = undefined;

    const choice = await promptChoice();

    try {
      switch (choice) {
        case '1': {
          const amountStr = await prompt('Amount to mint (max 65535): ');
          const amount = parseInt(amountStr, 10);
          if (isNaN(amount) || amount <= 0 || amount > 65535) {
            message = { text: 'Amount must be between 1 and 65535', type: 'error' };
            break;
          }
          const recipientChoice = await prompt('Mint to (1=self, 2=other): ');
          let recipientKey: Uint8Array;
          if (recipientChoice === '2') {
            const keyHex = await prompt('Recipient Zswap public key (hex): ');
            recipientKey = new Uint8Array(Buffer.from(keyHex, 'hex'));
            if (recipientKey.length !== 32) {
              message = { text: 'Zswap public key must be 32 bytes (64 hex chars)', type: 'error' };
              break;
            }
          } else {
            recipientKey = zswapPubKey;
          }
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.mintTokens(contract, amount, recipientKey);
          message = { text: `Minted ${amount} tokens successfully`, type: 'success' };
          break;
        }
        case '2': {
          // Mint unshielded tokens
          const uAmountStr = await prompt('Amount to mint (max 65535): ');
          const uAmount = parseInt(uAmountStr, 10);
          if (isNaN(uAmount) || uAmount <= 0 || uAmount > 65535) {
            message = { text: 'Amount must be between 1 and 65535', type: 'error' };
            break;
          }
          const uRecipientChoice = await prompt('Mint to (1=self, 2=other): ');
          let recipientAddr: Uint8Array;
          if (uRecipientChoice === '2') {
            const addrHex = await prompt('Recipient address (32-byte hex): ');
            recipientAddr = new Uint8Array(Buffer.from(addrHex, 'hex'));
            if (recipientAddr.length !== 32) {
              message = { text: 'Address must be 32 bytes (64 hex chars)', type: 'error' };
              break;
            }
          } else {
            // Use own unshielded address as recipient (UserAddress = 32-byte hash of public key)
            recipientAddr = encodeUserAddress(walletContext.unshieldedKeystore.getAddress());
          }
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.mintUnshieldedTokens(contract, uAmount, recipientAddr);
          message = { text: `Minted ${uAmount} unshielded tokens successfully`, type: 'success' };
          break;
        }
        case '3': {
          const state2 = await fetchTokenState(providers, contractAddress);
          message = { text: `Total supply: ${state2?.totalSupply ?? 'unknown'}`, type: 'info' };
          break;
        }
        case '4': {
          const balances = await api.getAllShieldedBalances(walletContext.wallet);
          const entries = Object.entries(balances).filter(([, v]) => v > 0n);
          if (entries.length === 0) {
            message = { text: 'No shielded token balances', type: 'info' };
          } else {
            const balanceStr = entries.map(([color, val]) => `${color.substring(0, 16)}...: ${val}`).join(', ');
            message = { text: `Shielded: ${balanceStr}`, type: 'info' };
          }
          break;
        }
        case '5':
          message = { text: 'Refreshed', type: 'info' };
          break;
        case '6':
          clearScreen();
          console.log(`\n  ${c.dim}Session ended.${c.reset}\n`);
          return;
        default:
          message = { text: `Unknown option: ${choice}`, type: 'error' };
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const assertMatch = raw.match(/failed assert:\s*(.+)/);
      message = { text: assertMatch ? assertMatch[1] : raw, type: 'error' };
    }
  }
}

// ── User Loop ──────────────────────────────────────────────────────────

async function userLoop(
  contract: DeployedTokenContract,
  providers: TokenProviders,
  walletContext: WalletContext,
  contractAddress: string,
): Promise<void> {
  let message: Message | undefined;

  while (true) {
    const state = await fetchTokenState(providers, contractAddress);
    const walletDisplay = await getWalletDisplayState(walletContext);
    renderScreen({ role: 'user', state, contractAddress, wallet: walletDisplay, message });
    message = undefined;

    const choice = await promptChoice();

    try {
      switch (choice) {
        case '1': {
          const balances = await api.getAllShieldedBalances(walletContext.wallet);
          const entries = Object.entries(balances).filter(([, v]) => v > 0n);
          if (entries.length === 0) {
            message = { text: 'No shielded token balances', type: 'info' };
          } else {
            const balanceStr = entries.map(([color, val]) => `${color.substring(0, 16)}...: ${val}`).join(', ');
            message = { text: `Shielded: ${balanceStr}`, type: 'info' };
          }
          break;
        }
        case '2': {
          const balances = await api.getAllShieldedBalances(walletContext.wallet);
          const entries = Object.entries(balances).filter(([, v]) => v > 0n);
          if (entries.length === 0) {
            message = { text: 'No shielded balances', type: 'info' };
          } else {
            const lines = entries.map(([color, val]) => `  ${color.substring(0, 32)}...: ${val}`);
            message = { text: `All shielded:\n${lines.join('\n')}`, type: 'info' };
          }
          break;
        }
        case '3':
          message = { text: 'Refreshed', type: 'info' };
          break;
        case '4':
          clearScreen();
          console.log(`\n  ${c.dim}Session ended.${c.reset}\n`);
          return;
        default:
          message = { text: `Unknown option: ${choice}`, type: 'error' };
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      message = { text: raw, type: 'error' };
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

export const run = async (config: Config, _logger: Logger): Promise<void> => {
  api.setLogger(_logger);

  clearScreen();
  console.log('');
  console.log(`  ${c.cyan}+${'='.repeat(62)}+${c.reset}`);
  console.log(`  ${c.cyan}|${c.bold}${' '.repeat(14)}MIDNIGHT SHIELDED TOKEN${' '.repeat(25)}${c.reset}${c.cyan}|${c.reset}`);
  console.log(`  ${c.cyan}|${' '.repeat(14)}MNF Solutions Engineering${' '.repeat(23)}${c.cyan}|${c.reset}`);
  console.log(`  ${c.cyan}+${'='.repeat(62)}+${c.reset}`);
  console.log('');

  const walletContext = await setupWallet(config);

  console.log(`\n  ${c.green}Wallet ready!${c.reset}`);
  console.log(`    ${c.gray}Address:${c.reset}     ${walletContext.unshieldedKeystore.getBech32Address()}`);
  console.log('');

  const providers = await withStatus('Configuring providers', () => api.configureProviders(walletContext, config));

  // Deploy or join
  console.log('');
  console.log(`  ${c.white}Select action:${c.reset}`);
  console.log('');
  console.log(`    ${c.cyan}1${c.reset}  Deploy a new Token contract`);
  console.log(`    ${c.cyan}2${c.reset}  Join an existing Token contract`);
  console.log(`    ${c.cyan}3${c.reset}  Exit`);
  console.log('');

  let contract: DeployedTokenContract;
  let contractAddress: string;
  let role: 'authority' | 'user';

  while (true) {
    const choice = await promptChoice();
    switch (choice) {
      case '1': {
        const tokenName = await prompt('Token name (max 32 chars): ');
        if (!tokenName) {
          console.log(`    ${c.red}Token name cannot be empty${c.reset}`);
          continue;
        }
        const ownerSecretKey = api.randomBytes(32);
        const privateState: TokenPrivateState = { secretKey: ownerSecretKey };
        console.log(`\n    ${c.dim}Deploying contract (generating ZK proof)...${c.reset}`);
        contract = await api.deploy(providers, privateState, tokenName);
        contractAddress = contract.deployTxData.public.contractAddress;
        role = 'authority';

        console.log(`\n    ${c.green}${c.bold}Contract deployed!${c.reset}`);
        console.log(`    ${c.gray}Address:${c.reset}    ${contractAddress}`);
        console.log(`    ${c.gray}Owner key:${c.reset}  ${Buffer.from(ownerSecretKey).toString('hex')}`);
        console.log(`\n    ${c.yellow}${c.bold}Save the owner secret key to manage this contract later.${c.reset}\n`);
        break;
      }
      case '2': {
        const addr = await prompt('Contract address: ');
        if (!addr) {
          console.log(`    ${c.red}Address cannot be empty${c.reset}`);
          continue;
        }
        const skChoice = await prompt('Are you the owner? (y/n): ');
        let secretKey: Uint8Array;
        if (skChoice.toLowerCase() === 'y') {
          const skHex = await prompt('Owner secret key (hex): ');
          secretKey = new Uint8Array(Buffer.from(skHex, 'hex'));
          if (secretKey.length !== 32) {
            console.log(`    ${c.red}Secret key must be 32 bytes (64 hex chars)${c.reset}`);
            continue;
          }
          role = 'authority';
        } else {
          secretKey = api.randomBytes(32);
          role = 'user';
        }
        const privateState: TokenPrivateState = { secretKey };
        console.log(`\n    ${c.dim}Joining contract...${c.reset}`);
        contract = await api.joinContract(providers, addr, privateState);
        contractAddress = contract.deployTxData.public.contractAddress;
        break;
      }
      case '3':
        clearScreen();
        console.log(`\n  ${c.dim}Goodbye.${c.reset}\n`);
        try { await walletContext.wallet.stop(); } catch {}
        rli.close();
        return;
      default:
        console.log(`    ${c.red}Invalid choice${c.reset}`);
        continue;
    }
    break;
  }

  if (role! === 'authority') {
    await authorityLoop(contract!, providers, walletContext, contractAddress!);
  } else {
    await userLoop(contract!, providers, walletContext, contractAddress!);
  }

  try { await walletContext.wallet.stop(); } catch {}
  rli.close();
};
