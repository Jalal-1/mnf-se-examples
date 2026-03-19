import { c } from '@mnf-se/common';

const WIDTH = 66;
const INNER = WIDTH - 4; // inner content width (between borders)

export type TokenDisplayState = {
  owner: string;
  shieldedSupply: bigint;
  unshieldedSupply: bigint;
  domainSeparator: string;
  tokenColor: string;
} | null;

export type WalletDisplayState = {
  address: string;
  zswapPublicKey: string;
  unshieldedBalance: bigint;
  shieldedTokenBalance: bigint;
  unshieldedTokenBalance: bigint;
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

export function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

function row(border: string, label: string, value: string, visibleValueLen: number): string {
  const labelW = 18;
  const gap = Math.max(0, INNER - 2 - labelW - visibleValueLen);
  return `  ${border}| ${c.gray}${label.padEnd(labelW)}${c.reset}${value}${' '.repeat(gap)} ${border}|${c.reset}`;
}

function sectionHeader(color: string, title: string, sub: string): string[] {
  const lines: string[] = [];
  lines.push(`  ${color}+── ${title} ${'─'.repeat(Math.max(0, INNER - title.length - 5))}+${c.reset}`);
  if (sub) {
    lines.push(`  ${color}|${c.reset} ${c.dim}${sub}${' '.repeat(Math.max(0, INNER - 2 - sub.length))}${c.reset}${color}|${c.reset}`);
    lines.push(`  ${color}|${c.reset}${' '.repeat(INNER)}${color}|${c.reset}`);
  }
  return lines;
}

function sectionFooter(color: string): string {
  return `  ${color}+${'─'.repeat(INNER)}+${c.reset}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.substring(0, max - 3) + '...' : s;
}

export function renderScreen(opts: RenderOptions): void {
  clearScreen();
  const { role, state, contractAddress, message, wallet } = opts;
  const accent = role === 'authority' ? c.cyan : c.green;
  const titleText = role === 'authority' ? 'MIDNIGHT TOKEN  ·  AUTHORITY' : 'MIDNIGHT TOKEN  ·  USER';
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────
  lines.push('');
  lines.push(`  ${accent}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
  lines.push(`  ${accent}|${c.bold}  ${titleText}${' '.repeat(Math.max(0, WIDTH - 2 - titleText.length - 2))}${c.reset}${accent}|${c.reset}`);
  lines.push(`  ${accent}|${c.reset}  ${c.dim}MNF Solutions Engineering${c.reset}${' '.repeat(Math.max(0, WIDTH - 30))}${accent}|${c.reset}`);
  lines.push(`  ${accent}+${'='.repeat(WIDTH - 2)}+${c.reset}`);
  lines.push('');

  // ── Contract address ────────────────────────────────────────────────
  const shortAddr = truncate(contractAddress, 52);
  lines.push(`    ${c.gray}Contract${c.reset}   ${c.dim}${shortAddr}${c.reset}`);
  lines.push('');

  if (state) {
    const tokenName = state.domainSeparator || '(unnamed)';
    const colorDisplay = state.tokenColor
      ? truncate(state.tokenColor, 32) + '...'
      : c.dim + '(read from wallet balances)' + c.reset;

    // ── Shielded Tokens section ────────────────────────────────────────
    const sh = c.blue;
    lines.push(...sectionHeader(sh, 'SHIELDED TOKENS', 'Private · balances hidden · owned by Zswap (BLS) keys'));
    lines.push(row(sh, 'Token Name', `${c.white}${c.bold}${tokenName}${c.reset}`, tokenName.length));

    const shieldedStr = state.shieldedSupply.toString();
    lines.push(row(sh, 'Total Minted', `${c.yellow}${c.bold}${shieldedStr}${c.reset}`, shieldedStr.length));

    if (wallet && wallet.shieldedTokenBalance >= 0n) {
      const myBal = wallet.shieldedTokenBalance.toString();
      lines.push(row(sh, 'Your Balance', `${c.green}${c.bold}${myBal}${c.reset}`, myBal.length));
    }
    lines.push(sectionFooter(sh));
    lines.push('');

    // ── Unshielded Tokens section ──────────────────────────────────────
    const un = c.magenta;
    lines.push(...sectionHeader(un, 'UNSHIELDED TOKENS (UTXO)', 'Public · amounts visible on-chain · owned by secp256k1 keys'));
    lines.push(row(un, 'Token Name', `${c.white}${c.bold}${tokenName}${c.reset}`, tokenName.length));

    const unshieldedStr = state.unshieldedSupply.toString();
    lines.push(row(un, 'Total Minted', `${c.yellow}${c.bold}${unshieldedStr}${c.reset}`, unshieldedStr.length));

    if (wallet) {
      const unBal = wallet.unshieldedTokenBalance >= 0n
        ? wallet.unshieldedTokenBalance.toString()
        : 'n/a';
      lines.push(row(un, 'Your Balance', `${c.green}${c.bold}${unBal}${c.reset}`, unBal.length));
    }
    lines.push(sectionFooter(un));
    lines.push('');

    // ── Wallet section ─────────────────────────────────────────────────
    if (wallet) {
      const wlt = c.white;
      lines.push(...sectionHeader(wlt, 'YOUR WALLET', ''));
      const shortWalletAddr = truncate(wallet.address, 46);
      lines.push(row(wlt, 'Address', `${c.dim}${shortWalletAddr}${c.reset}`, shortWalletAddr.length));

      const nightStr = wallet.unshieldedBalance.toString();
      lines.push(row(wlt, 'NIGHT (gas)', `${nightStr}`, nightStr.length));
      lines.push(sectionFooter(wlt));
      lines.push('');
    }
  } else {
    lines.push(`    ${c.dim}Loading contract state...${c.reset}`);
    lines.push('');
  }

  // ── Message ────────────────────────────────────────────────────────
  if (message) {
    const msgColor = message.type === 'success' ? c.green
      : message.type === 'error' ? c.red
      : c.blue;
    const prefix = message.type === 'success' ? '+' : message.type === 'error' ? '!' : '>';
    lines.push(`    ${msgColor}[${prefix}] ${message.text}${c.reset}`);
    lines.push('');
  }

  lines.push(`  ${c.dim}${'─'.repeat(WIDTH)}${c.reset}`);
  lines.push('');

  // ── Menu ────────────────────────────────────────────────────────────
  if (role === 'authority') {
    lines.push(`    ${c.blue}${c.bold}── SHIELDED${c.reset}`);
    lines.push(`    ${c.blue}1${c.reset}  Mint shielded tokens     ${c.dim}(private · zswap coins · hidden balances)${c.reset}`);
    lines.push('');
    lines.push(`    ${c.magenta}${c.bold}── UNSHIELDED${c.reset}`);
    lines.push(`    ${c.magenta}2${c.reset}  Mint unshielded tokens   ${c.dim}(public · UTXOs · visible on-chain)${c.reset}`);
    lines.push('');
    lines.push(`    ${c.dim}── OTHER${c.reset}`);
    lines.push(`    ${c.dim}3${c.reset}  ${c.dim}Refresh${c.reset}`);
    lines.push(`    ${c.dim}4${c.reset}  ${c.dim}Exit${c.reset}`);
  } else {
    lines.push(`    ${c.blue}${c.bold}── SHIELDED${c.reset}`);
    lines.push(`    ${c.blue}1${c.reset}  View my shielded balances ${c.dim}(private token coins)${c.reset}`);
    lines.push('');
    lines.push(`    ${c.dim}── OTHER${c.reset}`);
    lines.push(`    ${c.dim}2${c.reset}  ${c.dim}Refresh${c.reset}`);
    lines.push(`    ${c.dim}3${c.reset}  ${c.dim}Exit${c.reset}`);
  }

  lines.push('');
  lines.push(`  ${c.dim}${'─'.repeat(WIDTH)}${c.reset}`);
  lines.push('');

  process.stdout.write(lines.join('\n'));
}
