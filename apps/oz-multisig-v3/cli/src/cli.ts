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
  getDustBalance,
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
import {
  dashboardPrompt,
  enterDashboardScreen,
  exitDashboardScreen,
  renderDashboard,
  renderSplash,
  type DashboardCoin,
  type DashboardInstruction,
  type DashboardMessage,
} from './display.js';

const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const UINT64_MAX = (1n << 64n) - 1n;

type Session = {
  contract: DeployedOzMultisigV3Contract | null;
  providers: OzMultisigV3Providers;
  signers: StubEcdsaSigner[];
  signerCommitments: Uint8Array[];
  threshold: bigint;
  tokenDomain: Uint8Array | null;
  tokenType: string | null;
  counter: bigint | null;
  chainReadAt: string | null;
  network: string;
  activity: DashboardMessage[];
  guidance: DashboardInstruction | null;
};

type PromptReader = (prompt: string) => Promise<string>;
type StatusRenderer = (message: DashboardMessage) => Promise<void>;

export const run = async (config: Config, _logger: Logger): Promise<void> => {
  api.setLogger(silentLogger);

  const rli = createInterface({ input, output, terminal: true });
  const activity: DashboardMessage[] = [];
  let walletCtx: WalletContext | null = null;
  const restoreTerminalNoise = muteBackgroundTerminalNoise();
  enterDashboardScreen();

  try {
    remember(activity, 'info', `Starting OZ V3 harness on ${networkLabel(config)}.`);
    walletCtx = await buildWallet(config, rli, activity);
    if (!walletCtx) return;
    const activeWalletCtx = walletCtx;

    remember(activity, 'info', 'Configuring providers and proof assets...');
    renderSplash('providers', 'Preparing contract, wallet, indexer, and proof providers.', activity);
    const providers = await silenceTerminalOutput(() => api.configureProviders(activeWalletCtx, config));
    remember(activity, 'success', 'Providers ready.');

    const session: Session = {
      contract: null,
      providers,
      signers: [],
      signerCommitments: [],
      threshold: 2n,
      tokenDomain: null,
      tokenType: null,
      counter: null,
      chainReadAt: null,
      network: networkLabel(config),
      activity,
      guidance: {
        title: 'Start',
        body: 'Use guided mode to deploy, mint to this wallet, auto-select the coin, and burn through OZ V3.',
      },
    };

    const status: StatusRenderer = async (message) => {
      remember(session.activity, message.type, message.text);
      await renderLiveDashboard(activeWalletCtx, session);
    };
    const ask: PromptReader = async (prompt) => {
      await renderLiveDashboard(activeWalletCtx, session);
      return await rli.question(dashboardPrompt(prompt));
    };

    let exit = false;
    while (!exit) {
      await renderLiveDashboard(activeWalletCtx, session);
      let choice: string;
      try {
        choice = (await rli.question(dashboardPrompt('Select action'))).trim();
      } catch (err) {
        if (isAbortError(err)) {
          remember(session.activity, 'warn', 'Exit requested.');
          break;
        }
        throw err;
      }
      try {
        switch (choice) {
          case '1':
            await guidedDeployMintBurn(ask, activeWalletCtx, session, status);
            break;
          case '2':
            await deployOnly(ask, session, status);
            break;
          case '3':
            await mintToWallet(ask, activeWalletCtx, session, status);
            break;
          case '4':
            await burnWalletCoin(ask, activeWalletCtx, session, status);
            break;
          case '5':
            await manualBurn(ask, session, status);
            break;
          case '6':
            await joinExisting(ask, session, status);
            break;
          case '7':
            await refreshSummary(session, status);
            break;
          case '8':
            exit = true;
            break;
          default:
            remember(session.activity, 'warn', `Unknown action: ${choice || '(empty)'}`);
            guide(session, 'Choose', 'Use 1 for guided mode, or pick one of the commands at the bottom.', 'prompt');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isAbortError(err)) {
          remember(session.activity, 'warn', 'Exit requested.');
          exit = true;
          break;
        }
        remember(session.activity, 'error', message);
        guide(session, 'Blocked', message, 'warn');
      }
    }
  } finally {
    if (walletCtx) {
      try {
        await walletCtx.wallet.stop();
      } catch {
        // Best-effort cleanup; the CLI is already exiting.
      }
    }
    rli.close();
    exitDashboardScreen();
    restoreTerminalNoise();
  }
};

