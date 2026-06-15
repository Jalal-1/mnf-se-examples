import { webcrypto } from 'node:crypto';
import * as ledger from '@midnight-ntwrk/ledger-v8';

const ZERO_BYTES32 = new Uint8Array(32);

export type StubEcdsaSigner = {
  readonly label: string;
  readonly publicKey: Uint8Array;
};

export type MintRecipient = {
  readonly is_left: boolean;
  readonly left: { readonly bytes: Uint8Array };
  readonly right: { readonly bytes: Uint8Array };
};

export function generateStubEcdsaSigners(): StubEcdsaSigner[] {
  return [1, 2, 3].map((slot) => ({
    label: `Signer ${slot}`,
    publicKey: randomBytes(64),
  }));
}

export function stubSignature(): Uint8Array {
  return randomBytes(64);
}

export function randomBytes32(): Uint8Array {
  return randomBytes(32);
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return bytes;
}

export function tokenDomainFromName(tokenName: string): Uint8Array {
  const trimmed = tokenName.trim();
  if (!trimmed) throw new Error('Token name is required');
  const encoded = new TextEncoder().encode(trimmed);
  if (encoded.length > 32) {
    throw new Error('Token name must be 32 bytes or fewer');
  }
  const out = new Uint8Array(32);
  out.set(encoded);
  return out;
}

export function tokenNameFromDomain(domain: Uint8Array): string {
  return new TextDecoder().decode(domain).replace(/\0+$/, '');
}

export function contractRecipient(contractAddress: string): MintRecipient {
  return {
    is_left: false,
    left: { bytes: ZERO_BYTES32 },
    right: { bytes: ledger.encodeContractAddress(contractAddress) },
  };
}

export function zswapRecipient(coinPublicKey: Uint8Array): MintRecipient {
  return {
    is_left: true,
    left: { bytes: coinPublicKey },
    right: { bytes: ZERO_BYTES32 },
  };
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function hexToBytes32(hex: string, label: string): Uint8Array {
  const normalized = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${label} must be exactly 32 bytes / 64 hex characters`);
  }
  return new Uint8Array(Buffer.from(normalized, 'hex'));
}

export function shortHex(hex: string, start = 12, end = 8): string {
  return hex.length <= start + end + 3 ? hex : `${hex.slice(0, start)}...${hex.slice(-end)}`;
}
