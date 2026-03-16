import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { nativeToken } from '@midnight-ntwrk/ledger-v7';
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

import type { NftProviders, DeployedNftContract } from './types.js';
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

function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

type Message = { text: string; type: 'success' | 'error' | 'info' };

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

// ── Display ────────────────────────────────────────────────────────────

function renderHeader(contractAddress: string, collectionName: string, collectionSymbol: string): void {
  clearScreen();
  const accent = c.cyan;
  const lines: string[] = [];

  lines.push('');
  lines.push(`  ${accent}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
  lines.push(`  ${accent}|${c.bold}${center('MIDNIGHT NFT COLLECTION', WIDTH - 2)}${c.reset}${accent}|${c.reset}`);
  lines.push(`  ${accent}|${c.reset}${center('MNF Solutions Engineering', WIDTH - 2)}${accent}|${c.reset}`);
  lines.push(`  ${accent}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
  lines.push('');

  const shortAddr = contractAddress.length > 48
    ? contractAddress.substring(0, 48) + '...'
    : contractAddress;
  lines.push(`    ${c.gray}Contract${c.reset}      ${shortAddr}`);
  lines.push(`    ${c.gray}Collection${c.reset}    ${c.white}${c.bold}${collectionName}${c.reset} (${collectionSymbol})`);
  lines.push('');

  process.stdout.write(lines.join('\n'));
}

function renderMenu(message?: Message): void {
  const accent = c.cyan;
  const lines: string[] = [];

  if (message) {
    const msgColor = message.type === 'success' ? c.green
      : message.type === 'error' ? c.red
        : c.blue;
    const prefix = message.type === 'success' ? '+'
      : message.type === 'error' ? '!'
        : '>';
    lines.push(`    ${msgColor}[${prefix}] ${message.text}${c.reset}`);
    lines.push('');
  }

  lines.push(`  ${c.gray}${'─'.repeat(WIDTH)}${c.reset}`);
  lines.push('');
  lines.push(`    ${accent}1${c.reset}  Mint NFT`);
  lines.push(`    ${accent}2${c.reset}  Transfer NFT`);
  lines.push(`    ${accent}3${c.reset}  View NFT owner`);
  lines.push(`    ${accent}4${c.reset}  View my balance`);
  lines.push(`    ${accent}5${c.reset}  Set token URI`);
  lines.push(`    ${accent}6${c.reset}  Burn NFT`);
  lines.push(`    ${accent}7${c.reset}  Refresh`);
  lines.push(`    ${accent}8${c.reset}  Exit`);
  lines.push('');
  lines.push(`  ${c.gray}${'─'.repeat(WIDTH)}${c.reset}`);
  lines.push('');

  process.stdout.write(lines.join('\n'));
}

function center(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text + ' '.repeat(Math.max(0, width - pad - text.length));
}

// ── Main Loop ──────────────────────────────────────────────────────────

async function mainLoop(
  contract: DeployedNftContract,
  providers: NftProviders,
  walletContext: WalletContext,
  contractAddress: string,
  collectionName: string,
  collectionSymbol: string,
): Promise<void> {
  let message: Message | undefined;
  const zswapPubKey = ledger.encodeCoinPublicKey(walletContext.shieldedSecretKeys.coinPublicKey);

  while (true) {
    renderHeader(contractAddress, collectionName, collectionSymbol);
    renderMenu(message);
    message = undefined;

    const choice = await promptChoice();

    try {
      switch (choice) {
        case '1': {
          // Mint NFT
          const tokenIdStr = await prompt('Token ID (number): ');
          const tokenId = BigInt(tokenIdStr);
          if (tokenId < 0n) {
            message = { text: 'Token ID must be non-negative', type: 'error' };
            break;
          }
          const recipientChoice = await prompt('Mint to (1=self, 2=other zswap key): ');
          let to: api.EitherAddress;
          if (recipientChoice === '2') {
            const keyHex = await prompt('Recipient Zswap public key (hex, 64 chars): ');
            const keyBytes = new Uint8Array(Buffer.from(keyHex, 'hex'));
            if (keyBytes.length !== 32) {
              message = { text: 'Zswap public key must be 32 bytes (64 hex chars)', type: 'error' };
              break;
            }
            to = api.zswapKeyToEither(keyBytes);
          } else {
            to = api.zswapKeyToEither(zswapPubKey);
          }
          const uriChoice = await prompt('Set URI now? (y/n): ');
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.mintNft(contract, to, tokenId);
          message = { text: `Minted NFT #${tokenId} successfully`, type: 'success' };
          if (uriChoice.toLowerCase() === 'y') {
            const uri = await prompt('Token URI: ');
            if (uri) {
              console.log(`\n    ${c.dim}Setting token URI...${c.reset}`);
              await api.setTokenUri(contract, tokenId, uri);
              message = { text: `Minted NFT #${tokenId} and set URI`, type: 'success' };
            }
          }
          break;
        }
        case '2': {
          // Transfer NFT
          const tokenIdStr = await prompt('Token ID to transfer: ');
          const tokenId = BigInt(tokenIdStr);
          const fromChoice = await prompt('Transfer from (1=self, 2=other): ');
          let from: api.EitherAddress;
          if (fromChoice === '2') {
            const fromHex = await prompt('From Zswap public key (hex, 64 chars): ');
            const fromBytes = new Uint8Array(Buffer.from(fromHex, 'hex'));
            if (fromBytes.length !== 32) {
              message = { text: 'Zswap public key must be 32 bytes (64 hex chars)', type: 'error' };
              break;
            }
            from = api.zswapKeyToEither(fromBytes);
          } else {
            from = api.zswapKeyToEither(zswapPubKey);
          }
          const toHex = await prompt('Recipient Zswap public key (hex, 64 chars): ');
          const toBytes = new Uint8Array(Buffer.from(toHex, 'hex'));
          if (toBytes.length !== 32) {
            message = { text: 'Zswap public key must be 32 bytes (64 hex chars)', type: 'error' };
            break;
          }
          const to = api.zswapKeyToEither(toBytes);
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.transferFromNft(contract, from, to, tokenId);
          message = { text: `Transferred NFT #${tokenId} successfully`, type: 'success' };
          break;
        }
        case '3': {
          // View NFT owner
          const tokenIdStr = await prompt('Token ID to look up: ');
          const tokenId = BigInt(tokenIdStr);
          console.log(`\n    ${c.dim}Querying on-chain state...${c.reset}`);
          const { owner } = await api.ownerOf(contract, tokenId);
          const ownerStr = api.eitherToHex(owner);
          message = { text: `NFT #${tokenId} owner: ${ownerStr}`, type: 'info' };
          break;
        }
        case '4': {
          // View my balance
          const myAddr = api.zswapKeyToEither(zswapPubKey);
          console.log(`\n    ${c.dim}Querying on-chain state...${c.reset}`);
          const { balance } = await api.balanceOf(contract, myAddr);
          message = { text: `Your NFT balance: ${balance}`, type: 'info' };
          break;
        }
        case '5': {
          // Set token URI
          const tokenIdStr = await prompt('Token ID: ');
          const tokenId = BigInt(tokenIdStr);
          const uri = await prompt('New URI: ');
          if (!uri) {
            message = { text: 'URI cannot be empty', type: 'error' };
            break;
          }
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.setTokenUri(contract, tokenId, uri);
          message = { text: `Set URI for NFT #${tokenId}`, type: 'success' };
          break;
        }
        case '6': {
          // Burn NFT
          const tokenIdStr = await prompt('Token ID to burn: ');
          const tokenId = BigInt(tokenIdStr);
          const confirm = await prompt(`Burn NFT #${tokenId}? (yes/no): `);
          if (confirm.toLowerCase() !== 'yes') {
            message = { text: 'Burn cancelled', type: 'info' };
            break;
          }
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.burnNft(contract, tokenId);
          message = { text: `Burned NFT #${tokenId}`, type: 'success' };
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
  console.log(`  ${c.cyan}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
  console.log(`  ${c.cyan}|${c.bold}${center('MIDNIGHT NFT COLLECTION', WIDTH - 2)}${c.reset}${c.cyan}|${c.reset}`);
  console.log(`  ${c.cyan}|${center('MNF Solutions Engineering', WIDTH - 2)}${c.cyan}|${c.reset}`);
  console.log(`  ${c.cyan}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
  console.log('');

  const walletContext = await setupWallet(config);

  console.log(`\n  ${c.green}Wallet ready!${c.reset}`);
  console.log(`    ${c.gray}Address:${c.reset}     ${walletContext.unshieldedKeystore.getBech32Address()}`);
  const zswapPubKey = ledger.encodeCoinPublicKey(walletContext.shieldedSecretKeys.coinPublicKey);
  console.log(`    ${c.gray}Zswap key:${c.reset}   ${Buffer.from(zswapPubKey).toString('hex').substring(0, 32)}...`);
  console.log('');

  const providers = await withStatus('Configuring providers', () => api.configureProviders(walletContext, config));

  // Deploy or join
  console.log('');
  console.log(`  ${c.white}Select action:${c.reset}`);
  console.log('');
  console.log(`    ${c.cyan}1${c.reset}  Deploy a new NFT collection`);
  console.log(`    ${c.cyan}2${c.reset}  Join an existing NFT collection`);
  console.log(`    ${c.cyan}3${c.reset}  Exit`);
  console.log('');

  let contract: DeployedNftContract;
  let contractAddress: string;
  let collectionName = '';
  let collectionSymbol = '';

  while (true) {
    const choice = await promptChoice();
    switch (choice) {
      case '1': {
        collectionName = await prompt('Collection name: ');
        if (!collectionName) {
          console.log(`    ${c.red}Name cannot be empty${c.reset}`);
          continue;
        }
        collectionSymbol = await prompt('Collection symbol: ');
        if (!collectionSymbol) {
          console.log(`    ${c.red}Symbol cannot be empty${c.reset}`);
          continue;
        }
        console.log(`\n    ${c.dim}Deploying contract (generating ZK proof)...${c.reset}`);
        contract = await api.deploy(providers, collectionName, collectionSymbol);
        contractAddress = contract.deployTxData.public.contractAddress;

        console.log(`\n    ${c.green}${c.bold}Contract deployed!${c.reset}`);
        console.log(`    ${c.gray}Address:${c.reset}    ${contractAddress}`);
        console.log(`    ${c.gray}Collection:${c.reset} ${collectionName} (${collectionSymbol})`);
        console.log('');
        break;
      }
      case '2': {
        const addr = await prompt('Contract address: ');
        if (!addr) {
          console.log(`    ${c.red}Address cannot be empty${c.reset}`);
          continue;
        }
        console.log(`\n    ${c.dim}Joining contract...${c.reset}`);
        contract = await api.joinContract(providers, addr);
        contractAddress = contract.deployTxData.public.contractAddress;

        // Fetch collection name and symbol
        try {
          console.log(`    ${c.dim}Fetching collection info...${c.reset}`);
          const nameResult = await api.getName(contract);
          collectionName = nameResult.name;
          const symbolResult = await api.getSymbol(contract);
          collectionSymbol = symbolResult.symbol;
        } catch {
          collectionName = '(unknown)';
          collectionSymbol = '?';
        }

        console.log(`\n    ${c.green}${c.bold}Joined!${c.reset}`);
        console.log(`    ${c.gray}Address:${c.reset}    ${contractAddress}`);
        console.log(`    ${c.gray}Collection:${c.reset} ${collectionName} (${collectionSymbol})`);
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

  await mainLoop(contract!, providers, walletContext, contractAddress!, collectionName, collectionSymbol);

  try { await walletContext.wallet.stop(); } catch {}
  rli.close();
};
