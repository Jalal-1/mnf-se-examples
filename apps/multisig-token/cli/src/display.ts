import { c, formatBalance } from '@mnf-se/common';

const ESC = '\x1b[';
const MIN_WIDTH = 96;
const MIN_HEIGHT = 30;

const s = {
  reset: c.reset,
  bold: c.bold,
  white: '\x1b[38;5;231m',
  muted: '\x1b[38;5;103m',
  faint: '\x1b[38;5;240m',
  teal: '\x1b[38;5;43m',
  aqua: '\x1b[38;5;45m',
  sky: '\x1b[38;5;75m',
  mint: '\x1b[38;5;48m',
  lime: '\x1b[38;5;118m',
  amber: '\x1b[38;5;214m',
  violet: '\x1b[38;5;171m',
  coral: '\x1b[38;5;203m',
  track: '\x1b[38;5;236m',
};

export type DashboardMessage = {
  readonly type: 'success' | 'error' | 'info';
  readonly text: string;
};

export type DashboardInstruction = {
  readonly title: string;
  readonly body: string;
  readonly tone?: 'guide' | 'prompt' | 'warn';
};

export type DashboardWallet = {
  readonly address: string;
  readonly zswapKey: string;
  readonly dust: string;
  readonly tokenBalance: bigint | null;
  readonly spendableCoinCount: number | null;
};

export type DashboardTokenSignerStatus = 'ready' | 'view-only' | 'unknown';

export type DashboardToken = {
  readonly sessionLabel: string | null;
  readonly contractAddress: string | null;
  readonly tokenName: string | null;
  readonly tokenColor: string | null;
  readonly shieldedSupply: bigint | null;
  readonly burnedSupply: bigint | null;
  readonly circulatingSupply: bigint | null;
  readonly signerCount: bigint | null;
  readonly threshold: bigint | null;
  readonly nextProposalId: bigint | null;
  readonly executedCount: bigint | null;
  readonly refreshedAt: string | null;
  readonly signerStatus: DashboardTokenSignerStatus | null;
};

export type DashboardTokenListItem = {
  readonly index: number;
  readonly label: string;
  readonly contractAddress: string;
  readonly selected: boolean;
  readonly signerStatus: DashboardTokenSignerStatus;
  readonly balance: bigint | null;
};

export type DashboardSigner = {
  readonly slot: number;
  readonly label: string;
  readonly publicKey: string;
};

export type DashboardProposal = {
  readonly id: bigint;
  readonly amount: bigint;
  readonly recipient: string;
  readonly status: string;
  readonly approvals: bigint | null;
};

