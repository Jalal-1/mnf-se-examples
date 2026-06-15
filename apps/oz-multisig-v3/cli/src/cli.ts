import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import type { Logger } from 'pino';

import {
  type Config,
  type WalletContext,
  StandaloneConfig,
  buildFreshWallet,
  buildWalletAndWaitForFunds,
} from '@mnf-se/common';

import * as api from './api.js';
import type { CompactQualifiedShieldedCoin } from './api.js';
import type { DeployedOzMultisigV3Contract, OzMultisigV3Providers } from './types.js';
import {
  bytesToHex,
  generateStubEcdsaSigners,
  hexToBytes32,
  randomBytes32,
  shortHex,
  stubSignature,
  tokenDomainFromName,
  tokenNameFromDomain,
  zswapRecipient,
  type StubEcdsaSigner,
} from './crypto.js';

let logger: Logger;

const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const UINT64_MAX = (1n << 64n) - 1n;

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

type Session = {
  contract: DeployedOzMultisigV3Contract | null;
  providers: OzMultisigV3Providers;
  signers: StubEcdsaSigner[];
  signerCommitments: Uint8Array[];
  threshold: bigint;
  tokenDomain: Uint8Array | null;
  tokenType: string | null;
  contractCoins: CompactQualifiedShieldedCoin[];
};

