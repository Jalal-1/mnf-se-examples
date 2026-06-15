import { c, formatBalance } from '@mnf-se/common';

const ESC = '\x1b[';
const MIN_WIDTH = 78;
const MIN_HEIGHT = 24;

const s = {
  reset: c.reset,
  bold: c.bold,
  white: '\x1b[38;5;231m',
  muted: '\x1b[38;5;103m',
  faint: '\x1b[38;5;240m',
  teal: '\x1b[38;5;43m',
  aqua: '\x1b[38;5;45m',
  sky: '\x1b[38;5;75m',
  lime: '\x1b[38;5;118m',
  amber: '\x1b[38;5;214m',
  violet: '\x1b[38;5;177m',
  pink: '\x1b[38;5;205m',
  coral: '\x1b[38;5;203m',
  track: '\x1b[38;5;236m',
};

export type DashboardMessage = {
  readonly type: 'success' | 'error' | 'info' | 'warn';
  readonly text: string;
};

export type DashboardInstruction = {
  readonly title: string;
  readonly body: string;
  readonly tone?: 'guide' | 'prompt' | 'warn' | 'success';
};

export type DashboardWallet = {
  readonly network: string;
  readonly address: string;
  readonly zswapKey: string;
  readonly dust: string;
  readonly tokenBalance: bigint | null;
  readonly spendableCoinCount: number | null;
};

export type DashboardContract = {
  readonly address: string | null;
  readonly tokenName: string | null;
  readonly tokenColor: string | null;
  readonly counter: bigint | null;
  readonly policy: string;
  readonly refreshedAt: string | null;
};

export type DashboardSigner = {
  readonly slot: number;
  readonly label: string;
  readonly publicKey: string;
  readonly commitment: string;
};

export type DashboardCoin = {
  readonly index: number;
  readonly value: bigint;
  readonly mtIndex: bigint;
  readonly nonce: string;
};

export type DashboardState = {
  readonly wallet: DashboardWallet;
  readonly contract: DashboardContract;
  readonly signers: readonly DashboardSigner[];
  readonly coins: readonly DashboardCoin[];
  readonly instruction?: DashboardInstruction | null;
  readonly activity?: readonly DashboardMessage[];
  readonly message?: DashboardMessage;
};

let lastDashboardSize: string | null = null;

export function enterDashboardScreen(): void {
  lastDashboardSize = null;
  process.stdout.write(`${ESC}?1049h${ESC}?25h${ESC}2J${ESC}H`);
}

export function exitDashboardScreen(): void {
  lastDashboardSize = null;
  process.stdout.write(`${ESC}?25h${ESC}?1049l`);
}

export function renderDashboard(state: DashboardState): void {
  const size = screenSize();
  if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) {
    renderTooSmall(size);
    return;
  }

  const width = size.width;
  const height = size.height;
  const sizeKey = `${width}x${height}`;
  const shouldClear = lastDashboardSize !== sizeKey;
  lastDashboardSize = sizeKey;

  const compact = height < 31;
  const leftW = Math.max(36, Math.floor(width * 0.37));
  const rightW = width - leftW - 3;
  const topY = 4;
  const topH = compact ? 8 : height >= 38 ? 11 : 10;
  const midY = compact ? topY + topH : topY + topH + 1;
  const midH = compact ? 5 : height >= 38 ? 9 : 8;
  const commandH = compact ? 4 : 5;
  const commandY = height - commandH;
  const bottomY = compact ? midY + midH : midY + midH + 1;
  const bottomH = Math.max(3, commandY - bottomY);

  const out: string[] = [];
  out.push(shouldClear ? `${ESC}?25l${ESC}2J` : `${ESC}?25l`);
  out.push(header(width));
  out.push(panel(1, topY, leftW, topH, 'wallet', s.teal, walletLines(state.wallet, leftW - 4)));
  out.push(panel(leftW + 2, topY, rightW, topH, 'contract + token', s.aqua, contractLines(state.contract, rightW - 4)));
  out.push(panel(1, midY, leftW, midH, 'signers', s.amber, signerLines(state.signers, state.contract.policy, leftW - 4)));
  out.push(panel(leftW + 2, midY, rightW, midH, 'next step + coins', s.violet, flowLines(state, rightW - 4)));
  out.push(panel(1, bottomY, width - 2, bottomH, 'activity', s.sky, activityLines(state, width - 6, bottomH - 2)));
  out.push(panel(1, commandY, width - 2, commandH, 'commands', s.white, commandLines(width - 6)));
  out.push(`${ESC}?25h`);
  process.stdout.write(out.join(''));
}