export type DashboardState = {
  readonly wallet: DashboardWallet;
  readonly token: DashboardToken;
  readonly tokens: readonly DashboardTokenListItem[];
  readonly signers: readonly DashboardSigner[];
  readonly signerScope: string;
  readonly proposals: readonly DashboardProposal[];
  readonly instruction?: DashboardInstruction | null;
  readonly message?: DashboardMessage;
  readonly activity?: readonly DashboardMessage[];
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

  const leftW = Math.max(40, Math.floor(width * 0.36));
  const rightW = width - leftW - 3;
  const topY = 4;
  const topH = height >= 36 ? 11 : 9;
  const midY = topY + topH + 1;
  const midH = height >= 36 ? 8 : 7;
  const commandH = 6;
  const commandY = height - commandH;
  const bottomY = midY + midH + 1;
  const bottomH = Math.max(2, commandY - bottomY);

  const out: string[] = [];
  out.push(shouldClear ? `${ESC}?25l${ESC}2J` : `${ESC}?25l`);
  out.push(header(width));

  out.push(panel(1, topY, leftW, topH, 'wallet', s.mint, walletLines(state.wallet, leftW - 4)));
  out.push(panel(leftW + 2, topY, rightW, topH, 'token', s.aqua, tokenLines(state.token, state.tokens, rightW - 4)));
  out.push(panel(1, midY, leftW, midH, 'signers', s.amber, signerLines(state.signers, state.token, state.signerScope, leftW - 4)));
  out.push(panel(leftW + 2, midY, rightW, midH, 'proposals', s.violet, proposalLines(state.proposals, rightW - 4)));
  out.push(panel(1, bottomY, width - 2, bottomH, 'activity', s.sky, activityLines(state, width - 6, bottomH - 2)));
  out.push(panel(1, commandY, width - 2, commandH, 'guide + commands', s.white, commandLines(width - 6, state.instruction)));
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
  const out: string[] = [];
  const panelW = Math.min(width - 4, 118);
  const panelH = Math.min(height - 6, 18);
  const x = Math.max(1, Math.floor((width - panelW) / 2));
  const y = Math.max(2, Math.floor((height - panelH) / 2));

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
  const title = ' Midnight Multisig Shielded Token ';
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

function panel(x: number, y: number, width: number, height: number, title: string, borderColor: string, lines: readonly string[]): string {
  const innerW = Math.max(1, width - 2);
  const visibleTitle = ` ${title} `;
  const out: string[] = [];
  out.push(move(y, x), color(borderColor, '+'), color(borderColor, visibleTitle), color(borderColor, '-'.repeat(Math.max(0, innerW - visibleTitle.length))), color(borderColor, '+'));
  for (let row = 1; row < height - 1; row++) {
    const text = lines[row - 1] ?? '';
    out.push(move(y + row, x), color(borderColor, '|'), fit(text, innerW), color(borderColor, '|'));
  }
  out.push(move(y + height - 1, x), color(borderColor, '+'), color(borderColor, '-'.repeat(innerW)), color(borderColor, '+'));
  return out.join('');
}

function walletLines(wallet: DashboardWallet, width: number): string[] {
  return [
    kv('address', shortMiddle(wallet.address, width - 12), s.muted, width),
    kv('zswap', shortMiddle(wallet.zswapKey, width - 12), s.muted, width),
    kv('dust', wallet.dust || 'unknown', s.amber, width),
    meter('active bal', wallet.tokenBalance, wallet.tokenBalance === null ? null : wallet.tokenBalance > 0n ? 1 : 0, s.lime, width),
    kv('coins', wallet.spendableCoinCount?.toString() ?? '-', s.mint, width),
    hint('balances refresh from wallet state', width),
  ];
}

function tokenLines(token: DashboardToken, tokens: readonly DashboardTokenListItem[], width: number): string[] {
  if (!token.contractAddress) {
    return [
      hint('no token selected', width),
      hint('run guided flow, deploy, or join', width),
      tokens.length > 0 ? tokenWindow(tokens, width) : hint('session tokens: none', width),
      hint('cycle tokens with n / p', width),
    ];
  }

  return [
    kv('active', `${token.sessionLabel ?? '-'} ${token.tokenName ?? 'unnamed token'}`, s.white, width),
    kv('contract', shortMiddle(token.contractAddress, width - 13), s.muted, width),
    kv('signing', signerStatusLabel(token.signerStatus), signerStatusColor(token.signerStatus), width),
    kv('color', shortMiddle(token.tokenColor ?? '-', width - 10), s.muted, width),
    meter('minted', token.shieldedSupply, null, s.amber, width),
    meter('burned', token.burnedSupply, token.shieldedSupply && token.shieldedSupply > 0n && token.burnedSupply !== null
      ? Number(token.burnedSupply * 100n / token.shieldedSupply)
      : 0, s.coral, width),
    meter('circ', token.circulatingSupply, token.shieldedSupply && token.shieldedSupply > 0n && token.circulatingSupply !== null
      ? Number(token.circulatingSupply * 100n / token.shieldedSupply)
      : 0, s.lime, width),
    kv('chain read', token.refreshedAt ?? 'pending', s.sky, width),
    tokenWindow(tokens, width),
  ];
}

function signerLines(signers: readonly DashboardSigner[], token: DashboardToken, scope: string, width: number): string[] {
  if (signers.length === 0) {
    return [
      kv('scope', scope, s.amber, width),
      hint('no local signer keys available', width),
      hint('option 2 stages keys for new deploys', width),
    ];
  }
  const threshold = token.threshold?.toString() ?? '2';
  const signerCount = token.signerCount?.toString() ?? signers.length.toString();
  return [
    kv('scope', scope, s.amber, width),
    kv('policy', `${threshold} of ${signerCount}`, s.amber, width),
    ...signers.slice(0, 4).map((signer) =>
      kv(`slot ${signer.slot}`, shortMiddle(`${signer.label} ${signer.publicKey}`, width - 12), s.muted, width),
    ),
  ];
}

function proposalLines(proposals: readonly DashboardProposal[], width: number): string[] {
  if (proposals.length === 0) {
    return [
      hint('no tracked proposals for active token', width),
      hint('create one or join by id', width),
    ];
  }
  return proposals.slice(-6).map((proposal) => {
    const approvals = proposal.approvals === null ? '-' : proposal.approvals.toString();
    const statusColor = proposal.status === 'Executed' ? s.lime : proposal.status === 'Active' ? s.amber : s.muted;
    return `${color(s.violet, `#${proposal.id}`)} ${color(statusColor, proposal.status.padEnd(8))} ${color(s.muted, 'appr')} ${approvals} ${color(s.muted, 'amt')} ${color(s.white, proposal.amount.toString())} ${shortMiddle(proposal.recipient, Math.max(8, width - 34))}`;
  });
}

function activityLines(state: DashboardState, width: number, height: number): string[] {
  if (height <= 0) return [];
  const entries = [
    ...(state.activity ?? []),
    ...(state.message ? [state.message] : []),
  ];
  if (entries.length === 0) {
    return [
      hint('wallet values are live; option 8 reads active contract/proposal state from chain', width),
      hint('status updates and transaction progress appear here', width),
    ];
  }
  return entries.slice(-height).map((entry) => logLine(entry, width));
}

function commandLines(width: number, instruction?: DashboardInstruction | null): string[] {
  const guide = instructionLine(instruction, width);
  return [
    guide,
    `${cmd('1')} guided  ${cmd('2')} keys  ${cmd('3')} deploy  ${cmd('4')} join  ${cmd('5')} propose  ${cmd('6')} approve`,
    `${cmd('7')} execute ${cmd('8')} refresh-chain ${cmd('9')} refresh-wallet ${cmd('10')} burn`,
    `${cmd('n')} next-token ${cmd('p')} prev-token ${cmd('11')} exit`,
  ].map((line) => fit(line, width));
}

function instructionLine(instruction: DashboardInstruction | null | undefined, width: number): string {
  if (!instruction) {
    return fit(`${color(s.amber, 'NEXT')} ${color(s.white, 'Choose an action below. Guided mode is the easiest walkthrough.')}`, width);
  }

  const toneColor = instruction.tone === 'warn' ? s.coral
    : instruction.tone === 'prompt' ? s.aqua
    : s.amber;
  return fit(`${color(toneColor, instruction.title.toUpperCase())} ${color(s.white, instruction.body)}`, width);
}

function tokenWindow(tokens: readonly DashboardTokenListItem[], width: number): string {
  if (tokens.length === 0) return hint('session tokens: none', width);
  const activeIndex = Math.max(0, tokens.findIndex((token) => token.selected));
  const maxItems = width >= 74 ? 4 : 3;
  const start = Math.max(0, Math.min(activeIndex - 1, Math.max(0, tokens.length - maxItems)));
  const visible = tokens.slice(start, start + maxItems);
  const chips = visible.map((token) => {
    const marker = token.selected ? '>' : ' ';
    const status = token.signerStatus === 'ready' ? 'sign' : token.signerStatus === 'view-only' ? 'view' : 'unk';
    const balance = token.balance === null ? '-' : formatBalance(token.balance);
    const chipColor = token.selected ? s.aqua : s.muted;
    return color(chipColor, `${marker}${token.index}:${truncatePlain(token.label, 12)} ${status} bal=${balance}`);
  });
  const prefix = color(s.faint, `tokens ${tokens.length} `);
  return fit(`${prefix}${chips.join(color(s.faint, ' | '))}`, width);
}

function signerStatusLabel(status: DashboardTokenSignerStatus | null): string {
  switch (status) {
    case 'ready':
      return 'local demo keys available';
    case 'view-only':
      return 'view/burn only; no local signer keys';
    case 'unknown':
      return 'unknown';
    default:
      return '-';
  }
}

function signerStatusColor(status: DashboardTokenSignerStatus | null): string {
  switch (status) {
    case 'ready':
      return s.lime;
    case 'view-only':
      return s.amber;
    case 'unknown':
      return s.muted;
    default:
      return s.muted;
  }
}

function logLine(entry: DashboardMessage, width: number): string {
  const label = entry.type === 'success' ? color(s.lime, 'ok')
    : entry.type === 'error' ? color(s.coral, 'err')
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
  const barW = Math.max(8, width - 28);
  const bounded = Math.max(0, Math.min(100, percent));
  const filled = bounded > 0 ? Math.max(1, Math.round((barW * bounded) / 100)) : 0;
  const bar = color(barColor, '█'.repeat(filled)) + color(s.track, '░'.repeat(barW - filled));
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
    visible++;
    i++;
  }
  return `${out}${s.reset}...`;
}
