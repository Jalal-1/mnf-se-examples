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
  clearScreen,
} from '@mnf-se/common';

import type { AccessControlProviders, DeployedAccessControlContract } from './types.js';
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
  counterValue: bigint,
  walletAddress: string,
  nightBalance: bigint,
  coinPubKeyHex: string,
  message?: Message,
): void {
  const shortAddr = contractAddress.length > 48
    ? contractAddress.substring(0, 48) + '...'
    : contractAddress;

  console.log(`    ${c.gray}Contract${c.reset}      ${shortAddr}`);
  console.log(`    ${c.gray}Counter${c.reset}       ${c.white}${c.bold}${counterValue.toString()}${c.reset}`);
  console.log('');

  const shortWallet = walletAddress.length > 36
    ? walletAddress.substring(0, 36) + '...'
    : walletAddress;
  console.log(`    ${c.gray}Wallet${c.reset}        ${c.dim}${shortWallet}${c.reset}`);
  console.log(`    ${c.gray}Coin PubKey${c.reset}   ${c.dim}${coinPubKeyHex.substring(0, 32)}...${c.reset}`);
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
  console.log(`    ${c.cyan}1${c.reset}  Increment counter (requires MINTER_ROLE)`);
  console.log(`    ${c.cyan}2${c.reset}  Grant role (admin only)`);
  console.log(`    ${c.cyan}3${c.reset}  Revoke role (admin only)`);
  console.log(`    ${c.cyan}4${c.reset}  Check role`);
  console.log(`    ${c.cyan}5${c.reset}  Pause contract (requires PAUSER_ROLE)`);
  console.log(`    ${c.cyan}6${c.reset}  Unpause contract (requires PAUSER_ROLE)`);
  console.log(`    ${c.cyan}7${c.reset}  View counter`);
  console.log(`    ${c.cyan}8${c.reset}  Refresh`);
  console.log(`    ${c.cyan}9${c.reset}  Exit`);
  console.log('');
  console.log(`  ${c.gray}${'─'.repeat(WIDTH)}${c.reset}`);
  console.log('');
}

// ── Role name helpers ──────────────────────────────────────────────────

function promptRoleName(): Promise<string> {
  console.log(`    ${c.dim}Roles: MINTER, PAUSER, DEFAULT_ADMIN${c.reset}`);
  return prompt('Role name: ');
}

function resolveRoleId(
  roleName: string,
  state: api.AccessControlState,
): Uint8Array | null {
  const upper = roleName.toUpperCase().trim();
  switch (upper) {
    case 'MINTER':
    case 'MINTER_ROLE':
      return state.minterRole;
    case 'PAUSER':
    case 'PAUSER_ROLE':
      return state.pauserRole;
    case 'DEFAULT_ADMIN':
    case 'DEFAULT_ADMIN_ROLE':
      return state.defaultAdminRole;
    default:
      return null;
  }
}

// ── Main Interaction Loop ──────────────────────────────────────────────

