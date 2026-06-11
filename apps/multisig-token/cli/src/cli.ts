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
  withStatus,
} from '@mnf-se/common';

import type { DeployedMultisigTokenContract, MultisigTokenProviders } from './types.js';
import * as api from './api.js';
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
const DIVIDER = '-'.repeat(76);
const GUIDED_STEP_COUNT = 7;

const BANNER = `
${DIVIDER}
  Midnight Multisig Shielded Token Mint
  2-of-3 Schnorr approvals control shielded ZSwap token minting.
  No ownPublicKey() authorization.
${DIVIDER}
`;

const WALLET_MENU = `
${DIVIDER}
  Wallet Setup
${DIVIDER}
  [1] Create a new wallet
  [2] Restore wallet from seed
  [3] Exit
${DIVIDER}
> `;

const MENU = `
${DIVIDER}
  Multisig Token Actions
${DIVIDER}
  [1] Guided key ceremony + shielded mint walkthrough
  [2] Generate fresh demo signer keys
  [3] Deploy token mint controller with current keys
  [4] Join existing contract
  [5] Create shielded mint proposal
  [6] Sign and submit approvals with any 2 keys
  [7] Execute approved mint proposal
  [8] Show contract summary
  [9] Show my shielded token balance
  [10] Exit
${DIVIDER}
> `;

const STATUS_NAMES = ['Inactive', 'Active', 'Executed'];

type ProposalRecord = {
  readonly id: bigint;
  readonly amount: bigint;
  readonly recipient: MintRecipient;
};

type Session = {
  signers: DemoSigner[] | null;
  contract: DeployedMultisigTokenContract | null;
  tokenName: Uint8Array | null;
  domainSeparator: Uint8Array | null;
  instanceSalt: Uint8Array | null;
  tokenColor: string | null;
  proposals: Map<string, ProposalRecord>;
};

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
        return await buildWalletAndWaitForFunds(config, seed.trim());
      }
      case '3':
        return null;
      default:
        console.log(`  Invalid choice: ${choice}`);
    }
  }
};

const guideStep = (step: number, title: string, detail: string): void => {
  console.log(`\n  Step ${step}/${GUIDED_STEP_COUNT}: ${title}`);
  console.log(`  ${detail}\n`);
};

