import { c, DIVIDER } from '@mnf-se/common';

const WIDTH = 64;
const BOX_W = WIDTH - 4;

export type TokenDisplayState = {
  owner: string;
  totalSupply: bigint;
  domainSeparator: string;
} | null;

export type WalletDisplayState = {
  address: string;
  zswapPublicKey: string;
  unshieldedBalance: bigint;
  shieldedNightBalance: bigint;
  tokenBalance: bigint;
  tokenColor: string;
};

export type Message = { text: string; type: 'success' | 'error' | 'info' };

export type RenderOptions = {
  role: 'authority' | 'user';
  state: TokenDisplayState;
  contractAddress: string;
  wallet?: WalletDisplayState;
  message?: Message;
};

function center(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text + ' '.repeat(Math.max(0, width - pad - text.length));
}

function boxRow(border: string, label: string, value: string, valueLen: number, labelW = 14): string {
  const contentW = BOX_W - 4;
  const pad = Math.max(0, contentW - labelW - valueLen);
  return `  ${border}|${c.reset} ${c.gray}${label}${c.reset}${' '.repeat(labelW - label.length)}${value}${' '.repeat(pad)}${border}|${c.reset}`;
}

export function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

export function renderScreen(opts: RenderOptions): void {
  clearScreen();

  const { role, state, contractAddress, message, wallet } = opts;
  const accent = role === 'authority' ? c.cyan : c.green;
  const title = role === 'authority' ? 'SHIELDED TOKEN - AUTHORITY' : 'SHIELDED TOKEN - USER';
  const lines: string[] = [];

  lines.push('');
  lines.push(`  ${accent}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
  lines.push(`  ${accent}|${c.bold}${center(title, WIDTH - 2)}${c.reset}${accent}|${c.reset}`);
  lines.push(`  ${accent}|${c.reset}${center('MNF Solutions Engineering', WIDTH - 2)}${accent}|${c.reset}`);
  lines.push(`  ${accent}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
  lines.push('');

  if (state) {
    const shortAddr = contractAddress.length > 48
      ? contractAddress.substring(0, 48) + '...'
      : contractAddress;
    lines.push(`    ${c.gray}Contract${c.reset}      ${shortAddr}`);
    lines.push('');

    const pub = c.blue;
    lines.push(`  ${pub}+${'─'.repeat(BOX_W - 2)}+${c.reset}`);
    lines.push(`  ${pub}|${c.reset} ${pub}${c.bold}CONTRACT STATE${c.reset} ${c.dim}(on-chain)${c.reset}${' '.repeat(Math.max(0, BOX_W - 28))}${pub}|${c.reset}`);
    lines.push(`  ${pub}|${c.reset}${' '.repeat(BOX_W - 2)}${pub}|${c.reset}`);

    lines.push(boxRow(pub, 'Token Name', `${c.white}${c.bold}${state.domainSeparator || '(empty)'}${c.reset}`, (state.domainSeparator || '(empty)').length));

    const shortOwner = state.owner.substring(0, 16) + '...' + state.owner.substring(48);
    lines.push(boxRow(pub, 'Owner', `${c.dim}${shortOwner}${c.reset}`, shortOwner.length));

    const supplyStr = state.totalSupply.toString();
    lines.push(boxRow(pub, 'Total Supply', `${c.yellow}${c.bold}${supplyStr}${c.reset}`, supplyStr.length));

    lines.push(`  ${pub}+${'─'.repeat(BOX_W - 2)}+${c.reset}`);
    lines.push('');

    if (wallet) {
      const wlt = c.magenta;
      lines.push(`  ${wlt}+${'─'.repeat(BOX_W - 2)}+${c.reset}`);
      lines.push(`  ${wlt}|${c.reset} ${wlt}${c.bold}WALLET${c.reset} ${c.dim}(local)${c.reset}${' '.repeat(Math.max(0, BOX_W - 18))}${wlt}|${c.reset}`);
      lines.push(`  ${wlt}|${c.reset}${' '.repeat(BOX_W - 2)}${wlt}|${c.reset}`);

      const shortWalletAddr = wallet.address.length > 36
        ? wallet.address.substring(0, 36) + '...'
        : wallet.address;
      lines.push(boxRow(wlt, 'Address', `${c.dim}${shortWalletAddr}${c.reset}`, shortWalletAddr.length));

      const nightStr = wallet.unshieldedBalance.toString();
      lines.push(boxRow(wlt, 'NIGHT', `${c.white}${nightStr}${c.reset}`, nightStr.length));

      const tokenStr = wallet.tokenBalance.toString();
      lines.push(boxRow(wlt, 'Token Bal', `${c.green}${c.bold}${tokenStr}${c.reset}`, tokenStr.length));

      lines.push(`  ${wlt}+${'─'.repeat(BOX_W - 2)}+${c.reset}`);
      lines.push('');
    }
  } else {
    lines.push(`    ${c.dim}Loading state...${c.reset}`);
    lines.push('');
  }

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

  if (role === 'authority') {
    lines.push(`    ${accent}1${c.reset}  Mint shielded tokens`);
    lines.push(`    ${accent}2${c.reset}  Mint unshielded tokens (UTXO)`);
    lines.push(`    ${accent}3${c.reset}  View total supply`);
    lines.push(`    ${accent}4${c.reset}  View all shielded balances`);
    lines.push(`    ${accent}5${c.reset}  Refresh`);
    lines.push(`    ${accent}6${c.reset}  Exit`);
  } else {
    lines.push(`    ${accent}1${c.reset}  View token balance`);
    lines.push(`    ${accent}2${c.reset}  View all shielded balances`);
    lines.push(`    ${accent}3${c.reset}  Refresh`);
    lines.push(`    ${accent}4${c.reset}  Exit`);
  }

  lines.push('');
  lines.push(`  ${c.gray}${'─'.repeat(WIDTH)}${c.reset}`);
  lines.push('');

  process.stdout.write(lines.join('\n'));
}
