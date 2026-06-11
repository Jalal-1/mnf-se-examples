import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
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

import type { DeployedMultisigContract, MultisigProviders } from './types.js';
import * as api from './api.js';
import {
  actionHashFromText,
  approvalMessageHash,
  bytesToHex,
  generateDemoSigners,
  jubjubSign,
  publicKeyLabel,
  randomBytes32,
  signatureLabel,
  type DemoSigner,
} from './crypto.js';

let logger: Logger;

const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const DIVIDER = '-'.repeat(72);

const BANNER = `
${DIVIDER}
  Midnight Schnorr Multisig Example
  Real in-circuit Schnorr approvals. No ownPublicKey() authorization.
  First time here? Choose option 1 for the guided walkthrough.
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
  Multisig Actions
${DIVIDER}
  [1] Guided key ceremony + approval walkthrough
  [2] Generate fresh demo signer keys
  [3] Deploy contract with current keys
  [4] Join existing contract
  [5] Create proposal
  [6] Sign and submit approvals with any 2 keys
  [7] Execute proposal
  [8] Show contract summary
  [9] Exit
${DIVIDER}
> `;

const STATUS_NAMES = ['Inactive', 'Active', 'Executed'];
const GUIDED_STEP_COUNT = 6;

const guideStep = (step: number, title: string, detail: string): void => {
  console.log(`\n  Step ${step}/${GUIDED_STEP_COUNT}: ${title}`);
  console.log(`  ${detail}\n`);
};

const waitForEnter = async (rli: Interface, prompt = 'Press Enter to continue.'): Promise<void> => {
  await rli.question(`  ${prompt}`);
  console.log();
};

type ProposalRecord = {
  readonly id: bigint;
  readonly text: string;
  readonly actionHash: Uint8Array;
};

