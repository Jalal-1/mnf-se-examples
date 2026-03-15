import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
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
  DIVIDER,
} from '@mnf-se/common';

import { type ElectionPrivateState, PrivateStateEnum } from '@mnf-se/election-contract';
import type { ElectionProviders, DeployedElectionContract } from './types.js';
import * as api from './api.js';

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
  console.log(`    ${c.cyan}1${c.reset}  Create new wallet`);
  console.log(`    ${c.cyan}2${c.reset}  Restore from hex seed`);
  console.log('');

  while (true) {
    const choice = await promptChoice();
    switch (choice) {
      case '1': return await buildFreshWallet(config);
      case '2': {
        const seed = await prompt('Enter hex seed: ');
        return await buildWalletAndWaitForFunds(config, seed);
      }
      default: console.log(`    ${c.red}Invalid choice${c.reset}`);
    }
  }
}

// ── State Display ──────────────────────────────────────────────────────

function renderState(state: api.ElectionPublicState | null, contractAddress: string, role: string) {
  console.log('');
  console.log(`  ${c.cyan}+${'='.repeat(62)}+${c.reset}`);
  console.log(`  ${c.cyan}|${c.bold}          MIDNIGHT ELECTION - ${role.toUpperCase()}${' '.repeat(Math.max(0, 31 - role.length))}${c.reset}${c.cyan}|${c.reset}`);
  console.log(`  ${c.cyan}|${' '.repeat(14)}MNF Solutions Engineering${' '.repeat(23)}${c.cyan}|${c.reset}`);
  console.log(`  ${c.cyan}+${'='.repeat(62)}+${c.reset}`);
  console.log('');

  if (!state) {
    console.log(`    ${c.dim}Loading state...${c.reset}`);
    return;
  }

  const shortAddr = contractAddress.length > 48 ? contractAddress.substring(0, 48) + '...' : contractAddress;
  console.log(`    ${c.gray}Contract${c.reset}      ${shortAddr}`);
  console.log('');

  console.log(`  ${c.blue}+${'─'.repeat(60)}+${c.reset}`);
  console.log(`  ${c.blue}|${c.reset} ${c.blue}${c.bold}ELECTION STATE${c.reset} ${c.dim}(on-chain)${c.reset}${' '.repeat(33)}${c.blue}|${c.reset}`);
  console.log(`  ${c.blue}|${c.reset}${' '.repeat(60)}${c.blue}|${c.reset}`);
  console.log(`  ${c.blue}|${c.reset}  Phase        ${c.yellow}${c.bold}${api.phaseName(state.state)}${c.reset}${' '.repeat(Math.max(0, 45 - api.phaseName(state.state).length))}${c.blue}|${c.reset}`);
  console.log(`  ${c.blue}|${c.reset}  Topic        ${c.white}${state.topic.is_some ? state.topic.value : '(not set)'}${c.reset}${' '.repeat(Math.max(0, 45 - (state.topic.is_some ? state.topic.value.length : 9)))}${c.blue}|${c.reset}`);
  console.log(`  ${c.blue}|${c.reset}  Voters       ${c.white}${state.eligibleVoterCount}${c.reset}${' '.repeat(Math.max(0, 45 - String(state.eligibleVoterCount).length))}${c.blue}|${c.reset}`);
  console.log(`  ${c.blue}|${c.reset}  Committed    ${c.white}${state.committedVoteCount}${c.reset}${' '.repeat(Math.max(0, 45 - String(state.committedVoteCount).length))}${c.blue}|${c.reset}`);
  console.log(`  ${c.blue}|${c.reset}  Yes / No     ${c.green}${state.tallyYes}${c.reset} / ${c.red}${state.tallyNo}${c.reset}${' '.repeat(Math.max(0, 40 - String(state.tallyYes).length - String(state.tallyNo).length))}${c.blue}|${c.reset}`);
  console.log(`  ${c.blue}+${'─'.repeat(60)}+${c.reset}`);
  console.log('');
}

// ── Authority Loop ────────────────────────────────────────────────────

