import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import type { Logger } from 'pino';

import {
  type Config,
  type WalletContext,
  StandaloneConfig,
  buildWalletAndWaitForFunds,
  buildFreshWallet,
  getDustBalance,
} from '@mnf-se/common';

import type { DeployedMultisigTokenContract, MultisigTokenProviders } from './types.js';
import * as api from './api.js';
import {
  type DashboardInstruction,
  type DashboardMessage,
  dashboardPrompt,
  enterDashboardScreen,
  exitDashboardScreen,
  renderDashboard,
  renderSplash,
} from './display.js';
import {
  bytesToHex,
  bytesToTokenName,
  contractRecipient,
  generateDemoSigners,
  hexToBytes32,
  jubjubSign,
  mintActionHash,
  mintApprovalMessageHash,
  publicKeyLabel,
  randomBytes32,
  recipientBytes,
  recipientLabel,
  signatureLabel,
  tokenNameToBytes,
  zswapRecipient,
  type DemoSigner,
  type MintRecipient,
} from './crypto.js';

let logger: Logger;

const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const UINT64_MAX = (1n << 64n) - 1n;

const STATUS_NAMES = ['Inactive', 'Active', 'Executed'];

type ProposalRecord = {
  readonly id: bigint;
  readonly amount: bigint;
  readonly recipient: MintRecipient;
  status?: string;
  approvals?: bigint | null;
};

type TokenRecord = {
  readonly sessionId: number;
  contract: DeployedMultisigTokenContract;
  summary: api.ContractSummary | null;
  chainReadAt: string | null;
  tokenName: Uint8Array | null;
  domainSeparator: Uint8Array | null;
  instanceSalt: Uint8Array | null;
  tokenColor: string | null;
  proposals: Map<string, ProposalRecord>;
  localSigners: DemoSigner[] | null;
};

type Session = {
  signers: DemoSigner[] | null;
  tokens: TokenRecord[];
  activeTokenIndex: number;
  activity: DashboardMessage[];
  guidance: DashboardInstruction | null;
};

type StatusRenderer = (message: DashboardMessage) => Promise<void>;
type PromptReader = (prompt: string) => Promise<string>;

const networkLabel = (config: Config): string => {
  if (config instanceof StandaloneConfig) return 'undeployed';
  return config.node.includes('preview') ? 'preview' : 'preprod';
};

const remember = (
  activity: DashboardMessage[],
  type: DashboardMessage['type'],
  text: string,
): void => {
  activity.push({ type, text });
  if (activity.length > 80) {
    activity.splice(0, activity.length - 80);
  }
};

const guide = (
  session: Session,
  title: string,
  body: string,
  tone: DashboardInstruction['tone'] = 'guide',
): void => {
  session.guidance = { title, body, tone };
};

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

const buildWallet = async (
  config: Config,
  rli: Interface,
  activity: DashboardMessage[],
): Promise<WalletContext | null> => {
  const net = networkLabel(config);
  if (config instanceof StandaloneConfig) {
    remember(activity, 'info', 'Building local funded wallet...');
    renderSplash('wallet', `Building wallet for ${net}. This can take a moment.`, activity);
    const wallet = await silenceTerminalOutput(() =>
      buildWalletAndWaitForFunds(config, GENESIS_MINT_WALLET_SEED),
    );
    remember(activity, 'success', 'Wallet ready.');
    return wallet;
  }

  while (true) {
    renderSplash(
      'wallet setup',
      `Network: ${net}`,
      activity,
    );
    const choice = await rli.question(dashboardPrompt('[1] Create new wallet   [2] Restore from seed   [3] Exit'));
    switch (choice.trim()) {
      case '1': {
        remember(activity, 'info', `Creating and syncing fresh ${net} wallet...`);
        renderSplash('wallet', `Creating and syncing fresh ${net} wallet.`, activity);
        const wallet = await silenceTerminalOutput(() => buildFreshWallet(config));
        remember(activity, 'success', 'Wallet ready.');
        return wallet;
      }
      case '2': {
        renderSplash('wallet setup', `Network: ${net}`, activity);
        const seed = await rli.question(dashboardPrompt('Enter wallet seed'));
        remember(activity, 'info', `Restoring and syncing ${net} wallet...`);
        renderSplash('wallet', `Restoring and syncing ${net} wallet.`, activity);
        const wallet = await silenceTerminalOutput(() => buildWalletAndWaitForFunds(config, seed.trim()));
        remember(activity, 'success', 'Wallet ready.');
        return wallet;
      }
      case '3':
        return null;
      default:
        remember(activity, 'error', `Invalid wallet setup choice: ${choice}`);
    }
  }
};

const promptYesNo = async (
  ask: PromptReader,
  prompt: string,
  defaultValue = false,
): Promise<boolean> => {
  const suffix = defaultValue ? ' [Y/n]: ' : ' [y/N]: ';
  const value = (await ask(`${prompt}${suffix}`)).trim().toLowerCase();
  if (!value) return defaultValue;
  return value === 'y' || value === 'yes';
};

const getDustLabel = async (wallet: WalletContext['wallet']): Promise<string> => {
  try {
    const dust = await getDustBalance(wallet);
    return dust.available.toLocaleString();
  } catch {
    return '';
  }
};