export function renderSplash(
  title: string,
  message: string,
  activity: readonly DashboardMessage[] = [],
): void {
  lastDashboardSize = null;
  const size = screenSize();
  const width = Math.max(MIN_WIDTH, size.width);
  const height = Math.max(MIN_HEIGHT, size.height);
  const panelW = Math.min(width - 4, 118);
  const panelH = Math.min(height - 6, 18);
  const x = Math.max(1, Math.floor((width - panelW) / 2));
  const y = Math.max(4, Math.floor((height - panelH) / 2));

  const out: string[] = [];
  out.push(`${ESC}2J${ESC}H`);
  out.push(header(width));
  out.push(panel(x, y, panelW, panelH, title, s.aqua, [
    color(s.white, message),
    '',
    ...activity.slice(-(panelH - 5)).map((entry) => logLine(entry, panelW - 4)),
  ]));
  process.stdout.write(out.join(''));
}

export function dashboardPrompt(prompt: string): string {
  const size = screenSize();
  const text = truncatePlain(prompt, Math.max(1, size.width - 6));
  return `${move(size.height, 1)}${ESC}2K${color(s.aqua, '>')} ${text} `;
}

function header(width: number): string {
  const now = new Date().toLocaleTimeString();
  const title = ' OZ ShieldedMultiSigV3 Harness ';
  const left = color(s.teal, '[mnf-se]');
  const right = color(s.muted, now);
  const centerPad = Math.max(0, Math.floor((width - visibleLength(title)) / 2));
  return [
    move(1, 1),
    color(s.aqua, '+'),
    color(s.aqua, '-'.repeat(width - 2)),
    color(s.aqua, '+'),
    move(2, 1),
    color(s.aqua, '|'),
    left,
    ' '.repeat(Math.max(1, centerPad - visibleLength(left))),
    color(s.bold, color(s.white, title)),
    ' '.repeat(Math.max(1, width - centerPad - visibleLength(left) - visibleLength(title) - visibleLength(right) - 2)),
    right,
    color(s.aqua, '|'),
    move(3, 1),
    color(s.aqua, '+'),
    color(s.aqua, '-'.repeat(width - 2)),
    color(s.aqua, '+'),
  ].join('');
}

function panel(
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  borderColor: string,
  lines: readonly string[],
): string {
  const innerW = Math.max(1, width - 2);
  const visibleTitle = ` ${title} `;
  const out: string[] = [];
  out.push(move(y, x), color(borderColor, '+'), color(borderColor, visibleTitle), color(borderColor, '-'.repeat(Math.max(0, innerW - visibleTitle.length))), color(borderColor, '+'));
  for (let row = 1; row < height - 1; row += 1) {
    const text = lines[row - 1] ?? '';
    out.push(move(y + row, x), color(borderColor, '|'), fit(text, innerW), color(borderColor, '|'));
  }
  out.push(move(y + height - 1, x), color(borderColor, '+'), color(borderColor, '-'.repeat(innerW)), color(borderColor, '+'));
  return out.join('');
}