async function guidedDeployMintBurn(
  ask: PromptReader,
  walletCtx: WalletContext,
  session: Session,
  status: StatusRenderer,
): Promise<void> {
  guide(session, 'Guided flow', 'Step 1/4: name the token and deploy the exact OZ V3 contract.', 'guide');
  remember(session.activity, 'info', 'Guided flow started: deploy, wallet mint, auto-select coin, burn.');
  await deployOnly(ask, session, status);

  guide(session, 'Guided flow', 'Step 2/4: mint a shielded token to this wallet.', 'guide');
  await mintToWallet(ask, walletCtx, session, status);

  guide(session, 'Guided flow', 'Step 3/4: review the wallet coin, then burn it through receiveShielded + sendShielded.', 'prompt');
  const proceed = await askYesNo(ask, 'Burn the freshly minted wallet coin now?', true);
  if (proceed) {
    await burnWalletCoin(ask, walletCtx, session, status);
    guide(session, 'Complete', 'Guided deploy, mint, and burn completed successfully.', 'success');
  } else {
    remember(session.activity, 'warn', 'Guided burn skipped by user.');
    guide(session, 'Paused', 'The wallet coin is still available. Use option 4 to burn it later.', 'warn');
  }
}

async function deployOnly(
  ask: PromptReader,
  session: Session,
  status: StatusRenderer,
): Promise<void> {
  guide(session, 'Token name', 'Choose a token name. It becomes the domain separator used to derive token color.', 'prompt');
  const tokenName = await askDefault(ask, 'Token name [OZ V3 Demo Token]', 'OZ V3 Demo Token');
  const tokenDomain = tokenDomainFromName(tokenName);
  const instanceSalt = randomBytes32();
  const initCoinNonce = randomBytes32();
  const signers = generateStubEcdsaSigners();
  const signerCommitments = signers.map((signer) =>
    api.calculateSignerId(signer.publicKey, instanceSalt),
  );

  session.signers = signers;
  session.signerCommitments = signerCommitments;
  session.threshold = 2n;
  session.tokenDomain = tokenDomain;
  guide(session, 'Deploying', 'Three local demo signer keys are ready; deploying the exact OZ ShieldedMultiSigV3 contract.', 'guide');

  const contract = await withLiveInfo(status, 'Deploying exact OZ ShieldedMultiSigV3 contract...', () =>
    api.deploy(
      session.providers,
      instanceSalt,
      initCoinNonce,
      tokenDomain,
      signerCommitments,
      2n,
    ),
  );

  session.contract = contract;
  await refreshSummary(session, status);
  remember(session.activity, 'success', `Contract deployed: ${shortHex(contract.deployTxData.public.contractAddress, 16, 12)}.`);
  remember(session.activity, 'info', 'Policy: any 2 of the 3 demo signer keys can approve mint or burn.');
  guide(session, 'Ready', 'Contract deployed. Next, mint to this wallet or run the full guided flow.', 'success');
}

async function mintToWallet(
  ask: PromptReader,
  walletCtx: WalletContext,
  session: Session,
  status: StatusRenderer,
): Promise<void> {
  const contract = requireContract(session);
  guide(session, 'Mint amount', 'Choose how many shielded tokens to mint to this wallet.', 'prompt');
  const amount = await askUint64(ask, 'Mint amount [100]', 100n);
  const approval = await selectApprovals(ask, session);
  const recipient = zswapRecipient(getWalletZswapKey(walletCtx));

  guide(session, 'Minting', 'Submitting an OZ V3 mint authorized by the selected demo signers.', 'guide');
  const result = await withLiveInfo(status, `Minting ${amount} to this wallet...`, () =>
    api.mint(
      session.providers,
      contract,
      amount,
      recipient,
      approval.pubkeys,
      approval.signatures,
    ),
  );

  await refreshSummary(session, status);
  const tokenType = requireTokenType(session);
  await withLiveInfo(status, 'Waiting for the minted wallet coin to appear...', () =>
    waitForWalletCoins(walletCtx, tokenType, amount),
  );
  const balance = await api.getShieldedTokenBalance(walletCtx.wallet, tokenType);

  remember(session.activity, 'success', `Mint tx: ${shortHex(result.tx.txId, 16, 12)}.`);
  remember(session.activity, 'info', `Wallet token balance is now ${balance}.`);
  guide(session, 'Minted', 'The wallet now has a spendable coin for this token color.', 'success');
}