type Session = {
  signers: DemoSigner[] | null;
  contract: DeployedMultisigContract | null;
  instanceSalt: Uint8Array | null;
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

const getDustLabel = async (wallet: WalletContext['wallet']): Promise<string> => {
  try {
    const dust = await getDustBalance(wallet);
    return dust.available.toLocaleString();
  } catch {
    return '';
  }
};

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

const deployCurrent = async (
  providers: MultisigProviders,
  session: Session,
): Promise<DeployedMultisigContract> => {
  const signers = ensureSigners(session);
  const salt = randomBytes32();
  const contract = await withStatus('Deploying 2-of-3 Schnorr multisig', () =>
    api.deploy(providers, signers.map((s) => s.publicKey), 2n, salt),
  );
  session.contract = contract;
  session.instanceSalt = salt;
  console.log(`\n  Contract deployed at: ${contract.deployTxData.public.contractAddress}`);
  console.log(`  Threshold: 2 of 3`);
  console.log(`  Instance salt: ${bytesToHex(salt)}\n`);
  return contract;
};

const ensureContract = (session: Session): DeployedMultisigContract => {
  if (!session.contract) {
    throw new Error('No multisig contract selected. Deploy or join one first.');
  }
  return session.contract;
};

const createProposal = async (
  session: Session,
  rli: Interface,
): Promise<ProposalRecord> => {
  const contract = ensureContract(session);
  const textInput = await rli.question('Action text to approve [Release demo funds]: ');
  const text = textInput.trim() || 'Release demo funds';
  const actionHash = actionHashFromText(text);
  const { proposalId } = await withStatus('Creating proposal', () =>
    api.createProposal(contract, actionHash),
  );
  const proposal = { id: proposalId, text, actionHash };
  session.proposals.set(proposalId.toString(), proposal);
  console.log(`\n  Proposal ${proposalId} created`);
  console.log(`  Action: ${text}`);
  console.log(`  Action hash: ${bytesToHex(actionHash)}\n`);
  return proposal;
};

const getProposalRecord = async (
  contract: DeployedMultisigContract,
  session: Session,
  rli: Interface,
): Promise<ProposalRecord> => {
  const idInput = await rli.question('Proposal id: ');
  const id = BigInt(idInput.trim());
  const existing = session.proposals.get(id.toString());
  if (existing) return existing;

  const view = await withStatus('Reading proposal action hash', () =>
    api.readProposal(contract, id),
  );
  const proposal = {
    id,
    text: '(joined proposal)',
    actionHash: view.actionHash,
  };
  session.proposals.set(id.toString(), proposal);
  return proposal;
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

const approveWithSlots = async (
  session: Session,
  rli: Interface,
  selectedProposal?: ProposalRecord,
): Promise<void> => {
  const contract = ensureContract(session);
  const signers = ensureSigners(session);
  if (!session.instanceSalt) {
    throw new Error('Missing instance salt. Deploy in this session or join a readable contract first.');
  }

  const proposal = selectedProposal ?? await getProposalRecord(contract, session, rli);
  const slots = await promptSignerSlots(rli);
  const messageHash = approvalMessageHash(session.instanceSalt, proposal.id, proposal.actionHash);

  console.log(`\n  Signing proposal ${proposal.id}`);
  console.log(`  Action hash: ${bytesToHex(proposal.actionHash)}`);
  console.log(`  Approval message hash: ${bytesToHex(messageHash)}\n`);

  for (const slot of slots) {
    const signer = signers[slot - 1]!;
    const signature = jubjubSign(signer.secret, messageHash);
    console.log(`  ${signer.label} signed: ${signatureLabel(signature)}`);
    await withStatus(`Submitting ${signer.label} approval`, () =>
      api.approveProposal(contract, proposal.id, signer.publicKey, signature),
    );
  }

  console.log(`\n  Submitted ${slots.length} approvals. Proposal ${proposal.id} is ready to execute.\n`);
};

const executeProposal = async (
  session: Session,
  rli: Interface,
  selectedProposal?: ProposalRecord,
): Promise<void> => {
  const contract = ensureContract(session);
  const proposal = selectedProposal ?? await getProposalRecord(contract, session, rli);
  const result = await withStatus('Executing proposal', () =>
    api.executeProposal(contract, proposal.id),
  );
  console.log(`\n  Proposal ${proposal.id} executed`);
  console.log(`  Executed action hash: ${bytesToHex(result.actionHash)}\n`);
};

const showSummary = async (
  providers: MultisigProviders,
  session: Session,
): Promise<void> => {
  const contract = ensureContract(session);
  const summary = await api.getContractSummary(
    providers,
    contract.deployTxData.public.contractAddress,
  );
  if (!summary) {
    console.log('  Contract state was not found by the indexer yet.\n');
    return;
  }
  session.instanceSalt = summary.instanceSalt;
  console.log(`\n  Contract: ${contract.deployTxData.public.contractAddress}`);
  console.log(`  Signers: ${summary.signerCount}`);
  console.log(`  Threshold: ${summary.threshold}`);
  console.log(`  Last proposal id: ${summary.nextProposalId}`);
  console.log(`  Executed proposals: ${summary.executedCount}`);
  console.log(`  Instance salt: ${bytesToHex(summary.instanceSalt)}\n`);
};

const guidedDemo = async (
  providers: MultisigProviders,
  session: Session,
  rli: Interface,
): Promise<void> => {
  console.log(`\n${DIVIDER}`);
  console.log('  Guided Key Ceremony + 2-of-3 Approval Walkthrough');
  console.log(`${DIVIDER}`);
  console.log('  You will act as all three demo signers on one machine.');
  console.log('  The wallet pays transaction fees, but it is not used for authorization.');
  console.log('  The contract accepts the action after any two valid signatures.\n');

  guideStep(
    1,
    'Key ceremony',
    'In a real multisig, each signer would bring their own key. Here, the CLI creates all three demo keys locally so one person can test the flow.',
  );
  await waitForEnter(rli, 'Press Enter to generate the three signer keys.');
  session.signers = generateKeys();
  console.log('  Ceremony result: signer slots 1, 2, and 3 are now the members.');
  console.log('  Policy for this demo: any 2 of those 3 signers can approve an action.\n');
  await waitForEnter(rli, 'Review the public keys above, then press Enter to continue.');

  guideStep(
    2,
    'Deploy the multisig',
    'The contract will store the three public keys, threshold 2, and a fresh instance salt for replay protection.',
  );
  await waitForEnter(rli, 'Press Enter to deploy this signer set.');
  await deployCurrent(providers, session);
  await waitForEnter(rli, 'Press Enter to create a proposal.');

  guideStep(
    3,
    'Create an action proposal',
    'Enter a short action label. The contract stores and approves the action hash.',
  );
  const proposal = await createProposal(session, rli);
  await waitForEnter(rli, 'Press Enter to start the signing ceremony.');

  guideStep(
    4,
    'Signing ceremony',
    'Pick two signer slots from 1, 2, and 3. The CLI signs the proposal message with those local keys and submits both approvals.',
  );
  await approveWithSlots(session, rli, proposal);
  await waitForEnter(rli, 'Press Enter to execute the approved proposal.');

  guideStep(
    5,
    'Execute after threshold',
    'Now that two valid approvals are recorded, the proposal can be executed.',
  );
  await executeProposal(session, rli, proposal);
  await waitForEnter(rli, 'Press Enter to review the final contract state.');

  guideStep(
    6,
    'Review final state',
    'The summary confirms the registered threshold, signer count, and executed proposal count.',
  );
  await showSummary(providers, session);
  console.log('  Guided walkthrough complete. You can rerun it or use the manual actions.\n');
};

const joinExisting = async (
  providers: MultisigProviders,
  session: Session,
  rli: Interface,
): Promise<void> => {
  const contractAddress = await rli.question('Enter the contract address (hex): ');
  const contract = await withStatus('Joining contract', () =>
    api.joinContract(providers, contractAddress.trim()),
  );
  session.contract = contract;
  await showSummary(providers, session);
};

const mainLoop = async (
  providers: MultisigProviders,
  walletCtx: WalletContext,
  rli: Interface,
): Promise<void> => {
  const session: Session = {
    signers: null,
    contract: null,
    instanceSalt: null,
    proposals: new Map(),
  };

  while (true) {
    const dustLabel = await getDustLabel(walletCtx.wallet);
    if (dustLabel) console.log(`\n  DUST: ${dustLabel}`);
    const choice = await rli.question(MENU);
    try {
      switch (choice.trim()) {
        case '1':
          await guidedDemo(providers, session, rli);
          break;
        case '2':
          session.signers = generateKeys();
          break;
        case '3':
          await deployCurrent(providers, session);
          break;
        case '4':
          await joinExisting(providers, session, rli);
          break;
        case '5':
          await createProposal(session, rli);
          break;
        case '6':
          await approveWithSlots(session, rli);
          break;
        case '7':
          await executeProposal(session, rli);
          break;
        case '8':
          await showSummary(providers, session);
          break;
        case '9':
          return;
        default:
          console.log(`  Invalid choice: ${choice}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`\n  Failed: ${msg}\n`);
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