const getWalletZswapKey = (walletCtx: WalletContext): Uint8Array =>
  ledger.encodeCoinPublicKey(walletCtx.shieldedSecretKeys.coinPublicKey);

const getSelfRecipient = (walletCtx: WalletContext): MintRecipient =>
  zswapRecipient(getWalletZswapKey(walletCtx));

const shortHex = (hex: string): string =>
  hex.length <= 24 ? hex : `${hex.slice(0, 12)}...${hex.slice(-8)}`;

const getActiveToken = (session: Session): TokenRecord | null =>
  session.tokens[session.activeTokenIndex] ?? null;

const ensureActiveToken = (session: Session): TokenRecord => {
  const token = getActiveToken(session);
  if (!token) {
    throw new Error('No multisig token contract selected. Deploy or join one first.');
  }
  return token;
};

const getTokenAddress = (token: TokenRecord): string =>
  token.contract.deployTxData.public.contractAddress;

const getTokenName = (token: TokenRecord): string =>
  token.summary?.tokenName ?? (token.tokenName ? bytesToTokenName(token.tokenName) : `Token #${token.sessionId}`);

const getTokenColor = (token: TokenRecord): string | null =>
  token.summary?.tokenColor ?? token.tokenColor;

const getSigningSigners = (token: TokenRecord): DemoSigner[] => {
  if (token.localSigners) return token.localSigners;
  throw new Error('This token was joined without local demo signer keys. You can view or burn wallet-owned coins, but this CLI cannot approve mint proposals for it.');
};

const getDisplaySigners = (session: Session): DemoSigner[] => {
  const token = getActiveToken(session);
  return token?.localSigners ?? session.signers ?? [];
};

const getSignerScope = (session: Session): string => {
  const token = getActiveToken(session);
  if (token?.localSigners) return `active token #${token.sessionId}`;
  if (token) return `token #${token.sessionId} view/burn only`;
  if (session.signers) return 'staged for next deploy';
  return 'no key ceremony yet';
};

const addTokenRecord = (
  session: Session,
  contract: DeployedMultisigTokenContract,
  tokenName: Uint8Array | null,
  instanceSalt: Uint8Array | null,
  localSigners: DemoSigner[] | null,
): TokenRecord => {
  const token: TokenRecord = {
    sessionId: session.tokens.length + 1,
    contract,
    summary: null,
    chainReadAt: null,
    tokenName,
    domainSeparator: tokenName,
    instanceSalt,
    tokenColor: null,
    proposals: new Map(),
    localSigners: localSigners ? [...localSigners] : null,
  };
  session.tokens.push(token);
  session.activeTokenIndex = session.tokens.length - 1;
  return token;
};

const cycleActiveToken = (session: Session, delta: number): TokenRecord | null => {
  if (session.tokens.length === 0) return null;
  session.activeTokenIndex = (session.activeTokenIndex + delta + session.tokens.length) % session.tokens.length;
  return ensureActiveToken(session);
};

const updateTokenFromSummary = (token: TokenRecord, summary: api.ContractSummary): void => {
  token.summary = summary;
  token.chainReadAt = new Date().toLocaleTimeString();
  token.tokenName = tokenNameToBytes(summary.tokenName);
  token.domainSeparator = summary.domainSeparator;
  token.instanceSalt = summary.instanceSalt;
  token.tokenColor = summary.tokenColor;
};

const readLiveProposal = async (
  contract: DeployedMultisigTokenContract,
  proposal: ProposalRecord,
): Promise<ProposalRecord> => {
  try {
    const view = await api.readProposal(contract, proposal.id);
    return {
      id: proposal.id,
      amount: view.amount,
      recipient: view.recipient,
      status: STATUS_NAMES[view.status] ?? String(view.status),
      approvals: view.approvals,
    };
  } catch {
    return {
      ...proposal,
      status: proposal.status ?? 'Unknown',
      approvals: proposal.approvals ?? null,
    };
  }
};