export const run = async (config: Config, _logger: Logger): Promise<void> => {
  logger = _logger;
  api.setLogger(logger);

  const rli = createInterface({ input, output, terminal: true });
  try {
    banner(config);
    const walletCtx = await buildWallet(config, rli);
    const providers = await api.configureProviders(walletCtx, config);
    const session: Session = {
      contract: null,
      providers,
      signers: [],
      signerCommitments: [],
      threshold: 2n,
      tokenDomain: null,
      tokenType: null,
      contractCoins: [],
    };

    let exit = false;
    while (!exit) {
      renderSession(session);
      const choice = await rli.question(prompt('Select'));
      try {
        switch (choice.trim()) {
          case '1':
            await guidedDeployMintBurn(rli, walletCtx, session);
            break;
          case '2':
            await deployOnly(rli, session);
            break;
          case '3':
            await mintToWallet(rli, walletCtx, session);
            break;
          case '4':
            await burnWalletCoin(rli, walletCtx, session);
            break;
          case '5':
            await manualBurn(rli, session);
            break;
          case '6':
            await joinExisting(rli, session);
            break;
          case '7':
            await refreshSummary(session);
            break;
          case '8':
            exit = true;
            break;
          default:
            console.log(`${c.red}Unknown option.${c.reset}`);
        }
      } catch (err) {
        console.log(`${c.red}Failed:${c.reset} ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    rli.close();
  }
};

async function guidedDeployMintBurn(
  rli: Interface,
  walletCtx: WalletContext,
  session: Session,
): Promise<void> {
  console.log(`${c.cyan}Guided flow:${c.reset} deploy exact OZ V3, mint to this wallet, auto-select the wallet coin, then burn via OZ V3.`);
  await deployOnly(rli, session);
  await mintToWallet(rli, walletCtx, session);
  const proceed = await askYesNo(rli, 'Burn the freshly minted wallet coin now?', true);
  if (proceed) {
    await burnWalletCoin(rli, walletCtx, session);
  }
}

async function deployOnly(rli: Interface, session: Session): Promise<void> {
  const tokenName = await askDefault(rli, 'Token name', 'OZ V3 Demo Token');
  const tokenDomain = tokenDomainFromName(tokenName);
  const instanceSalt = randomBytes32();
  const initCoinNonce = randomBytes32();
  const signers = generateStubEcdsaSigners();
  const signerCommitments = signers.map((signer) =>
    api.calculateSignerId(signer.publicKey, instanceSalt),
  );

  console.log(`${c.dim}Deploying exact ShieldedMultiSigV3 with 3 stub ECDSA public keys and threshold 2.${c.reset}`);
  const contract = await api.deploy(
    session.providers,
    instanceSalt,
    initCoinNonce,
    tokenDomain,
    signerCommitments,
    2n,
  );

  session.contract = contract;
  session.signers = signers;
  session.signerCommitments = signerCommitments;
  session.threshold = 2n;
  session.tokenDomain = tokenDomain;
  session.contractCoins = [];
  await refreshSummary(session);

  console.log(`${c.green}Deployed:${c.reset} ${contract.deployTxData.public.contractAddress}`);
  printSigners(session);
}

async function mintToWallet(
  rli: Interface,
  walletCtx: WalletContext,
  session: Session,
): Promise<void> {
  const contract = requireContract(session);
  const amount = await askUint64(rli, 'Mint amount', 100n);
  const approval = await selectApprovals(rli, session);
  const recipient = zswapRecipient(getWalletZswapKey(walletCtx));

  console.log(`${c.dim}Minting to this wallet so the OZ V3 burn can receive and burn a wallet/operator coin.${c.reset}`);
  const result = await api.mint(
    session.providers,
    contract,
    amount,
    recipient,
    approval.pubkeys,
    approval.signatures,
  );

  await refreshSummary(session);
  const tokenType = requireTokenType(session);
  const coins = await waitForWalletCoins(walletCtx, tokenType, amount);
  const balance = await api.getShieldedTokenBalance(walletCtx.wallet, tokenType);

  console.log(`${c.green}Mint tx:${c.reset} ${result.tx.txId}`);
  console.log(`${c.green}Wallet token balance:${c.reset} ${balance}`);
  console.log(`${c.green}Spendable wallet coins:${c.reset} ${coins.length}`);
}

async function burnWalletCoin(
  rli: Interface,
  walletCtx: WalletContext,
  session: Session,
): Promise<void> {
  const contract = requireContract(session);
  const tokenType = requireTokenType(session);
  const coins = await api.getSpendableShieldedTokenCoins(walletCtx.wallet, tokenType);
  if (coins.length === 0) {
    throw new Error('No spendable wallet coin found for this token. Mint to this wallet first, or use manual burn with known qualified fields.');
  }

  const coin = await chooseCoin(rli, coins, 'Spendable wallet coins');
  const amount = await askUint64(rli, 'Burn amount', coin.value);
  if (amount > coin.value) {
    throw new Error(`Burn amount ${amount} exceeds selected coin value ${coin.value}`);
  }

  // The wallet coin's mt_index is global to the wallet view. This V3 circuit
  // first receives the coin into the contract, then spends the incoming
  // contract-local coin; for this single-coin full burn, that slot is 0.
  const burnCoin = { ...coin, mt_index: 0n };
  console.log(`${c.dim}Using wallet coin value=${coin.value} with contract-local burn mt_index=${burnCoin.mt_index}.${c.reset}`);

  const approval = await selectApprovals(rli, session);
  const result = await api.burn(contract, burnCoin, amount, approval.pubkeys, approval.signatures);
  await refreshSummary(session);
  const balance = await api.getShieldedTokenBalance(walletCtx.wallet, tokenType);

  console.log(`${c.green}Burn tx:${c.reset} ${result.tx.txId}`);
  console.log(`${c.green}Wallet token balance:${c.reset} ${balance}`);
}

async function manualBurn(rli: Interface, session: Session): Promise<void> {
  const contract = requireContract(session);
  const tokenColor = session.tokenType ?? '';
  const colorHex = await askDefault(rli, 'Coin color hex', tokenColor);
  const nonceHex = await askRequired(rli, 'Coin nonce hex');
  const value = await askUint64(rli, 'Coin value', 100n);
  const mtIndex = await askBigInt(rli, 'Coin mt_index', 0n);
  const amount = await askUint64(rli, 'Burn amount', value);
  const coin: CompactQualifiedShieldedCoin = {
    color: hexToBytes32(colorHex, 'Coin color'),
    nonce: hexToBytes32(nonceHex, 'Coin nonce'),
    value,
    mt_index: mtIndex,
  };
  const approval = await selectApprovals(rli, session);
  const result = await api.burn(contract, coin, amount, approval.pubkeys, approval.signatures);
  session.contractCoins = dedupeCoins(result.remainingContractCoins);
  await refreshSummary(session);
  console.log(`${c.green}Burn tx:${c.reset} ${result.tx.txId}`);
}

async function joinExisting(rli: Interface, session: Session): Promise<void> {
  const address = await askRequired(rli, 'Contract address');
  const contract = await api.joinContract(session.providers, address.trim());
  session.contract = contract;
  session.contractCoins = [];
  session.signers = [];
  session.signerCommitments = [];
  session.tokenDomain = null;
  session.tokenType = null;
  await refreshSummary(session);
  console.log(`${c.green}Joined:${c.reset} ${contract.deployTxData.public.contractAddress}`);
  console.log(`${c.yellow}Note:${c.reset} joined contracts do not restore local demo signer pubkeys. Use a fresh guided deploy for the no-indexer burn test.`);
}

async function refreshSummary(session: Session): Promise<void> {
  if (!session.contract) return;
  const address = session.contract.deployTxData.public.contractAddress;
  const summary = await api.readSummary(session.providers, address);
  if (!summary) {
    session.tokenType = null;
    return;
  }
  session.tokenDomain = summary.tokenDomain;
  session.tokenType = summary.tokenType;
}

function requireContract(session: Session): DeployedOzMultisigV3Contract {
  if (!session.contract) {
    throw new Error('No contract selected. Run guided flow, deploy, or join first.');
  }
  return session.contract;
}

function requireTokenType(session: Session): string {
  if (!session.tokenType) {
    throw new Error('Token color is not known yet. Deploy or refresh the contract summary first.');
  }
  return session.tokenType;
}

const getWalletZswapKey = (walletCtx: WalletContext): Uint8Array =>
  ledger.encodeCoinPublicKey(walletCtx.shieldedSecretKeys.coinPublicKey);

const waitForWalletCoins = async (
  walletCtx: WalletContext,
  tokenType: string,
  minValue: bigint,
): Promise<api.SpendableShieldedCoin[]> => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const coins = await api.getSpendableShieldedTokenCoins(walletCtx.wallet, tokenType);
    if (coins.some((coin) => coin.value >= minValue)) return coins;
    await sleep(1_000);
  }
  return await api.getSpendableShieldedTokenCoins(walletCtx.wallet, tokenType);
};

async function selectApprovals(
  rli: Interface,
  session: Session,
): Promise<{ pubkeys: Uint8Array[]; signatures: Uint8Array[] }> {
  if (session.signers.length < 3) {
    throw new Error('No local demo signer keys available. Deploy in this session to approve operations.');
  }
  printSigners(session);
  const choice = await askDefault(rli, 'Choose two signer slots, e.g. 1,2', '1,2');
  const slots = choice
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((slot) => Number.isInteger(slot));
  const unique = [...new Set(slots)];
  if (unique.length !== 2 || unique.some((slot) => slot < 1 || slot > session.signers.length)) {
    throw new Error('Choose exactly two unique signer slots between 1 and 3');
  }
  return {
    pubkeys: unique.map((slot) => session.signers[slot - 1].publicKey),
    signatures: unique.map(() => stubSignature()),
  };
}

async function chooseCoin(
  rli: Interface,
  coins: CompactQualifiedShieldedCoin[],
  title = 'Qualified coins',
): Promise<CompactQualifiedShieldedCoin> {
  if (coins.length === 1) return coins[0];
  console.log(`${c.bold}${title}${c.reset}`);
  coins.forEach((coin, index) => {
    console.log(
      `  [${index + 1}] value=${coin.value} mt_index=${coin.mt_index} nonce=${shortHex(bytesToHex(coin.nonce))}`,
    );
  });
  const index = Number.parseInt(await askDefault(rli, 'Coin slot', '1'), 10);
  const coin = coins[index - 1];
  if (!coin) throw new Error('Invalid coin slot');
  return coin;
}

function renderSession(session: Session): void {
  console.log('');
  console.log(`${c.bold}${c.magenta}OZ ShieldedMultiSigV3 Harness${c.reset}`);
  console.log('='.repeat(72));
  console.log(`${c.cyan}Contract:${c.reset} ${session.contract?.deployTxData.public.contractAddress ?? '(none)'}`);
  console.log(`${c.cyan}Token:${c.reset}    ${session.tokenDomain ? tokenNameFromDomain(session.tokenDomain) : '(none)'}`);
  console.log(`${c.cyan}Color:${c.reset}    ${session.tokenType ? shortHex(session.tokenType, 18, 12) : '(none)'}`);
  console.log(`${c.cyan}Policy:${c.reset}   ${session.signers.length ? `${session.threshold} of ${session.signers.length}` : '(no local keys)'}`);
  console.log(`${c.cyan}Coins:${c.reset}    wallet auto-select by token color; manual qualified entry available`);
  console.log('-'.repeat(72));
  console.log('[1] guided deploy + wallet mint + OZ V3 burn');
  console.log('[2] deploy exact OZ V3');
  console.log('[3] mint to this wallet');
  console.log('[4] burn wallet coin');
  console.log('[5] manual burn with qualified coin fields');
  console.log('[6] join existing contract');
  console.log('[7] refresh chain summary');
  console.log('[8] exit');
}

function printSigners(session: Session): void {
  if (!session.signers.length) return;
  console.log(`${c.bold}Demo signers${c.reset}`);
  session.signers.forEach((signer, index) => {
    const commitment = session.signerCommitments[index];
    console.log(
      `  [${index + 1}] ${signer.label} pk=${shortHex(bytesToHex(signer.publicKey))} commitment=${commitment ? shortHex(bytesToHex(commitment)) : '(unknown)'}`,
    );
  });
  console.log(`${c.dim}ECDSA verification is stubbed in this upstream V3 contract; the pubkeys still gate signer commitments.${c.reset}`);
}

async function buildWallet(config: Config, rli: Interface): Promise<WalletContext> {
  if (config instanceof StandaloneConfig) {
    return await buildWalletAndWaitForFunds(config, GENESIS_MINT_WALLET_SEED);
  }

  const restore = await askYesNo(rli, 'Restore a wallet seed?', false);
  if (!restore) return await buildFreshWallet(config);
  const seed = await askRequired(rli, 'Wallet seed');
  return await buildWalletAndWaitForFunds(config, seed.trim());
}

function banner(config: Config): void {
  const network = config instanceof StandaloneConfig
    ? 'undeployed'
    : config.node.includes('preview') ? 'preview' : 'preprod';
  console.log(`${c.bold}${c.cyan}mnf-se OZ multisig V3${c.reset} on ${network}`);
  console.log(`${c.dim}Exact burn path: receiveShielded + sendShielded(..., shieldedBurnAddress()).${c.reset}`);
}

async function askRequired(rli: Interface, label: string): Promise<string> {
  const value = (await rli.question(prompt(label))).trim();
  if (!value) throw new Error(`${label} is required`);
  return value;
}

async function askDefault(rli: Interface, label: string, defaultValue: string): Promise<string> {
  const value = (await rli.question(prompt(`${label} [${defaultValue}]`))).trim();
  return value || defaultValue;
}

async function askYesNo(rli: Interface, label: string, defaultValue: boolean): Promise<boolean> {
  const suffix = defaultValue ? 'Y/n' : 'y/N';
  const value = (await rli.question(prompt(`${label} [${suffix}]`))).trim().toLowerCase();
  if (!value) return defaultValue;
  return value === 'y' || value === 'yes';
}

async function askUint64(rli: Interface, label: string, defaultValue: bigint): Promise<bigint> {
  const value = await askBigInt(rli, label, defaultValue);
  if (value < 0n || value > UINT64_MAX) {
    throw new Error(`${label} must fit in Uint<64>`);
  }
  return value;
}

async function askBigInt(rli: Interface, label: string, defaultValue: bigint): Promise<bigint> {
  const raw = await askDefault(rli, label, defaultValue.toString());
  try {
    return BigInt(raw.replace(/_/g, ''));
  } catch {
    throw new Error(`${label} must be an integer`);
  }
}

function prompt(label: string): string {
  return `${c.green}>${c.reset} ${label}: `;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function dedupeCoins(coins: CompactQualifiedShieldedCoin[]): CompactQualifiedShieldedCoin[] {
  const seen = new Set<string>();
  const out: CompactQualifiedShieldedCoin[] = [];
  for (const coin of coins) {
    const key = `${bytesToHex(coin.color)}:${bytesToHex(coin.nonce)}:${coin.value}:${coin.mt_index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(coin);
  }
  return out;
}
