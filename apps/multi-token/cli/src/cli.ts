import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { nativeToken } from '@midnight-ntwrk/ledger-v8';
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
  clearScreen,
} from '@mnf-se/common';

import type { MultiTokenProviders, DeployedMultiTokenContract } from './types.js';
import * as api from './api.js';

const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const WIDTH = 64;

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

// ── Display Helpers ────────────────────────────────────────────────────

type Message = { text: string; type: 'success' | 'error' | 'info' };

function renderHeader(title: string, accent: string): void {
  clearScreen();
  console.log('');
  console.log(`  ${accent}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
  console.log(`  ${accent}|${c.bold}${centerText(title, WIDTH - 2)}${c.reset}${accent}|${c.reset}`);
  console.log(`  ${accent}|${centerText('MNF Solutions Engineering', WIDTH - 2)}${accent}|${c.reset}`);
  console.log(`  ${accent}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
  console.log('');
}

function centerText(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text + ' '.repeat(Math.max(0, width - pad - text.length));
}

function renderInfo(
  contractAddress: string,
  baseURI: string,
  walletAddress: string,
  nightBalance: bigint,
  message?: Message,
): void {
  const shortAddr = contractAddress.length > 48
    ? contractAddress.substring(0, 48) + '...'
    : contractAddress;

  const shortURI = baseURI.length > 44
    ? baseURI.substring(0, 44) + '...'
    : baseURI;

  console.log(`    ${c.gray}Contract${c.reset}      ${shortAddr}`);
  console.log(`    ${c.gray}Base URI${c.reset}      ${c.white}${c.bold}${shortURI}${c.reset}`);
  console.log('');

  const shortWallet = walletAddress.length > 36
    ? walletAddress.substring(0, 36) + '...'
    : walletAddress;
  console.log(`    ${c.gray}Wallet${c.reset}        ${c.dim}${shortWallet}${c.reset}`);
  console.log(`    ${c.gray}NIGHT${c.reset}         ${c.white}${nightBalance.toString()}${c.reset}`);
  console.log('');

  if (message) {
    const msgColor = message.type === 'success' ? c.green
      : message.type === 'error' ? c.red
        : c.blue;
    const prefix = message.type === 'success' ? '+'
      : message.type === 'error' ? '!'
        : '>';
    console.log(`    ${msgColor}[${prefix}] ${message.text}${c.reset}`);
    console.log('');
  }
}

function renderMenu(): void {
  console.log(`  ${c.gray}${'─'.repeat(WIDTH)}${c.reset}`);
  console.log('');
  console.log(`    ${c.cyan}1${c.reset}  Mint tokens`);
  console.log(`    ${c.cyan}2${c.reset}  Transfer tokens`);
  console.log(`    ${c.cyan}3${c.reset}  View balance`);
  console.log(`    ${c.cyan}4${c.reset}  View URI`);
  console.log(`    ${c.cyan}5${c.reset}  Set URI (admin)`);
  console.log(`    ${c.cyan}6${c.reset}  Set operator approval`);
  console.log(`    ${c.cyan}7${c.reset}  Refresh`);
  console.log(`    ${c.cyan}8${c.reset}  Exit`);
  console.log('');
  console.log(`  ${c.gray}${'─'.repeat(WIDTH)}${c.reset}`);
  console.log('');
}

// ── Main Interaction Loop ──────────────────────────────────────────────

async function interactionLoop(
  contract: DeployedMultiTokenContract,
  providers: MultiTokenProviders,
  walletContext: WalletContext,
  contractAddress: string,
  baseURI: string,
): Promise<void> {
  let message: Message | undefined;
  const coinPubKey = ledger.encodeCoinPublicKey(walletContext.shieldedSecretKeys.coinPublicKey);

  while (true) {
    // Get wallet state
    const walletState = await Rx.firstValueFrom(walletContext.wallet.state());
    const nightBalance = walletState.unshielded?.balances[nativeToken().raw] ?? 0n;
    const walletAddress = walletContext.unshieldedKeystore.getBech32Address().toString();

    renderHeader('MULTI TOKEN (ERC1155)', c.magenta);
    renderInfo(contractAddress, baseURI, walletAddress, nightBalance, message);
    renderMenu();
    message = undefined;

    const choice = await promptChoice();

    try {
      switch (choice) {
        case '1': {
          // Mint tokens to self
          const tokenIdStr = await prompt('Token ID: ');
          const tokenId = BigInt(tokenIdStr);
          const amountStr = await prompt('Amount to mint: ');
          const amount = BigInt(amountStr);
          if (amount <= 0n) {
            message = { text: 'Amount must be positive', type: 'error' };
            break;
          }
          const selfAccount = api.leftPublicKey(coinPubKey);
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.mint(contract, selfAccount, tokenId, amount);
          message = { text: `Minted ${amount} of token #${tokenId} to self`, type: 'success' };
          break;
        }
        case '2': {
          // Transfer tokens
          const toKeyHex = await prompt('Recipient public key (hex, 64 chars): ');
          const toKeyBytes = new Uint8Array(Buffer.from(toKeyHex, 'hex'));
          if (toKeyBytes.length !== 32) {
            message = { text: 'Public key must be 32 bytes (64 hex chars)', type: 'error' };
            break;
          }
          const tokenIdStr = await prompt('Token ID: ');
          const tokenId = BigInt(tokenIdStr);
          const amountStr = await prompt('Amount to transfer: ');
          const amount = BigInt(amountStr);
          if (amount <= 0n) {
            message = { text: 'Amount must be positive', type: 'error' };
            break;
          }
          const fromAccount = api.leftPublicKey(coinPubKey);
          const toAccount = api.leftPublicKey(toKeyBytes);
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.transferFrom(contract, fromAccount, toAccount, tokenId, amount);
          message = { text: `Transferred ${amount} of token #${tokenId}`, type: 'success' };
          break;
        }
        case '3': {
          // View balance
          const tokenIdStr = await prompt('Token ID: ');
          const tokenId = BigInt(tokenIdStr);
          const selfAccount = api.leftPublicKey(coinPubKey);
          console.log(`\n    ${c.dim}Querying balance (generates ZK proof)...${c.reset}`);
          const result = await api.balanceOf(contract, selfAccount, tokenId);
          message = { text: `Token #${tokenId} balance: ${c.green}${result.balance.toString()}${c.reset}`, type: 'info' };
          break;
        }
        case '4': {
          // View URI
          const tokenIdStr = await prompt('Token ID (any value, URI is shared): ');
          const tokenId = BigInt(tokenIdStr);
          console.log(`\n    ${c.dim}Querying URI (generates ZK proof)...${c.reset}`);
          const result = await api.uri(contract, tokenId);
          baseURI = result.uri;
          message = { text: `Base URI: ${c.green}${result.uri}${c.reset}`, type: 'info' };
          break;
        }
        case '5': {
          // Set URI (admin)
          const newURI = await prompt('New base URI: ');
          if (!newURI) {
            message = { text: 'URI cannot be empty', type: 'error' };
            break;
          }
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.setURI(contract, newURI);
          baseURI = newURI;
          message = { text: `URI updated to: ${newURI}`, type: 'success' };
          break;
        }
        case '6': {
          // Set operator approval
          const operatorHex = await prompt('Operator public key (hex, 64 chars): ');
          const operatorBytes = new Uint8Array(Buffer.from(operatorHex, 'hex'));
          if (operatorBytes.length !== 32) {
            message = { text: 'Public key must be 32 bytes (64 hex chars)', type: 'error' };
            break;
          }
          const approvedStr = await prompt('Approve? (yes/no): ');
          const approved = approvedStr.toLowerCase() === 'yes' || approvedStr.toLowerCase() === 'y';
          const operatorAccount = api.leftPublicKey(operatorBytes);
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.setApprovalForAll(contract, operatorAccount, approved);
          message = { text: `Operator approval set to ${approved}`, type: 'success' };
          break;
        }
        case '7':
          message = { text: 'Refreshed', type: 'info' };
          break;
        case '8':
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

// ── Main ───────────────────────────────────────────────────────────────

export const run = async (config: Config, _logger: Logger): Promise<void> => {
  api.setLogger(_logger);

  clearScreen();
  console.log('');
  console.log(`  ${c.magenta}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
  console.log(`  ${c.magenta}|${c.bold}${centerText('MIDNIGHT MULTI TOKEN', WIDTH - 2)}${c.reset}${c.magenta}|${c.reset}`);
  console.log(`  ${c.magenta}|${centerText('MNF Solutions Engineering', WIDTH - 2)}${c.magenta}|${c.reset}`);
  console.log(`  ${c.magenta}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
  console.log('');

  const walletContext = await setupWallet(config);

  console.log(`\n  ${c.green}Wallet ready!${c.reset}`);
  console.log(`    ${c.gray}Address:${c.reset}     ${walletContext.unshieldedKeystore.getBech32Address()}`);
  const coinPubKeyHex = Buffer.from(
    ledger.encodeCoinPublicKey(walletContext.shieldedSecretKeys.coinPublicKey),
  ).toString('hex');
  console.log(`    ${c.gray}Coin PubKey:${c.reset} ${coinPubKeyHex.substring(0, 32)}...`);
  console.log('');

  const providers = await withStatus('Configuring providers', () => api.configureProviders(walletContext, config));

  // Deploy or join
  console.log('');
  console.log(`  ${c.white}Select action:${c.reset}`);
  console.log('');
  console.log(`    ${c.cyan}1${c.reset}  Deploy a new MultiToken contract`);
  console.log(`    ${c.cyan}2${c.reset}  Join an existing MultiToken contract`);
  console.log(`    ${c.cyan}3${c.reset}  Exit`);
  console.log('');

  let contract: DeployedMultiTokenContract;
  let contractAddress: string;
  let baseURI: string;

  while (true) {
    const choice = await promptChoice();
    switch (choice) {
      case '1': {
        baseURI = await prompt('Base URI (e.g. https://tokens.example.com/{id}.json): ');
        if (!baseURI) {
          console.log(`    ${c.red}URI cannot be empty${c.reset}`);
          continue;
        }

        console.log(`\n    ${c.dim}Deploying contract (generating ZK proof)...${c.reset}`);
        contract = await api.deploy(providers, baseURI);
        contractAddress = contract.deployTxData.public.contractAddress;

        console.log(`\n    ${c.green}${c.bold}Contract deployed!${c.reset}`);
        console.log(`    ${c.gray}Address:${c.reset}    ${contractAddress}`);
        console.log(`    ${c.gray}Base URI:${c.reset}   ${baseURI}`);
        console.log('');
        break;
      }
      case '2': {
        const addr = await prompt('Contract address: ');
        if (!addr) {
          console.log(`    ${c.red}Address cannot be empty${c.reset}`);
          continue;
        }
        baseURI = await prompt('Base URI (for display, or leave blank): ') || '(unknown)';

        console.log(`\n    ${c.dim}Joining contract...${c.reset}`);
        contract = await api.joinContract(providers, addr);
        contractAddress = contract.deployTxData.public.contractAddress;

        console.log(`\n    ${c.green}${c.bold}Joined contract!${c.reset}`);
        console.log(`    ${c.gray}Address:${c.reset}    ${contractAddress}`);
        console.log('');
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

  await interactionLoop(
    contract!,
    providers,
    walletContext,
    contractAddress!,
    baseURI!,
  );

  try { await walletContext.wallet.stop(); } catch {}
  rli.close();
};