async function burnWalletCoin(
  ask: PromptReader,
  walletCtx: WalletContext,
  session: Session,
  status: StatusRenderer,
): Promise<void> {
  const contract = requireContract(session);
  const tokenType = requireTokenType(session);
  const coins = await withLiveInfo(status, 'Reading spendable wallet coins for this token color...', () =>
    api.getSpendableShieldedTokenCoins(walletCtx.wallet, tokenType),
  );
  if (coins.length === 0) {
    throw new Error('No spendable wallet coin found for this token. Mint to this wallet first, or use manual burn with known qualified fields.');
  }

  guide(session, 'Burn coin', 'Choose a wallet coin. For the demo, burning the full selected coin is easiest to track.', 'prompt');
  const coin = await chooseCoin(ask, coins);
  const amount = await askUint64(ask, `Burn amount [${coin.value}]`, coin.value);
  if (amount > coin.value) {
    throw new Error(`Burn amount ${amount} exceeds selected coin value ${coin.value}`);
  }

  const burnCoin = { ...coin, mt_index: 0n };
  remember(session.activity, 'info', `Using wallet coin value=${coin.value}; OZ burn spends contract-local mt_index=0 after receiveShielded.`);
  const approval = await selectApprovals(ask, session);

  guide(session, 'Burning', 'Submitting exact OZ V3 burn to shieldedBurnAddress().', 'guide');
  const result = await withLiveInfo(status, `Burning ${amount} through exact OZ V3 burn...`, () =>
    api.burn(contract, burnCoin, amount, approval.pubkeys, approval.signatures),
  );
  await refreshSummary(session, status);
  const balance = await api.getShieldedTokenBalance(walletCtx.wallet, tokenType);

  remember(session.activity, 'success', `Burn tx: ${shortHex(result.tx.txId, 16, 12)}.`);
  remember(session.activity, 'info', `Wallet token balance is now ${balance}.`);
  guide(session, 'Burn complete', 'The selected coin was received by the contract and sent to shieldedBurnAddress().', 'success');
}

async function manualBurn(
  ask: PromptReader,
  session: Session,
  status: StatusRenderer,
): Promise<void> {
  const contract = requireContract(session);
  const tokenColor = session.tokenType ?? '';
  guide(session, 'Manual burn', 'Enter qualified coin fields exactly: color, nonce, value, and mt_index.', 'warn');
  const colorHex = await askDefault(ask, `Coin color hex [${tokenColor}]`, tokenColor);
  const nonceHex = await askRequired(ask, 'Coin nonce hex');
  const value = await askUint64(ask, 'Coin value [100]', 100n);
  const mtIndex = await askBigInt(ask, 'Coin mt_index [0]', 0n);
  const amount = await askUint64(ask, `Burn amount [${value}]`, value);
  const coin: CompactQualifiedShieldedCoin = {
    color: hexToBytes32(colorHex, 'Coin color'),
    nonce: hexToBytes32(nonceHex, 'Coin nonce'),
    value,
    mt_index: mtIndex,
  };
  const approval = await selectApprovals(ask, session);
  const result = await withLiveInfo(status, `Submitting manual burn for ${amount}...`, () =>
    api.burn(contract, coin, amount, approval.pubkeys, approval.signatures),
  );
  await refreshSummary(session, status);
  remember(session.activity, 'success', `Manual burn tx: ${shortHex(result.tx.txId, 16, 12)}.`);
  guide(session, 'Manual burn sent', 'The manually supplied qualified coin was submitted to the OZ V3 burn circuit.', 'success');
}

async function joinExisting(
  ask: PromptReader,
  session: Session,
  status: StatusRenderer,
): Promise<void> {
  guide(session, 'Join', 'Paste an existing OZ V3 contract address. Joined contracts are view/burn only unless local demo keys match.', 'prompt');
  const address = await askRequired(ask, 'Contract address');
  const contract = await withLiveInfo(status, `Joining contract ${shortHex(address.trim(), 16, 12)}...`, () =>
    api.joinContract(session.providers, address.trim()),
  );
  session.contract = contract;
  session.signers = [];
  session.signerCommitments = [];
  session.tokenDomain = null;
  session.tokenType = null;
  session.counter = null;
  session.chainReadAt = null;
  await refreshSummary(session, status);
  remember(session.activity, 'success', `Joined contract: ${shortHex(contract.deployTxData.public.contractAddress, 16, 12)}.`);
  remember(session.activity, 'warn', 'Joined contracts do not restore local demo signer keys.');
  guide(session, 'Joined', 'You can refresh or burn wallet-owned coins for this token color; mint approvals require matching local demo keys.', 'warn');
}