const renderLiveDashboard = async (
  walletCtx: WalletContext,
  session: Session,
  message?: DashboardMessage,
): Promise<void> => {
  const token = getActiveToken(session);
  const summary = token?.summary ?? null;
  let dashboardMessage = message;

  const dustLabel = await getDustLabel(walletCtx.wallet);
  const tokenBalances = new Map<number, bigint | null>();
  await Promise.all(session.tokens.map(async (record) => {
    const color = getTokenColor(record);
    if (!color) {
      tokenBalances.set(record.sessionId, null);
      return;
    }
    try {
      tokenBalances.set(record.sessionId, await api.getShieldedTokenBalance(walletCtx.wallet, color));
    } catch {
      tokenBalances.set(record.sessionId, null);
    }
  }));

  const tokenColor = token ? getTokenColor(token) : null;
  let tokenBalance: bigint | null = null;
  let spendableCoinCount: number | null = null;
  if (tokenColor) {
    try {
      const [balance, coins] = await Promise.all([
        api.getShieldedTokenBalance(walletCtx.wallet, tokenColor),
        api.getSpendableShieldedTokenCoins(walletCtx.wallet, tokenColor),
      ]);
      tokenBalance = balance;
      spendableCoinCount = coins.length;
    } catch (e) {
      dashboardMessage ??= {
        type: 'error',
        text: `Live wallet read failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  const proposals = Array.from(token?.proposals.values() ?? [])
    .sort((a, b) => Number(a.id - b.id));
  const displaySigners = getDisplaySigners(session);

  renderDashboard({
    wallet: {
      address: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      zswapKey: bytesToHex(getWalletZswapKey(walletCtx)),
      dust: dustLabel,
      tokenBalance,
      spendableCoinCount,
    },
    token: {
      sessionLabel: token ? `${session.activeTokenIndex + 1}/${session.tokens.length}` : null,
      contractAddress: token ? getTokenAddress(token) : null,
      tokenName: token ? getTokenName(token) : null,
      tokenColor,
      shieldedSupply: summary?.shieldedSupply ?? null,
      burnedSupply: summary?.burnedSupply ?? null,
      circulatingSupply: summary?.circulatingSupply ?? null,
      signerCount: summary?.signerCount ?? null,
      threshold: summary?.threshold ?? (displaySigners.length > 0 ? 2n : null),
      nextProposalId: summary?.nextProposalId ?? null,
      executedCount: summary?.executedCount ?? null,
      refreshedAt: token?.chainReadAt ?? null,
      signerStatus: token ? token.localSigners ? 'ready' : 'view-only' : null,
    },
    tokens: session.tokens.map((record, index) => ({
      index: index + 1,
      label: getTokenName(record),
      contractAddress: getTokenAddress(record),
      selected: index === session.activeTokenIndex,
      signerStatus: record.localSigners ? 'ready' : 'view-only',
      balance: tokenBalances.get(record.sessionId) ?? null,
    })),
    signers: displaySigners.map((signer, index) => ({
      slot: index + 1,
      label: signer.label,
      publicKey: publicKeyLabel(signer.publicKey),
    })),
    signerScope: getSignerScope(session),
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      amount: proposal.amount,
      recipient: recipientLabel(proposal.recipient),
      status: proposal.status ?? 'Local',
      approvals: proposal.approvals ?? null,
    })),
    instruction: session.guidance,
    message: dashboardMessage,
    activity: session.activity,
  });
};

const generateKeys = (): DemoSigner[] => {
  return generateDemoSigners();
};

const ensureSigners = (session: Session): DemoSigner[] => {
  if (!session.signers) {
    session.signers = generateKeys();
  }
  return session.signers;
};

const withLiveInfo = async <T>(
  status: StatusRenderer | undefined,
  text: string,
  fn: () => Promise<T>,
): Promise<T> => {
  await status?.({ type: 'info', text });
  return await silenceTerminalOutput(fn);
};

const pauseDashboard = async (
  walletCtx: WalletContext,
  session: Session,
  rli: Interface,
  text: string,
): Promise<void> => {
  guide(session, 'Next', text, 'guide');
  await renderLiveDashboard(walletCtx, session);
  await rli.question(dashboardPrompt('Press Enter to continue'));
};

const askDashboard = async (
  walletCtx: WalletContext,
  session: Session,
  rli: Interface,
  prompt: string,
): Promise<string> => {
  guide(session, 'Input', prompt, 'prompt');
  await renderLiveDashboard(walletCtx, session);
  return await rli.question(dashboardPrompt(prompt));
};

const promptTokenName = async (ask: PromptReader): Promise<Uint8Array> => {
  while (true) {
    const tokenNameInput = await ask('Token name [Demo Shielded Token]');
    try {
      return tokenNameToBytes(tokenNameInput.trim() || 'Demo Shielded Token');
    } catch (e) {
      // Re-prompt with the validation error visible in the command line.
      await ask(e instanceof Error ? e.message : String(e));
    }
  }
};

const promptAmount = async (ask: PromptReader): Promise<bigint> => {
  while (true) {
    const amountInput = await ask('Amount to mint, 1-65535 [100]');
    try {
      const amount = BigInt(amountInput.trim() || '100');
      if (amount > 0n && amount <= 65535n) {
        return amount;
      }
    } catch {
      // Fall through to the shared validation message.
    }
    await ask('Amount must be between 1 and 65535. Press Enter to retry');
  }
};

const promptBurnAmount = async (
  ask: PromptReader,
  max: bigint,
): Promise<bigint> => {
  while (true) {
    const amountInput = await ask(`Amount to burn, 1-${max} [${max}]`);
    try {
      const amount = BigInt(amountInput.trim() || max.toString());
      if (amount > 0n && amount <= max && amount <= UINT64_MAX) {
        return amount;
      }
    } catch {
      // Fall through to the shared validation message.
    }
    await ask(`Amount must be between 1 and ${max}. Press Enter to retry`);
  }
};

const promptSignerSlots = async (ask: PromptReader): Promise<[number, number]> => {
  while (true) {
    const inputText = await ask('Choose any 2 signer slots to approve, e.g. "1 3" [1 2]');
    const raw = inputText.trim() || '1 2';
    const slots = raw
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((value) => Number.parseInt(value, 10));
    const unique = Array.from(new Set(slots));
    if (
      unique.length === 2 &&
      unique.every((slot) => Number.isInteger(slot) && slot >= 1 && slot <= 3)
    ) {
      return [unique[0]!, unique[1]!];
    }
    await ask('Please enter two different slots from 1, 2, and 3. Press Enter to retry');
  }
};

const promptCoinIndex = async (
  ask: PromptReader,
  coins: readonly api.SpendableShieldedCoin[],
): Promise<number> => {
  if (coins.length === 1) {
    return 0;
  }

  while (true) {
    const value = await ask(`Select coin to burn, 1-${coins.length} [1]`);
    const index = Number.parseInt(value.trim() || '1', 10) - 1;
    if (Number.isInteger(index) && index >= 0 && index < coins.length) {
      return index;
    }
    await ask(`Please choose a coin from 1 to ${coins.length}. Press Enter to retry`);
  }
};

const promptQualifiedShieldedBurnCoin = async (
  ask: PromptReader,
  summary: api.ContractSummary,
): Promise<api.QualifiedShieldedCoin> => {
  while (true) {
    try {
      const nonceHex = await ask('Contract-owned coin nonce (64 hex chars)');
      const valueInput = await ask('Contract-owned coin value');
      const mtIndexInput = await ask('Contract-owned coin mt_index');
      const value = BigInt(valueInput.trim());
      const mt_index = BigInt(mtIndexInput.trim());

      if (value <= 0n) {
        throw new Error('Coin value must be greater than zero');
      }
      if (mt_index < 0n || mt_index > UINT64_MAX) {
        throw new Error('mt_index must be a Uint<64> value');
      }

      return {
        nonce: hexToBytes32(nonceHex, 'Coin nonce'),
        color: hexToBytes32(summary.tokenColor, 'Token color'),
        value,
        mt_index,
      };
    } catch (e) {
      await ask(`${e instanceof Error ? e.message : String(e)}. Press Enter to retry`);
    }
  }
};

const contractAddressBytes = (contractAddress: string): Uint8Array =>
  hexToBytes32(contractAddress, 'Contract address');

const promptRecipient = async (
  walletCtx: WalletContext,
  session: Session,
  ask: PromptReader,
): Promise<MintRecipient> => {
  const token = getActiveToken(session);
  remember(session.activity, 'info', 'Recipient: [1] my wallet, [2] this contract, [3] another ZSwap key, [4] another contract.');

  while (true) {
    const choice = (await ask('Recipient [1=my wallet, 2=this contract, 3=ZSwap key, 4=contract]')).trim() || '1';
    switch (choice) {
      case '1':
        return getSelfRecipient(walletCtx);
      case '2': {
        if (!token) {
          remember(session.activity, 'error', 'Deploy or join a contract before selecting this contract as recipient.');
          break;
        }
        return contractRecipient(contractAddressBytes(getTokenAddress(token)));
      }
      case '3': {
        const keyHex = await ask('Recipient ZSwap public key (64 hex chars)');
        try {
          return zswapRecipient(hexToBytes32(keyHex, 'ZSwap public key'));
        } catch (e) {
          remember(session.activity, 'error', e instanceof Error ? e.message : String(e));
          break;
        }
      }
      case '4': {
        const addrHex = await ask('Recipient contract address (64 hex chars)');
        try {
          return contractRecipient(hexToBytes32(addrHex, 'Contract address'));
        } catch (e) {
          remember(session.activity, 'error', e instanceof Error ? e.message : String(e));
          break;
        }
      }
      default:
        remember(session.activity, 'error', `Invalid recipient choice: ${choice}`);
    }
  }
};

const deployCurrent = async (
  providers: MultisigTokenProviders,
  session: Session,
  tokenName: Uint8Array,
  status?: StatusRenderer,
): Promise<DeployedMultisigTokenContract> => {
  const signers = ensureSigners(session);
  const salt = randomBytes32();
  const contract = await withLiveInfo(status, 'Deploying multisig shielded token mint controller...', () =>
    api.deploy(providers, tokenName, signers.map((s) => s.publicKey), 2n, salt),
  );
  const token = addTokenRecord(session, contract, tokenName, salt, signers);
  remember(session.activity, 'success', `Token #${token.sessionId} deployed: ${shortHex(getTokenAddress(token))}`);
  remember(session.activity, 'info', `Token name: ${bytesToTokenName(tokenName)} | threshold: 2 of 3 | signer ceremony saved for this session`);
  return contract;
};

const ensureSummary = async (
  session: Session,
  status?: StatusRenderer,
): Promise<api.ContractSummary> => {
  const token = ensureActiveToken(session);
  const summary = await withLiveInfo(status, 'Querying chain for contract summary...', () =>
    api.getContractSummary(token.contract),
  );
  updateTokenFromSummary(token, summary);
  return summary;
};

const refreshTrackedProposalViews = async (
  session: Session,
  status?: StatusRenderer,
): Promise<void> => {
  const token = ensureActiveToken(session);
  for (const proposal of token.proposals.values()) {
    const updated = await withLiveInfo(
      status,
      `Querying chain for proposal ${proposal.id}...`,
      () => readLiveProposal(token.contract, proposal),
    );
    token.proposals.set(proposal.id.toString(), updated);
  }
};

const refreshContractDashboardState = async (
  session: Session,
  status?: StatusRenderer,
): Promise<void> => {
  await ensureSummary(session, status);
  await refreshTrackedProposalViews(session, status);
};

const createMintProposal = async (
  walletCtx: WalletContext,
  session: Session,
  ask: PromptReader,
  status?: StatusRenderer,
): Promise<ProposalRecord> => {
  const token = ensureActiveToken(session);
  const summary = await ensureSummary(session, status);
  const amount = await promptAmount(ask);
  const recipient = await promptRecipient(walletCtx, session, ask);
  const actionHash = mintActionHash(summary.domainSeparator, recipient, amount);
  const { proposalId } = await withLiveInfo(status, 'Submitting mint proposal transaction...', () =>
    api.createMintProposal(token.contract, amount, recipient),
  );
  const proposal = { id: proposalId, amount, recipient, status: 'Active', approvals: 0n };
  token.proposals.set(proposalId.toString(), proposal);
  remember(session.activity, 'success', `Token #${token.sessionId} proposal ${proposalId} created for ${amount} ${summary.tokenName}`);
  remember(session.activity, 'info', `Recipient: ${recipientLabel(recipient)} | action ${shortHex(bytesToHex(actionHash))}`);
  return proposal;
};

const getProposalRecord = async (
  session: Session,
  ask: PromptReader,
  status?: StatusRenderer,
): Promise<ProposalRecord> => {
  const token = ensureActiveToken(session);
  const idInput = await ask('Proposal id');
  const id = BigInt(idInput.trim());
  const existing = token.proposals.get(id.toString());
  if (existing) return existing;

  const view = await withLiveInfo(status, `Querying chain for proposal ${id}...`, () =>
    api.readProposal(token.contract, id),
  );
  const proposal = {
    id,
    amount: view.amount,
    recipient: view.recipient,
    status: STATUS_NAMES[view.status] ?? String(view.status),
    approvals: view.approvals,
  };
  token.proposals.set(id.toString(), proposal);
  remember(session.activity, 'info', `Token #${token.sessionId} proposal ${id}: ${STATUS_NAMES[view.status] ?? view.status}, approvals ${view.approvals}`);
  return proposal;
};

const approveWithSlots = async (
  session: Session,
  ask: PromptReader,
  selectedProposal?: ProposalRecord,
  status?: StatusRenderer,
): Promise<void> => {
  const token = ensureActiveToken(session);
  const signers = getSigningSigners(token);
  const summary = await ensureSummary(session, status);
  const proposal = selectedProposal ?? await getProposalRecord(session, ask, status);
  const slots = await promptSignerSlots(ask);
  const messageHash = mintApprovalMessageHash(
    summary.instanceSalt,
    proposal.id,
    summary.domainSeparator,
    proposal.recipient,
    proposal.amount,
  );

  remember(session.activity, 'info', `Signing proposal ${proposal.id}: ${proposal.amount} to ${recipientLabel(proposal.recipient)}`);
  remember(session.activity, 'info', `Approval message hash: ${shortHex(bytesToHex(messageHash))}`);

  for (const slot of slots) {
    const signer = signers[slot - 1]!;
    const signature = jubjubSign(signer.secret, messageHash);
    remember(session.activity, 'info', `${signer.label} signed: ${signatureLabel(signature)}`);
    await withLiveInfo(status, `Submitting ${signer.label} approval for proposal ${proposal.id}...`, () =>
      api.approveMintProposal(token.contract, proposal.id, signer.publicKey, signature),
    );
  }

  proposal.status = 'Active';
  proposal.approvals = BigInt(slots.length);
  remember(session.activity, 'success', `Submitted ${slots.length} approvals for proposal ${proposal.id}.`);
};

const executeMintProposal = async (
  session: Session,
  ask: PromptReader,
  selectedProposal?: ProposalRecord,
  status?: StatusRenderer,
): Promise<void> => {
  const token = ensureActiveToken(session);
  const proposal = selectedProposal ?? await getProposalRecord(session, ask, status);
  const result = await withLiveInfo(status, `Executing approved mint proposal ${proposal.id}...`, () =>
    api.executeMintProposal(token.contract, proposal.id),
  );
  proposal.status = 'Executed';
  token.tokenColor = bytesToHex(result.coin.color);
  remember(session.activity, 'success', `Proposal ${proposal.id} executed. Minted ${result.coin.value}.`);
  remember(session.activity, 'info', `Minted coin color: ${shortHex(bytesToHex(result.coin.color))}`);
};

const burnToShieldedBurnAddress = async (
  walletCtx: WalletContext,
  session: Session,
  ask: PromptReader,
  status?: StatusRenderer,
): Promise<void> => {
  const token = ensureActiveToken(session);
  const summary = await ensureSummary(session, status);

  remember(session.activity, 'info', 'Burn-address flow sends tokens to shieldedBurnAddress().');
  remember(session.activity, 'info', `Active token color: ${shortHex(summary.tokenColor)}.`);

  const walletCoins = await withLiveInfo(status, 'Reading spendable wallet coins for burn-address flow...', () =>
    api.getSpendableShieldedTokenCoins(walletCtx.wallet, summary.tokenColor),
  );
  if (walletCoins.length > 0) {
    remember(session.activity, 'info', 'Wallet auto-select is available for demo burns.');
    walletCoins.forEach((coin, index) => {
      remember(session.activity, 'info', `[${index + 1}] value=${coin.value} mt=${coin.mt_index} nonce=${shortHex(bytesToHex(coin.nonce))}`);
    });
  } else {
    remember(session.activity, 'info', 'No wallet coins found for this token; manual operator coin entry is available.');
  }

  const source = walletCoins.length > 0
    ? (await ask('Burn source [1=auto-select wallet coin, 2=manual qualified operator coin] [1]')).trim() || '1'
    : '2';

  if (source === '1') {
    const selected = walletCoins[await promptCoinIndex(ask, walletCoins)];
    if (!selected) {
      throw new Error('No wallet coin selected');
    }
    const amount = selected.value;
    if (amount > summary.circulatingSupply) {
      throw new Error(`Burn amount ${amount} exceeds circulating supply ${summary.circulatingSupply}`);
    }

    remember(session.activity, 'info', 'Wallet auto-select burns the selected coin whole to avoid untracked contract-owned change.');
    const confirmed = await promptYesNo(
      ask,
      `Burn ${amount} from wallet coin mt_index=${selected.mt_index} to shielded burn address?`,
      false,
    );
    if (!confirmed) {
      remember(session.activity, 'info', 'Burn-address flow cancelled.');
      return;
    }

    await withLiveInfo(status, `Submitting wallet burn-address transaction for ${amount}...`, () =>
      api.burnWalletCoinToShieldedBurnAddress(token.contract, selected, amount),
    );

    const updatedSummary = await ensureSummary(session, status);
    const balance = await api.getShieldedTokenBalance(walletCtx.wallet, summary.tokenColor);
    remember(session.activity, 'success', `Wallet coin burn-address transaction submitted for ${amount}.`);
    remember(session.activity, 'info', `Wallet balance ${balance}; burned ${updatedSummary.burnedSupply}; circulating ${updatedSummary.circulatingSupply}.`);
    return;
  }

  if (source !== '2') {
    throw new Error(`Invalid burn source: ${source}`);
  }

  remember(session.activity, 'info', 'OZ-style operator burn: receiveShielded + sendShielded(shieldedBurnAddress()).');
  remember(session.activity, 'info', 'This requires a contract-owned QualifiedShieldedCoinInfo from operator/indexer state.');
  const coin = await promptQualifiedShieldedBurnCoin(ask, summary);
  const amount = await promptBurnAmount(ask, coin.value);
  if (amount > summary.circulatingSupply) {
    throw new Error(`Burn amount ${amount} exceeds circulating supply ${summary.circulatingSupply}`);
  }

  const confirmed = await promptYesNo(
    ask,
    `Submit OZ-style burn of ${amount} from contract-owned coin mt_index=${coin.mt_index}?`,
    false,
  );
  if (!confirmed) {
    remember(session.activity, 'info', 'Burn-address flow cancelled.');
    return;
  }

  await withLiveInfo(status, `Submitting operator burn-address transaction for ${amount}...`, () =>
    api.burnTokensToShieldedBurnAddress(token.contract, coin, amount),
  );

  const updatedSummary = await ensureSummary(session, status);
  remember(session.activity, 'success', `Operator burn-address transaction submitted for ${amount}.`);
  remember(session.activity, 'info', `Burned supply ${updatedSummary.burnedSupply}; circulating ${updatedSummary.circulatingSupply}.`);
  if (coin.value > amount) {
    remember(session.activity, 'info', 'Partial burn change is contract-owned and must be tracked by the operator flow.');
  }
};

const showBalance = async (
  walletCtx: WalletContext,
  session: Session,
  status?: StatusRenderer,
): Promise<void> => {
  const summary = await ensureSummary(session, status);
  const balance = await withLiveInfo(status, 'Reading shielded token balance from wallet...', () =>
    api.getShieldedTokenBalance(walletCtx.wallet, summary.tokenColor),
  );
  remember(session.activity, 'info', `${summary.tokenName} balance: ${balance}`);
  remember(session.activity, 'info', `Token color: ${shortHex(summary.tokenColor)}`);
};

const showSummary = async (
  session: Session,
  status?: StatusRenderer,
): Promise<void> => {
  const token = ensureActiveToken(session);
  const summary = await withLiveInfo(status, 'Querying chain for contract summary...', () =>
    api.getContractSummary(token.contract),
  );
  updateTokenFromSummary(token, summary);

  remember(session.activity, 'info', `Token #${token.sessionId} ${shortHex(getTokenAddress(token))} | ${summary.tokenName}`);
  remember(session.activity, 'info', `Supply minted ${summary.shieldedSupply}, burned ${summary.burnedSupply}, circulating ${summary.circulatingSupply}.`);
  remember(session.activity, 'info', `Policy ${summary.threshold} of ${summary.signerCount}; executed mints ${summary.executedCount}.`);
};

const joinExisting = async (
  providers: MultisigTokenProviders,
  session: Session,
  ask: PromptReader,
  status?: StatusRenderer,
): Promise<void> => {
  const contractAddress = await ask('Enter the contract address (hex)');
  const contract = await withLiveInfo(status, `Joining contract ${shortHex(contractAddress.trim())}...`, () =>
    api.joinContract(providers, contractAddress.trim()),
  );
  const token = addTokenRecord(session, contract, null, null, null);
  remember(session.activity, 'info', `Joined token #${token.sessionId}. Mint approvals need local signer keys from the original ceremony.`);
  await showSummary(session, status);
};

const guidedDemo = async (
  providers: MultisigTokenProviders,
  walletCtx: WalletContext,
  session: Session,
  rli: Interface,
  status?: StatusRenderer,
): Promise<void> => {
  const ask: PromptReader = (prompt) => askDashboard(walletCtx, session, rli, prompt);
  remember(session.activity, 'info', 'Guided walkthrough started.');
  remember(session.activity, 'info', 'You will create one shielded token controlled by 2-of-3 signatures.');
  guide(session, 'Guided mode', 'Follow the highlighted guide strip; operational status stays in the activity panel.');

  await pauseDashboard(
    walletCtx,
    session,
    rli,
    'Step 1/8 Key ceremony: press Enter to generate three local demo signer keys.',
  );
  session.signers = generateKeys();
  remember(session.activity, 'success', 'Signer slots 1, 2, and 3 are now mint authorities.');
  remember(session.activity, 'info', 'Policy: any 2 of the 3 demo signers can approve a mint.');
  await pauseDashboard(walletCtx, session, rli, 'Review signer panel, then press Enter to continue.');

  guide(session, 'Step 2/8', 'Name and deploy the token. The name becomes the token domain separator.');
  const tokenName = await promptTokenName(ask);
  await deployCurrent(providers, session, tokenName, status);
  await pauseDashboard(walletCtx, session, rli, 'Press Enter to propose the first shielded mint.');

  guide(session, 'Step 3/8', 'Choose the mint amount and the exact recipient the signers are approving.');
  const proposal = await createMintProposal(walletCtx, session, ask, status);
  await pauseDashboard(walletCtx, session, rli, 'Press Enter to start the signing ceremony.');

  guide(session, 'Step 4/8', 'Choose any two signer slots. The CLI signs locally, then submits the approvals.');
  await approveWithSlots(session, ask, proposal, status);
  await pauseDashboard(walletCtx, session, rli, 'Press Enter to execute the approved mint.');

  guide(session, 'Step 5/8', 'Execute the approved proposal. This is where the shielded token coin is minted.');
  await executeMintProposal(session, ask, proposal, status);
  await pauseDashboard(walletCtx, session, rli, 'Press Enter to review the contract state.');

  guide(session, 'Step 6/8', 'Review supply, burn totals, policy, and executed mint count from the active contract.');
  await showSummary(session, status);
  await pauseDashboard(walletCtx, session, rli, 'Press Enter to check your wallet balance.');

  guide(session, 'Step 7/8', 'Check the active token balance in your shielded wallet.');
  await showBalance(walletCtx, session, status);

  guide(session, 'Step 8/8', 'Optionally burn tokens by sending them to shieldedBurnAddress().');
  if (await promptYesNo(ask, 'Burn tokens to the shielded burn address now?', false)) {
    await burnToShieldedBurnAddress(walletCtx, session, ask, status);
  } else {
    remember(session.activity, 'info', 'Skipping burn. Use option 10 later.');
  }
  guide(session, 'Complete', 'Guided walkthrough complete. Use n/p to cycle session tokens or choose another action.');
  remember(session.activity, 'success', 'Guided walkthrough complete.');
};

const mainLoop = async (
  providers: MultisigTokenProviders,
  walletCtx: WalletContext,
  rli: Interface,
  initialActivity: DashboardMessage[],
): Promise<void> => {
  const session: Session = {
    signers: null,
    tokens: [],
    activeTokenIndex: 0,
    activity: [...initialActivity],
    guidance: {
      title: 'Ready',
      body: 'Choose guided mode for the walkthrough, or use the manual commands below.',
      tone: 'guide',
    },
  };
  let message: DashboardMessage | undefined;

  const showStatus: StatusRenderer = async (statusMessage) => {
    remember(session.activity, statusMessage.type, statusMessage.text);
    await renderLiveDashboard(walletCtx, session);
  };
  const ask: PromptReader = (prompt) => askDashboard(walletCtx, session, rli, prompt);

  while (true) {
    await renderLiveDashboard(walletCtx, session, message);
    message = undefined;
    const choice = await rli.question(dashboardPrompt('Select action'));
    try {
      switch (choice.trim()) {
        case '1':
          await guidedDemo(providers, walletCtx, session, rli, showStatus);
          message = { type: 'success', text: 'Guided walkthrough complete. Wallet values update live; refresh reads contract state.' };
          break;
        case '2':
          session.signers = generateKeys();
          guide(session, 'Keys staged', 'Fresh demo signer keys will control the next token you deploy.');
          message = { type: 'success', text: 'Generated three fresh demo signer keys for the next deploy. Existing session tokens keep their own key ceremony.' };
          break;
        case '3': {
          guide(session, 'Deploy token', 'Choose a token name. The current staged signer keys will become its 2-of-3 mint authority.');
          const tokenName = await promptTokenName(ask);
          await deployCurrent(providers, session, tokenName, showStatus);
          message = { type: 'success', text: 'Contract deployed. Live token state will appear in the dashboard.' };
          break;
        }
        case '4':
          guide(session, 'Join token', 'Paste an existing contract address. Joined tokens are view/burn only unless deployed in this session.');
          await joinExisting(providers, session, ask, showStatus);
          message = { type: 'success', text: 'Joined contract. Contract state was refreshed from chain.' };
          break;
        case '5':
          guide(session, 'Create proposal', 'Create a mint proposal for the active token, including amount and recipient.');
          await createMintProposal(walletCtx, session, ask, showStatus);
          message = { type: 'success', text: 'Mint proposal created. Use refresh to reread approval/status from chain.' };
          break;
        case '6':
          guide(session, 'Approve proposal', 'Choose any two signer slots for the active token ceremony.');
          await approveWithSlots(session, ask, undefined, showStatus);
          message = { type: 'success', text: 'Approvals submitted. Use refresh to reread approval count from chain.' };
          break;
        case '7':
          guide(session, 'Execute mint', 'Execute an active proposal after the threshold approvals have been submitted.');
          await executeMintProposal(session, ask, undefined, showStatus);
          message = { type: 'success', text: 'Mint executed. Wallet balance updates live; refresh rereads supply from chain.' };
          break;
        case '8':
          guide(session, 'Refresh chain', 'Reading the active token summary and tracked proposal rows from chain.');
          await refreshContractDashboardState(session, showStatus);
          message = { type: 'success', text: 'Contract and proposal rows refreshed from chain.' };
          break;
        case '9':
          guide(session, 'Refresh wallet', 'Reading shielded balances and spendable coins from the wallet state.');
          await showStatus({ type: 'info', text: 'Refreshing wallet shielded balance and spendable coins...' });
          message = { type: 'success', text: 'Wallet balance refreshed from live wallet state.' };
          break;
        case '10':
          guide(session, 'Burn', 'Auto-select a wallet coin or enter an operator qualified coin, then send to shieldedBurnAddress().');
          await burnToShieldedBurnAddress(walletCtx, session, ask, showStatus);
          message = { type: 'success', text: 'Burn submitted to shieldedBurnAddress(). Supply was refreshed from chain.' };
          break;
        case 'n':
        case 'N':
        case ']':
        case '12': {
          const token = cycleActiveToken(session, 1);
          if (token) {
            guide(session, 'Active token', `Now viewing token #${token.sessionId}: ${getTokenName(token)}.`);
          } else {
            guide(session, 'No tokens', 'Deploy or join a token before cycling.', 'warn');
          }
          message = token
            ? { type: 'info', text: `Active token is now #${token.sessionId}: ${getTokenName(token)}.` }
            : { type: 'error', text: 'No session tokens to cycle. Deploy or join one first.' };
          break;
        }
        case 'p':
        case 'P':
        case '[':
        case '13': {
          const token = cycleActiveToken(session, -1);
          if (token) {
            guide(session, 'Active token', `Now viewing token #${token.sessionId}: ${getTokenName(token)}.`);
          } else {
            guide(session, 'No tokens', 'Deploy or join a token before cycling.', 'warn');
          }
          message = token
            ? { type: 'info', text: `Active token is now #${token.sessionId}: ${getTokenName(token)}.` }
            : { type: 'error', text: 'No session tokens to cycle. Deploy or join one first.' };
          break;
        }
        case '11':
          return;
        default:
          guide(session, 'Invalid choice', 'Use one of the command keys shown in the guide strip.', 'warn');
          message = { type: 'error', text: `Invalid choice: ${choice}` };
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const assertMatch = raw.match(/failed assert:\s*(.+)/);
      const text = assertMatch ? assertMatch[1] : raw;
      guide(session, 'Needs attention', text, 'warn');
      message = { type: 'error', text };
    }
  }
};

export const run = async (config: Config, _logger: Logger): Promise<void> => {
  logger = _logger;
  api.setLogger(_logger);

  const rli = createInterface({ input, output, terminal: true });
  const startupActivity: DashboardMessage[] = [
    { type: 'info', text: `Starting multisig token CLI on ${networkLabel(config)}.` },
  ];

  try {
    enterDashboardScreen();
    renderSplash('startup', 'Preparing Midnight multisig token CLI...', startupActivity);
    const walletCtx = await buildWallet(config, rli, startupActivity);
    if (walletCtx === null) return;

    try {
      remember(startupActivity, 'info', 'Configuring providers...');
      renderSplash('providers', 'Configuring Midnight providers...', startupActivity);
      const providers = await silenceTerminalOutput(() => api.configureProviders(walletCtx, config));
      remember(startupActivity, 'success', 'Providers ready.');
      await mainLoop(providers, walletCtx, rli, startupActivity);
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
    exitDashboardScreen();
    logger.info('Goodbye.');
  }
};