const waitForEnter = async (rli: Interface, prompt = 'Press Enter to continue.'): Promise<void> => {
  await rli.question(`  ${prompt}`);
  console.log();
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

const generateKeys = (): DemoSigner[] => {
  const signers = generateDemoSigners();
  console.log('\n  Generated 3 local demo signing keys:\n');
  for (let i = 0; i < signers.length; i++) {
    console.log(`  [${i + 1}] ${signers[i]!.label}: ${publicKeyLabel(signers[i]!.publicKey)}`);
  }
  console.log('\n  These are local demo keys. The contract only stores the public keys.\n');
  return signers;
};

const ensureSigners = (session: Session): DemoSigner[] => {
  if (!session.signers) {
    session.signers = generateKeys();
  }
  return session.signers;
};

const ensureContract = (session: Session): DeployedMultisigTokenContract => {
  if (!session.contract) {
    throw new Error('No multisig token contract selected. Deploy or join one first.');
  }
  return session.contract;
};

const promptTokenName = async (rli: Interface): Promise<Uint8Array> => {
  while (true) {
    const tokenNameInput = await rli.question('Token name [Demo Shielded Token]: ');
    try {
      return tokenNameToBytes(tokenNameInput.trim() || 'Demo Shielded Token');
    } catch (e) {
      console.log(`  ${e instanceof Error ? e.message : String(e)}`);
    }
  }
};

const promptAmount = async (rli: Interface): Promise<bigint> => {
  while (true) {
    const amountInput = await rli.question('Amount to mint, 1-65535 [100]: ');
    try {
      const amount = BigInt(amountInput.trim() || '100');
      if (amount > 0n && amount <= 65535n) {
        return amount;
      }
    } catch {
      // Fall through to the shared validation message.
    }
    console.log('  Amount must be between 1 and 65535.');
  }
};

const promptSignerSlots = async (rli: Interface): Promise<[number, number]> => {
  while (true) {
    const inputText = await rli.question(
      'Choose any 2 signer slots to approve, e.g. "1 3" [1 2]: ',
    );
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
    console.log('  Please enter two different slots from 1, 2, and 3.');
  }
};

const contractAddressBytes = (contractAddress: string): Uint8Array =>
  hexToBytes32(contractAddress, 'Contract address');

const promptRecipient = async (
  walletCtx: WalletContext,
  session: Session,
  rli: Interface,
): Promise<MintRecipient> => {
  const contract = session.contract;
  console.log('\n  Recipient');
  console.log('  [1] My shielded wallet (recommended)');
  console.log('  [2] This contract address (treasury-style recipient)');
  console.log('  [3] Another shielded wallet ZSwap public key');
  console.log('  [4] Another contract address');

  while (true) {
    const choice = (await rli.question('> ')).trim() || '1';
    switch (choice) {
      case '1':
        return getSelfRecipient(walletCtx);
      case '2': {
        if (!contract) {
          console.log('  Deploy or join a contract before selecting this contract as recipient.');
          break;
        }
        return contractRecipient(contractAddressBytes(contract.deployTxData.public.contractAddress));
      }
      case '3': {
        const keyHex = await rli.question('Recipient ZSwap public key (64 hex chars): ');
        try {
          return zswapRecipient(hexToBytes32(keyHex, 'ZSwap public key'));
        } catch (e) {
          console.log(`  ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
      }
      case '4': {
        const addrHex = await rli.question('Recipient contract address (64 hex chars): ');
        try {
          return contractRecipient(hexToBytes32(addrHex, 'Contract address'));
        } catch (e) {
          console.log(`  ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
      }
      default:
        console.log(`  Invalid choice: ${choice}`);
    }
  }
};

const deployCurrent = async (
  providers: MultisigTokenProviders,
  session: Session,
  tokenName: Uint8Array,
): Promise<DeployedMultisigTokenContract> => {
  const signers = ensureSigners(session);
  const salt = randomBytes32();
  const contract = await withStatus('Deploying multisig shielded token mint controller', () =>
    api.deploy(providers, tokenName, signers.map((s) => s.publicKey), 2n, salt),
  );
  session.contract = contract;
  session.tokenName = tokenName;
  session.domainSeparator = tokenName;
  session.instanceSalt = salt;
  session.tokenColor = null;

  console.log(`\n  Contract deployed at: ${contract.deployTxData.public.contractAddress}`);
  console.log(`  Token name: ${bytesToTokenName(tokenName)}`);
  console.log('  Threshold: 2 of 3');
  console.log(`  Instance salt: ${bytesToHex(salt)}\n`);
  return contract;
};

const ensureSummary = async (
  session: Session,
): Promise<api.ContractSummary> => {
  const contract = ensureContract(session);
  const summary = await api.getContractSummary(contract);
  session.tokenName = tokenNameToBytes(summary.tokenName);
  session.domainSeparator = summary.domainSeparator;
  session.instanceSalt = summary.instanceSalt;
  session.tokenColor = summary.tokenColor;
  return summary;
};

const createMintProposal = async (
  walletCtx: WalletContext,
  session: Session,
  rli: Interface,
): Promise<ProposalRecord> => {
  const contract = ensureContract(session);
  const summary = await ensureSummary(session);
  const amount = await promptAmount(rli);
  const recipient = await promptRecipient(walletCtx, session, rli);
  const actionHash = mintActionHash(summary.domainSeparator, recipient, amount);
  const { proposalId } = await withStatus('Creating mint proposal', () =>
    api.createMintProposal(contract, amount, recipient),
  );
  const proposal = { id: proposalId, amount, recipient };
  session.proposals.set(proposalId.toString(), proposal);

  console.log(`\n  Proposal ${proposalId} created`);
  console.log(`  Token: ${summary.tokenName}`);
  console.log(`  Amount: ${amount}`);
  console.log(`  Recipient: ${recipientLabel(recipient)}`);
  console.log(`  Mint action hash: ${bytesToHex(actionHash)}\n`);
  return proposal;
};

const getProposalRecord = async (
  contract: DeployedMultisigTokenContract,
  session: Session,
  rli: Interface,
): Promise<ProposalRecord> => {
  const idInput = await rli.question('Proposal id: ');
  const id = BigInt(idInput.trim());
  const existing = session.proposals.get(id.toString());
  if (existing) return existing;

  const view = await withStatus('Reading mint proposal', () => api.readProposal(contract, id));
  const proposal = {
    id,
    amount: view.amount,
    recipient: view.recipient,
  };
  session.proposals.set(id.toString(), proposal);
  console.log(`  Proposal status: ${STATUS_NAMES[view.status] ?? view.status}`);
  console.log(`  Approvals: ${view.approvals}`);
  return proposal;
};

const approveWithSlots = async (
  session: Session,
  rli: Interface,
  selectedProposal?: ProposalRecord,
): Promise<void> => {
  const contract = ensureContract(session);
  const signers = ensureSigners(session);
  const summary = await ensureSummary(session);
  const proposal = selectedProposal ?? await getProposalRecord(contract, session, rli);
  const slots = await promptSignerSlots(rli);
  const messageHash = mintApprovalMessageHash(
    summary.instanceSalt,
    proposal.id,
    summary.domainSeparator,
    proposal.recipient,
    proposal.amount,
  );

  console.log(`\n  Signing mint proposal ${proposal.id}`);
  console.log(`  Amount: ${proposal.amount}`);
  console.log(`  Recipient: ${recipientLabel(proposal.recipient)}`);
  console.log(`  Approval message hash: ${bytesToHex(messageHash)}\n`);

  for (const slot of slots) {
    const signer = signers[slot - 1]!;
    const signature = jubjubSign(signer.secret, messageHash);
    console.log(`  ${signer.label} signed: ${signatureLabel(signature)}`);
    await withStatus(`Submitting ${signer.label} approval`, () =>
      api.approveMintProposal(contract, proposal.id, signer.publicKey, signature),
    );
  }

  console.log(`\n  Submitted ${slots.length} approvals. Proposal ${proposal.id} is ready to execute.\n`);
};

const executeMintProposal = async (
  session: Session,
  rli: Interface,
  selectedProposal?: ProposalRecord,
): Promise<void> => {
  const contract = ensureContract(session);
  const proposal = selectedProposal ?? await getProposalRecord(contract, session, rli);
  const result = await withStatus('Executing approved mint proposal', () =>
    api.executeMintProposal(contract, proposal.id),
  );
  console.log(`\n  Proposal ${proposal.id} executed`);
  console.log(`  Minted coin value: ${result.coin.value}`);
  console.log(`  Minted coin color: ${bytesToHex(result.coin.color)}`);
  console.log(`  Recipient: ${recipientLabel(proposal.recipient)}\n`);
};

const showBalance = async (
  walletCtx: WalletContext,
  session: Session,
): Promise<void> => {
  const summary = await ensureSummary(session);
  const balance = await api.getShieldedTokenBalance(walletCtx.wallet, summary.tokenColor);
  console.log(`\n  Token: ${summary.tokenName}`);
  console.log(`  Token color: ${summary.tokenColor}`);
  console.log(`  My shielded balance: ${balance}\n`);
};

const showSummary = async (
  session: Session,
): Promise<void> => {
  const contract = ensureContract(session);
  const summary = await api.getContractSummary(contract);
  session.tokenName = tokenNameToBytes(summary.tokenName);
  session.domainSeparator = summary.domainSeparator;
  session.instanceSalt = summary.instanceSalt;
  session.tokenColor = summary.tokenColor;

  console.log(`\n  Contract: ${contract.deployTxData.public.contractAddress}`);
  console.log(`  Token name: ${summary.tokenName}`);
  console.log(`  Token color: ${summary.tokenColor}`);
  console.log(`  Shielded supply: ${summary.shieldedSupply}`);
  console.log(`  Signers: ${summary.signerCount}`);
  console.log(`  Threshold: ${summary.threshold}`);
  console.log(`  Last proposal id: ${summary.nextProposalId}`);
  console.log(`  Executed mint proposals: ${summary.executedCount}`);
  console.log(`  Instance salt: ${bytesToHex(summary.instanceSalt)}\n`);
};

const joinExisting = async (
  providers: MultisigTokenProviders,
  session: Session,
  rli: Interface,
): Promise<void> => {
  const contractAddress = await rli.question('Enter the contract address (hex): ');
  const contract = await withStatus('Joining contract', () =>
    api.joinContract(providers, contractAddress.trim()),
  );
  session.contract = contract;
  await showSummary(session);
};

const guidedDemo = async (
  providers: MultisigTokenProviders,
  walletCtx: WalletContext,
  session: Session,
  rli: Interface,
): Promise<void> => {
  console.log(`\n${DIVIDER}`);
  console.log('  Guided Key Ceremony + Shielded Mint Walkthrough');
  console.log(`${DIVIDER}`);
  console.log('  You will create one shielded token and control its minting with 2-of-3 signatures.');
  console.log('  The wallet pays transaction fees; authorization comes from Schnorr signatures.\n');

  guideStep(
    1,
    'Key ceremony',
    'In a real multisig, each signer would bring their own key. Here the CLI creates all three demo signer keys locally.',
  );
  await waitForEnter(rli, 'Press Enter to generate the three signer keys.');
  session.signers = generateKeys();
  console.log('  Ceremony result: signer slots 1, 2, and 3 are now the mint authorities.');
  console.log('  Policy for this demo: any 2 of those 3 signers can approve a mint.\n');
  await waitForEnter(rli, 'Review the public keys above, then press Enter to continue.');

  guideStep(
    2,
    'Name and deploy the token',
    'Choose the token name. The name becomes the token domain separator used to derive its token color.',
  );
  const tokenName = await promptTokenName(rli);
  await deployCurrent(providers, session, tokenName);
  await waitForEnter(rli, 'Press Enter to propose the first shielded mint.');

  guideStep(
    3,
    'Choose amount and recipient',
    'Pick how many shielded tokens to mint and who receives them. The recipient is part of what the signers approve.',
  );
  const proposal = await createMintProposal(walletCtx, session, rli);
  await waitForEnter(rli, 'Press Enter to start the signing ceremony.');

  guideStep(
    4,
    'Signing ceremony',
    'Choose any two signer slots. The CLI signs the exact mint intent with those local keys.',
  );
  await approveWithSlots(session, rli, proposal);
  await waitForEnter(rli, 'Press Enter to execute the approved mint.');

  guideStep(
    5,
    'Execute mint',
    'After two valid approvals are recorded, execution mints the shielded ZSwap token to the approved recipient.',
  );
  await executeMintProposal(session, rli, proposal);
  await waitForEnter(rli, 'Press Enter to review the contract state.');

  guideStep(
    6,
    'Review contract state',
    'The summary confirms token supply, signer threshold, and executed proposal count.',
  );
  await showSummary(session);
  await waitForEnter(rli, 'Press Enter to check your wallet balance.');

  guideStep(
    7,
    'Check wallet balance',
    'If you minted to your shielded wallet, your private balance should show the new token after wallet sync.',
  );
  await showBalance(walletCtx, session);
  console.log('  Guided walkthrough complete. You can rerun it or use the manual actions.\n');
};

const mainLoop = async (
  providers: MultisigTokenProviders,
  walletCtx: WalletContext,
  rli: Interface,
): Promise<void> => {
  const session: Session = {
    signers: null,
    contract: null,
    tokenName: null,
    domainSeparator: null,
    instanceSalt: null,
    tokenColor: null,
    proposals: new Map(),
  };

  while (true) {
    const dustLabel = await getDustLabel(walletCtx.wallet);
    if (dustLabel) console.log(`\n  DUST: ${dustLabel}`);
    const choice = await rli.question(MENU);
    try {
      switch (choice.trim()) {
        case '1':
          await guidedDemo(providers, walletCtx, session, rli);
          break;
        case '2':
          session.signers = generateKeys();
          break;
        case '3': {
          const tokenName = await promptTokenName(rli);
          await deployCurrent(providers, session, tokenName);
          break;
        }
        case '4':
          await joinExisting(providers, session, rli);
          break;
        case '5':
          await createMintProposal(walletCtx, session, rli);
          break;
        case '6':
          await approveWithSlots(session, rli);
          break;
        case '7':
          await executeMintProposal(session, rli);
          break;
        case '8':
          await showSummary(session);
          break;
        case '9':
          await showBalance(walletCtx, session);
          break;
        case '10':
          return;
        default:
          console.log(`  Invalid choice: ${choice}`);
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const assertMatch = raw.match(/failed assert:\s*(.+)/);
      console.log(`\n  Failed: ${assertMatch ? assertMatch[1] : raw}\n`);
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

    console.log('\n  Wallet ready');
    console.log(`  Unshielded address: ${walletCtx.unshieldedKeystore.getBech32Address()}`);
    console.log(`  Shielded ZSwap key: ${bytesToHex(getWalletZswapKey(walletCtx))}\n`);

    try {
      const providers = await withStatus('Configuring providers', () =>
        api.configureProviders(walletCtx, config),
      );
      await mainLoop(providers, walletCtx, rli);
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