async function refreshSummary(
  session: Session,
  status?: StatusRenderer,
): Promise<void> {
  if (!session.contract) return;
  const address = session.contract.deployTxData.public.contractAddress;
  const summary = await withLiveInfo(status, 'Querying chain for contract summary...', () =>
    api.readSummary(session.providers, address),
  );
  if (!summary) {
    session.tokenType = null;
    session.counter = null;
    session.chainReadAt = null;
    remember(session.activity, 'warn', 'Contract summary was not found on-chain.');
    return;
  }
  session.tokenDomain = summary.tokenDomain;
  session.tokenType = summary.tokenType;
  session.counter = summary.counter;
  session.chainReadAt = new Date().toLocaleTimeString();
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

async function selectApprovals(
  ask: PromptReader,
  session: Session,
): Promise<{ pubkeys: Uint8Array[]; signatures: Uint8Array[] }> {
  if (session.signers.length < 3) {
    throw new Error('No local demo signer keys available. Deploy in this session to approve operations.');
  }
  guide(session, 'Signer approvals', 'Choose any two unique local demo signer slots, for example 1,2.', 'prompt');
  const choice = await askDefault(ask, 'Choose two signer slots, e.g. 1,2 [1,2]', '1,2');
  const slots = choice
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((slot) => Number.isInteger(slot));
  const unique = [...new Set(slots)];
  if (unique.length !== 2 || unique.some((slot) => slot < 1 || slot > session.signers.length)) {
    throw new Error('Choose exactly two unique signer slots between 1 and 3');
  }
  remember(session.activity, 'info', `Selected signer slots ${unique.join(' and ')}.`);
  return {
    pubkeys: unique.map((slot) => session.signers[slot - 1].publicKey),
    signatures: unique.map(() => stubSignature()),
  };
}

async function chooseCoin(
  ask: PromptReader,
  coins: CompactQualifiedShieldedCoin[],
): Promise<CompactQualifiedShieldedCoin> {
  if (coins.length === 1) {
    return coins[0];
  }
  const index = Number.parseInt(await askDefault(ask, 'Coin slot [1]', '1'), 10);
  const coin = coins[index - 1];
  if (!coin) throw new Error('Invalid coin slot');
  return coin;
}

async function buildWallet(
  config: Config,
  rli: Interface,
  activity: DashboardMessage[],
): Promise<WalletContext | null> {
  const network = networkLabel(config);
  if (config instanceof StandaloneConfig) {
    remember(activity, 'info', 'Building local funded wallet...');
    renderSplash('wallet', `Building and syncing the ${network} demo wallet.`, activity);
    const wallet = await silenceTerminalOutput(() =>
      buildWalletAndWaitForFunds(config, GENESIS_MINT_WALLET_SEED),
    );
    remember(activity, 'success', 'Wallet ready.');
    return wallet;
  }

  while (true) {
    renderSplash('wallet setup', `Network: ${network}`, activity);
    const choice = await rli.question(dashboardPrompt('[1] Create new wallet   [2] Restore from seed   [3] Exit'));
    switch (choice.trim()) {
      case '1': {
        remember(activity, 'info', `Creating and syncing a fresh ${network} wallet...`);
        renderSplash('wallet', `Creating and syncing a fresh ${network} wallet.`, activity);
        const wallet = await silenceTerminalOutput(() => buildFreshWallet(config));
        remember(activity, 'success', 'Wallet ready.');
        return wallet;
      }
      case '2': {
        renderSplash('wallet setup', `Network: ${network}`, activity);
        const seed = await rli.question(dashboardPrompt('Enter wallet seed'));
        remember(activity, 'info', `Restoring and syncing ${network} wallet...`);
        renderSplash('wallet', `Restoring and syncing ${network} wallet.`, activity);
        const wallet = await silenceTerminalOutput(() => buildWalletAndWaitForFunds(config, seed.trim()));
        remember(activity, 'success', 'Wallet ready.');
        return wallet;
      }
      case '3':
        return null;
      default:
        remember(activity, 'warn', `Invalid wallet setup choice: ${choice || '(empty)'}.`);
    }
  }
}

async function renderLiveDashboard(
  walletCtx: WalletContext,
  session: Session,
): Promise<void> {
  const tokenType = session.tokenType;
  const [dust, tokenBalance, coins] = await Promise.all([
    getDustLabel(walletCtx),
    tokenType ? api.getShieldedTokenBalance(walletCtx.wallet, tokenType).catch(() => null) : Promise.resolve(null),
    tokenType ? api.getSpendableShieldedTokenCoins(walletCtx.wallet, tokenType).catch(() => []) : Promise.resolve([]),
  ]);

  renderDashboard({
    wallet: {
      network: session.network,
      address: walletCtx.unshieldedKeystore.getBech32Address().asString(),
      zswapKey: bytesToHex(getWalletZswapKey(walletCtx)),
      dust,
      tokenBalance,
      spendableCoinCount: coins.length,
    },
    contract: {
      address: session.contract?.deployTxData.public.contractAddress ?? null,
      tokenName: session.tokenDomain ? tokenNameFromDomain(session.tokenDomain) : null,
      tokenColor: session.tokenType,
      counter: session.counter,
      policy: session.signers.length ? `${session.threshold} of ${session.signers.length}` : '2 of 3 demo policy',
      refreshedAt: session.chainReadAt,
    },
    signers: session.signers.map((signer, index) => ({
      slot: index + 1,
      label: signer.label,
      publicKey: shortHex(bytesToHex(signer.publicKey), 12, 8),
      commitment: session.signerCommitments[index]
        ? shortHex(bytesToHex(session.signerCommitments[index]), 12, 8)
        : '-',
    })),
    coins: coins.map((coin, index): DashboardCoin => ({
      index: index + 1,
      value: coin.value,
      mtIndex: coin.mt_index,
      nonce: shortHex(bytesToHex(coin.nonce), 12, 8),
    })),
    instruction: session.guidance,
    activity: session.activity,
  });
}

async function getDustLabel(wallet: WalletContext): Promise<string> {
  try {
    const dust = await getDustBalance(wallet.wallet);
    return dust.available.toLocaleString();
  } catch {
    return 'unknown';
  }
}

function guide(
  session: Session,
  title: string,
  body: string,
  tone: DashboardInstruction['tone'] = 'guide',
): void {
  session.guidance = { title, body, tone };
}

function remember(
  activity: DashboardMessage[],
  type: DashboardMessage['type'],
  text: string,
): void {
  activity.push({ type, text });
  if (activity.length > 100) {
    activity.splice(0, activity.length - 100);
  }
}

async function withLiveInfo<T>(
  status: StatusRenderer | undefined,
  message: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (status) await status({ type: 'info', text: message });
  return await silenceTerminalOutput(fn);
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

async function askRequired(ask: PromptReader, label: string): Promise<string> {
  const value = (await ask(`${label}:`)).trim();
  if (!value) throw new Error(`${label} is required`);
  return value;
}

async function askDefault(ask: PromptReader, label: string, defaultValue: string): Promise<string> {
  const value = (await ask(`${label}:`)).trim();
  return value || defaultValue;
}

async function askYesNo(ask: PromptReader, label: string, defaultValue: boolean): Promise<boolean> {
  const suffix = defaultValue ? 'Y/n' : 'y/N';
  const value = (await ask(`${label} [${suffix}]:`)).trim().toLowerCase();
  if (!value) return defaultValue;
  return value === 'y' || value === 'yes';
}

async function askUint64(ask: PromptReader, label: string, defaultValue: bigint): Promise<bigint> {
  const value = await askBigInt(ask, label, defaultValue);
  if (value < 0n || value > UINT64_MAX) {
    throw new Error(`${label} must fit in Uint<64>`);
  }
  return value;
}

async function askBigInt(ask: PromptReader, label: string, defaultValue: bigint): Promise<bigint> {
  const raw = await askDefault(ask, label, defaultValue.toString());
  try {
    return BigInt(raw.replace(/_/g, ''));
  } catch {
    throw new Error(`${label} must be an integer`);
  }
}

const networkLabel = (config: Config): string => {
  if (config instanceof StandaloneConfig) return 'undeployed';
  return config.node.includes('preview') ? 'preview' : 'preprod';
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isAbortError = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('Aborted with Ctrl+C') || message.includes('readline was closed');
};

const silentLogger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
} as unknown as Logger;

const silenceTerminalOutput = async <T>(fn: () => Promise<T>): Promise<T> => {
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  const consoleLog = console.log;
  const consoleWarn = console.warn;
  const consoleError = console.error;

  try {
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    console.log = () => undefined;
    console.warn = () => undefined;
    console.error = () => undefined;
    return await fn();
  } finally {
    process.stdout.write = stdoutWrite as typeof process.stdout.write;
    process.stderr.write = stderrWrite as typeof process.stderr.write;
    console.log = consoleLog;
    console.warn = consoleWarn;
    console.error = consoleError;
  }
};

const muteBackgroundTerminalNoise = (): (() => void) => {
  const stderrWrite = process.stderr.write.bind(process.stderr);
  const consoleLog = console.log;
  const consoleWarn = console.warn;
  const consoleError = console.error;

  process.stderr.write = (() => true) as typeof process.stderr.write;
  console.log = () => undefined;
  console.warn = () => undefined;
  console.error = () => undefined;

  return () => {
    process.stderr.write = stderrWrite as typeof process.stderr.write;
    console.log = consoleLog;
    console.warn = consoleWarn;
    console.error = consoleError;
  };
};