function walletLines(wallet: DashboardWallet, width: number): string[] {
  return [
    kv('network', wallet.network, s.aqua, width),
    kv('address', shortMiddle(wallet.address, width - 12), s.muted, width),
    kv('zswap', shortMiddle(wallet.zswapKey, width - 12), s.muted, width),
    kv('dust', wallet.dust || 'unknown', s.amber, width),
    meter('token bal', wallet.tokenBalance, wallet.tokenBalance === null ? null : wallet.tokenBalance > 0n ? 100 : 0, s.lime, width),
    kv('coins', wallet.spendableCoinCount?.toString() ?? '-', s.teal, width),
    hint('wallet values refresh before every prompt', width),
  ];
}

function contractLines(contract: DashboardContract, width: number): string[] {
  if (!contract.address) {
    return [
      hint('no contract selected', width),
      hint('start with guided mode for the full walkthrough', width),
      kv('policy', contract.policy, s.amber, width),
      hint('the token color is derived from token name + contract address', width),
    ];
  }
  return [
    kv('contract', shortMiddle(contract.address, width - 13), s.muted, width),
    kv('token', contract.tokenName ?? '-', s.white, width),
    kv('color', shortMiddle(contract.tokenColor ?? '-', width - 10), s.muted, width),
    kv('policy', contract.policy, s.amber, width),
    kv('nonce', contract.counter?.toString() ?? '-', s.sky, width),
    kv('chain read', contract.refreshedAt ?? 'pending', s.sky, width),
    hint('mint creates supply; burn spends to shieldedBurnAddress()', width),
  ];
}

function signerLines(signers: readonly DashboardSigner[], policy: string, width: number): string[] {
  if (signers.length === 0) {
    return [
      kv('policy', policy, s.amber, width),
      hint('no local demo signer keys yet', width),
      hint('guided mode creates 3 keys and uses any 2', width),
      hint('ECDSA verification is stubbed upstream', width),
    ];
  }
  return [
    ...signers.slice(0, 3).map((signer) =>
      kv(`slot ${signer.slot}`, shortMiddle(`${signer.label} pk=${signer.publicKey}`, width - 12), s.muted, width),
    ),
    kv('policy', policy, s.amber, width),
    ...signers.slice(0, 3).map((signer) =>
      kv(`id ${signer.slot}`, shortMiddle(signer.commitment, width - 12), s.faint, width),
    ),
    hint('choose any two unique signer slots for mint or burn', width),
  ];
}

function flowLines(state: DashboardState, width: number): string[] {
  const instruction = state.instruction ?? {
    title: 'Next',
    body: 'Choose an action. Guided mode is the clearest path.',
    tone: 'guide' as const,
  };
  const toneColor = instruction.tone === 'warn' ? s.coral
    : instruction.tone === 'prompt' ? s.aqua
    : instruction.tone === 'success' ? s.lime
    : s.amber;

  const lines = [
    fit(`${color(toneColor, instruction.title.toUpperCase())} ${color(s.white, instruction.body)}`, width),
    '',
  ];

  if (state.coins.length === 0) {
    lines.push(hint('wallet coins for active token: none', width));
    lines.push(hint('mint to this wallet before auto-burn', width));
    return lines;
  }

  lines.push(kv('wallet coin', `${state.coins.length} spendable`, s.teal, width));
  lines.push(...state.coins.slice(0, 3).map((coin) =>
    fit(`${color(s.violet, `[${coin.index}]`)} ${color(s.muted, 'value')} ${color(s.white, formatBalance(coin.value))} ${color(s.muted, 'mt')} ${color(s.sky, coin.mtIndex.toString())} ${shortMiddle(coin.nonce, Math.max(8, width - 34))}`, width),
  ));
  lines.push(hint('auto-burn rewrites mt_index to contract-local slot 0', width));
  return lines;
}

function activityLines(state: DashboardState, width: number, height: number): string[] {
  if (height <= 0) return [];
  const entries = [
    ...(state.activity ?? []),
    ...(state.message ? [state.message] : []),
  ];
  if (entries.length === 0) {
    return [
      hint('status updates, chain reads, and transaction ids appear here', width),
      hint('instructions live in the next-step panel so they do not get buried', width),
    ];
  }
  return entries.slice(-height).map((entry) => logLine(entry, width));
}