async function interactionLoop(
  contract: DeployedAccessControlContract,
  providers: AccessControlProviders,
  walletContext: WalletContext,
  contractAddress: string,
): Promise<void> {
  let message: Message | undefined;
  const coinPubKey = ledger.encodeCoinPublicKey(walletContext.shieldedSecretKeys.coinPublicKey);
  const coinPubKeyHex = Buffer.from(coinPubKey).toString('hex');

  while (true) {
    // Get wallet state
    const walletState = await Rx.firstValueFrom(walletContext.wallet.state());
    const nightBalance = walletState.unshielded?.balances[nativeToken().raw] ?? 0n;
    const walletAddress = walletContext.unshieldedKeystore.getBech32Address().toString();

    // Get contract state
    const contractState = api.getContractState(contract);
    const counterValue = contractState?.counter ?? 0n;

    renderHeader('ACCESS CONTROL VAULT', c.cyan);
    renderInfo(contractAddress, counterValue, walletAddress, nightBalance, coinPubKeyHex, message);
    renderMenu();
    message = undefined;

    const choice = await promptChoice();

    try {
      switch (choice) {
        case '1': {
          // Increment counter
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.increment(contract);
          message = { text: 'Counter incremented', type: 'success' };
          break;
        }
        case '2': {
          // Grant role
          const state = api.getContractState(contract);
          if (!state) {
            message = { text: 'Cannot read contract state', type: 'error' };
            break;
          }
          const roleName = await promptRoleName();
          const roleId = resolveRoleId(roleName, state);
          if (!roleId) {
            message = { text: `Unknown role: ${roleName}`, type: 'error' };
            break;
          }
          const grantKeyHex = await prompt('Recipient public key (hex, 64 chars): ');
          const grantKeyBytes = new Uint8Array(Buffer.from(grantKeyHex, 'hex'));
          if (grantKeyBytes.length !== 32) {
            message = { text: 'Public key must be 32 bytes (64 hex chars)', type: 'error' };
            break;
          }
          const grantAccount = api.leftPublicKey(grantKeyBytes);
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.grantRole(contract, roleId, grantAccount);
          message = { text: `Granted ${roleName.toUpperCase()} to ${grantKeyHex.substring(0, 16)}...`, type: 'success' };
          break;
        }
        case '3': {
          // Revoke role
          const state = api.getContractState(contract);
          if (!state) {
            message = { text: 'Cannot read contract state', type: 'error' };
            break;
          }
          const roleName = await promptRoleName();
          const roleId = resolveRoleId(roleName, state);
          if (!roleId) {
            message = { text: `Unknown role: ${roleName}`, type: 'error' };
            break;
          }
          const revokeKeyHex = await prompt('Account public key (hex, 64 chars): ');
          const revokeKeyBytes = new Uint8Array(Buffer.from(revokeKeyHex, 'hex'));
          if (revokeKeyBytes.length !== 32) {
            message = { text: 'Public key must be 32 bytes (64 hex chars)', type: 'error' };
            break;
          }
          const revokeAccount = api.leftPublicKey(revokeKeyBytes);
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.revokeRole(contract, roleId, revokeAccount);
          message = { text: `Revoked ${roleName.toUpperCase()} from ${revokeKeyHex.substring(0, 16)}...`, type: 'success' };
          break;
        }
        case '4': {
          // Check role
          const state = api.getContractState(contract);
          if (!state) {
            message = { text: 'Cannot read contract state', type: 'error' };
            break;
          }
          const roleName = await promptRoleName();
          const roleId = resolveRoleId(roleName, state);
          if (!roleId) {
            message = { text: `Unknown role: ${roleName}`, type: 'error' };
            break;
          }
          const checkKeyHex = await prompt('Account public key (hex, 64 chars, or "self"): ');
          let checkAccount;
          if (checkKeyHex.toLowerCase() === 'self') {
            checkAccount = api.leftPublicKey(coinPubKey);
          } else {
            const checkKeyBytes = new Uint8Array(Buffer.from(checkKeyHex, 'hex'));
            if (checkKeyBytes.length !== 32) {
              message = { text: 'Public key must be 32 bytes (64 hex chars)', type: 'error' };
              break;
            }
            checkAccount = api.leftPublicKey(checkKeyBytes);
          }
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          const { result } = await api.hasRole(contract, roleId, checkAccount);
          const label = checkKeyHex.toLowerCase() === 'self' ? 'You' : checkKeyHex.substring(0, 16) + '...';
          message = {
            text: result
              ? `${label} ${c.green}HAS${c.reset} ${roleName.toUpperCase()}`
              : `${label} does ${c.red}NOT${c.reset} have ${roleName.toUpperCase()}`,
            type: 'info',
          };
          break;
        }
        case '5': {
          // Pause
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.pause(contract);
          message = { text: 'Contract paused', type: 'success' };
          break;
        }
        case '6': {
          // Unpause
          console.log(`\n    ${c.dim}Generating ZK proof and submitting transaction...${c.reset}`);
          await api.unpause(contract);
          message = { text: 'Contract unpaused', type: 'success' };
          break;
        }
        case '7': {
          // View counter
          const state = api.getContractState(contract);
          if (state) {
            message = { text: `Counter value: ${c.green}${state.counter.toString()}${c.reset}`, type: 'info' };
          } else {
            message = { text: 'Cannot read contract state', type: 'error' };
          }
          break;
        }
        case '8':
          message = { text: 'Refreshed', type: 'info' };
          break;
        case '9':
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
  console.log(`  ${c.cyan}|${c.bold}${centerText('MIDNIGHT ACCESS CONTROL', WIDTH - 2)}${c.reset}${c.cyan}|${c.reset}`);
  console.log(`  ${c.cyan}|${centerText('MNF Solutions Engineering', WIDTH - 2)}${c.cyan}|${c.reset}`);
  console.log(`  ${c.cyan}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
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
  console.log(`    ${c.cyan}1${c.reset}  Deploy a new AccessControl contract`);
  console.log(`    ${c.cyan}2${c.reset}  Join an existing AccessControl contract`);
  console.log(`    ${c.cyan}3${c.reset}  Exit`);
  console.log('');

  let contract: DeployedAccessControlContract;
  let contractAddress: string;

  while (true) {
    const choice = await promptChoice();
    switch (choice) {
      case '1': {
        console.log(`\n    ${c.dim}Deploying contract (generating ZK proof)...${c.reset}`);
        contract = await api.deploy(providers);
        contractAddress = contract.deployTxData.public.contractAddress;

        console.log(`\n    ${c.green}${c.bold}Contract deployed!${c.reset}`);
        console.log(`    ${c.gray}Address:${c.reset}    ${contractAddress}`);
        console.log(`    ${c.gray}Admin:${c.reset}      You (deployer) have DEFAULT_ADMIN_ROLE`);
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
  );

  try { await walletContext.wallet.stop(); } catch {}
  rli.close();
};