async function authorityLoop(
  contract: DeployedElectionContract,
  providers: ElectionProviders,
  contractAddress: string,
): Promise<void> {
  while (true) {
    const state = await api.getElectionState(providers, contractAddress);
    renderState(state, contractAddress, 'authority');

    console.log(`    ${c.cyan}1${c.reset}  Set election topic`);
    console.log(`    ${c.cyan}2${c.reset}  Add eligible voter`);
    console.log(`    ${c.cyan}3${c.reset}  Advance to next phase`);
    console.log(`    ${c.cyan}4${c.reset}  Refresh`);
    console.log(`    ${c.cyan}5${c.reset}  Exit`);
    console.log('');

    const choice = await promptChoice();
    try {
      switch (choice) {
        case '1': {
          const topic = await prompt('Election topic: ');
          if (!topic) { console.log(`    ${c.red}Topic cannot be empty${c.reset}`); break; }
          console.log(`\n    ${c.dim}Submitting...${c.reset}`);
          await api.setTopic(contract, topic);
          console.log(`    ${c.green}Topic set!${c.reset}\n`);
          break;
        }
        case '2': {
          const pkHex = await prompt('Voter public key (hex): ');
          const pk = new Uint8Array(Buffer.from(pkHex, 'hex'));
          if (pk.length !== 32) { console.log(`    ${c.red}Must be 32 bytes (64 hex)${c.reset}`); break; }
          console.log(`\n    ${c.dim}Submitting...${c.reset}`);
          await api.addVoter(contract, providers, pk);
          console.log(`    ${c.green}Voter added!${c.reset}\n`);
          break;
        }
        case '3': {
          console.log(`\n    ${c.dim}Submitting...${c.reset}`);
          await api.advance(contract);
          console.log(`    ${c.green}Phase advanced!${c.reset}\n`);
          break;
        }
        case '4': break;
        case '5': return;
        default: console.log(`    ${c.red}Invalid choice${c.reset}`);
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const m = raw.match(/failed assert:\s*(.+)/);
      console.log(`\n    ${c.red}[!] ${m ? m[1] : raw}${c.reset}\n`);
    }
  }
}

// ── Voter Loop ────────────────────────────────────────────────────────

async function voterLoop(
  contract: DeployedElectionContract,
  providers: ElectionProviders,
  contractAddress: string,
): Promise<void> {
  while (true) {
    const state = await api.getElectionState(providers, contractAddress);
    renderState(state, contractAddress, 'voter');

    console.log(`    ${c.green}1${c.reset}  Cast vote (commit)`);
    console.log(`    ${c.green}2${c.reset}  Reveal vote`);
    console.log(`    ${c.green}3${c.reset}  Refresh`);
    console.log(`    ${c.green}4${c.reset}  Exit`);
    console.log('');

    const choice = await promptChoice();
    try {
      switch (choice) {
        case '1': {
          const voteStr = await prompt('Vote (yes/no): ');
          const ballot = voteStr.toLowerCase() === 'yes' ? 0 : voteStr.toLowerCase() === 'no' ? 1 : -1;
          if (ballot === -1) { console.log(`    ${c.red}Must be 'yes' or 'no'${c.reset}`); break; }
          console.log(`\n    ${c.dim}Generating proof and submitting...${c.reset}`);
          await api.voteCommit(contract, providers, ballot);
          console.log(`    ${c.green}Vote committed!${c.reset}\n`);
          break;
        }
        case '2': {
          console.log(`\n    ${c.dim}Generating proof and submitting...${c.reset}`);
          await api.voteReveal(contract, providers);
          console.log(`    ${c.green}Vote revealed!${c.reset}\n`);
          break;
        }
        case '3': break;
        case '4': return;
        default: console.log(`    ${c.red}Invalid choice${c.reset}`);
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const m = raw.match(/failed assert:\s*(.+)/);
      console.log(`\n    ${c.red}[!] ${m ? m[1] : raw}${c.reset}\n`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

export const run = async (config: Config, _logger: Logger): Promise<void> => {
  api.setLogger(_logger);

  console.log('');
  console.log(`  ${c.cyan}+${'='.repeat(62)}+${c.reset}`);
  console.log(`  ${c.cyan}|${c.bold}${' '.repeat(16)}MIDNIGHT ELECTION${' '.repeat(29)}${c.reset}${c.cyan}|${c.reset}`);
  console.log(`  ${c.cyan}|${' '.repeat(14)}MNF Solutions Engineering${' '.repeat(23)}${c.cyan}|${c.reset}`);
  console.log(`  ${c.cyan}+${'='.repeat(62)}+${c.reset}`);
  console.log('');

  const walletContext = await setupWallet(config);
  console.log(`\n  ${c.green}Wallet ready!${c.reset}\n`);

  const providers = await withStatus('Configuring providers', () => api.configureProviders(walletContext, config));

  // Deploy or join
  console.log('');
  console.log(`    ${c.cyan}1${c.reset}  Deploy new Election contract`);
  console.log(`    ${c.cyan}2${c.reset}  Join existing Election contract`);
  console.log(`    ${c.cyan}3${c.reset}  Exit`);
  console.log('');

  let contract: DeployedElectionContract;
  let contractAddress: string;
  let role: 'authority' | 'voter';

  while (true) {
    const choice = await promptChoice();
    switch (choice) {
      case '1': {
        const secretKey = api.randomBytes(32);
        const privateState: ElectionPrivateState = {
          secretKey,
          state: PrivateStateEnum.initial,
          vote: null,
        };
        console.log(`\n    ${c.dim}Deploying (generating ZK proof)...${c.reset}`);
        contract = await api.deploy(providers, privateState);
        contractAddress = contract.deployTxData.public.contractAddress;
        role = 'authority';

        const pk = api.derivePublicKey(secretKey);
        console.log(`\n    ${c.green}${c.bold}Election deployed!${c.reset}`);
        console.log(`    ${c.gray}Contract:${c.reset}   ${contractAddress}`);
        console.log(`    ${c.gray}Authority:${c.reset}  ${Buffer.from(pk).toString('hex').substring(0, 32)}...`);
        console.log(`    ${c.gray}Secret key:${c.reset} ${Buffer.from(secretKey).toString('hex')}`);
        console.log(`\n    ${c.yellow}Save the secret key to manage this election.${c.reset}\n`);
        break;
      }
      case '2': {
        const addr = await prompt('Contract address: ');
        if (!addr) { console.log(`    ${c.red}Address cannot be empty${c.reset}`); continue; }
        const roleChoice = await prompt('Role (1=authority, 2=voter): ');
        let secretKey: Uint8Array;
        if (roleChoice === '1') {
          const skHex = await prompt('Authority secret key (hex): ');
          secretKey = new Uint8Array(Buffer.from(skHex, 'hex'));
          if (secretKey.length !== 32) { console.log(`    ${c.red}Must be 32 bytes${c.reset}`); continue; }
          role = 'authority';
        } else {
          secretKey = api.randomBytes(32);
          const pk = api.derivePublicKey(secretKey);
          console.log(`\n    ${c.yellow}Your voter public key (give to authority):${c.reset}`);
          console.log(`    ${Buffer.from(pk).toString('hex')}`);
          console.log(`    ${c.gray}Secret key: ${Buffer.from(secretKey).toString('hex')}${c.reset}\n`);
          role = 'voter';
        }
        const privateState: ElectionPrivateState = {
          secretKey,
          state: PrivateStateEnum.initial,
          vote: null,
        };
        console.log(`    ${c.dim}Joining contract...${c.reset}`);
        contract = await api.joinContract(providers, addr, privateState);
        contractAddress = contract.deployTxData.public.contractAddress;
        break;
      }
      case '3':
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
    await authorityLoop(contract!, providers, contractAddress!);
  } else {
    await voterLoop(contract!, providers, contractAddress!);
  }

  try { await walletContext.wallet.stop(); } catch {}
  rli.close();
};