function commandLines(width: number): string[] {
  return [
    `${cmd('1')} guided deploy+mint+burn  ${cmd('2')} deploy  ${cmd('3')} mint-wallet  ${cmd('4')} burn-wallet`,
    `${cmd('5')} manual-burn  ${cmd('6')} join  ${cmd('7')} refresh  ${cmd('8')} exit`,
    hint('Prompt appears here at the bottom. Press Enter to accept defaults in guided mode.', width),
  ].map((line) => fit(line, width));
}

function logLine(entry: DashboardMessage, width: number): string {
  const label = entry.type === 'success' ? color(s.lime, 'ok')
    : entry.type === 'error' ? color(s.coral, 'err')
    : entry.type === 'warn' ? color(s.amber, 'warn')
    : color(s.sky, 'info');
  return fit(`${label} ${entry.text}`, width);
}

function cmd(value: string): string {
  return color(s.aqua, `[${value}]`);
}

function meter(label: string, value: bigint | null, percent: number | null, barColor: string, width: number): string {
  const labelPart = color(s.muted, label.padEnd(11));
  const valueText = value === null ? '-' : formatBalance(value);
  if (percent === null) {
    return fit(`${labelPart}${color(barColor, valueText)}`, width);
  }
  const barW = Math.max(8, width - 30);
  const bounded = Math.max(0, Math.min(100, percent));
  const filled = bounded > 0 ? Math.max(1, Math.round((barW * bounded) / 100)) : 0;
  const bar = color(barColor, '#'.repeat(filled)) + color(s.track, '.'.repeat(barW - filled));
  return fit(`${labelPart}${bar} ${color(barColor, valueText)}`, width);
}

function kv(label: string, value: string, valueColor: string, width: number): string {
  return fit(`${color(s.muted, label.padEnd(11))}${color(valueColor, value)}`, width);
}

function hint(text: string, width: number): string {
  return fit(color(s.muted, text), width);
}

function fit(text: string, width: number): string {
  const clipped = truncateVisible(text, width);
  return `${clipped}${' '.repeat(Math.max(0, width - visibleLength(clipped)))}`;
}

function color(value: string, text: string): string {
  return `${value}${text}${s.reset}`;
}

function move(row: number, col: number): string {
  return `${ESC}${row};${col}H`;
}

function screenSize(): { width: number; height: number } {
  return {
    width: Math.max(1, process.stdout.columns || 120),
    height: Math.max(1, process.stdout.rows || 36),
  };
}

function renderTooSmall(size: { width: number; height: number }): void {
  lastDashboardSize = null;
  process.stdout.write(`${ESC}2J${ESC}H`);
  process.stdout.write(`Terminal too small for dashboard (${size.width}x${size.height}). Resize to at least ${MIN_WIDTH}x${MIN_HEIGHT}.\n`);
}

function shortMiddle(value: string, max: number): string {
  if (!value || value.length <= max) return value || '-';
  const head = Math.max(4, Math.floor((max - 3) * 0.58));
  const tail = Math.max(4, max - 3 - head);
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function truncatePlain(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3))}...`;
}

function visibleLength(value: string): number {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').length;
}

function truncateVisible(value: string, max: number): string {
  if (visibleLength(value) <= max) return value;

  let visible = 0;
  let out = '';
  for (let i = 0; i < value.length && visible < max - 3;) {
    if (value[i] === '\x1b') {
      const match = value.slice(i).match(/^\x1b\[[0-9;?]*[A-Za-z]/);
      if (match) {
        out += match[0];
        i += match[0].length;
        continue;
      }
    }
    out += value[i];
    visible += 1;
    i += 1;
  }
  return `${out}${s.reset}...`;
}
