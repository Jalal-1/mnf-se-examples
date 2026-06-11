import { createHash, webcrypto } from 'node:crypto';
import {
  CompactTypeBytes,
  CompactTypeField,
  CompactTypeVector,
  convertFieldToBytes,
  degradeToTransient,
  ecAdd,
  ecMul,
  ecMulGenerator,
  type JubjubPoint,
  jubjubPointX,
  jubjubPointY,
  persistentHash,
  transientHash,
} from '@midnight-ntwrk/compact-runtime';

export const JUBJUB_SCALAR_ORDER =
  0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n;

const SCHNORR_DOMAIN_TAG = padRight32('Schnorr:Jubjub:v1');
const MULTISIG_DOMAIN_TAG = padRight32('MNF:SchnorrMS:v1');

export type JubjubKeypair = {
  readonly secret: bigint;
  readonly publicKey: JubjubPoint;
};

export type JubjubSchnorrSignature = {
  readonly R: JubjubPoint;
  readonly sigma: bigint;
};

export type DemoSigner = JubjubKeypair & {
  readonly label: string;
};

export function generateDemoSigners(): DemoSigner[] {
  return [1, 2, 3].map((slot) => ({
    label: `Signer ${slot}`,
    ...jubjubKeypairFromSecret(sampleScalar()),
  }));
}

export function randomBytes32(): Uint8Array {
  const bytes = new Uint8Array(32);
  webcrypto.getRandomValues(bytes);
  return bytes;
}

export function actionHashFromText(text: string): Uint8Array {
  return createHash('sha256').update(text, 'utf8').digest();
}

export function approvalMessageHash(
  instanceSalt: Uint8Array,
  proposalId: bigint,
  actionHash: Uint8Array,
): Uint8Array {
  const rt = new CompactTypeVector(4, new CompactTypeBytes(32));
  return persistentHash(rt, [
    MULTISIG_DOMAIN_TAG,
    instanceSalt,
    convertFieldToBytes(32, proposalId, ''),
    actionHash,
  ]);
}

export function jubjubKeypairFromSecret(secret: bigint): JubjubKeypair {
  const reduced = modJubjubOrder(secret);
  if (reduced === 0n) {
    throw new Error('Jubjub secret reduces to zero');
  }
  return {
    secret: reduced,
    publicKey: ecMulGenerator(reduced),
  };
}

export function jubjubSign(secret: bigint, message: Uint8Array): JubjubSchnorrSignature {
  return signWithNonce(secret, message, sampleScalar());
}

export function publicKeyLabel(point: JubjubPoint): string {
  return `x=${shortHex(fieldToHex(jubjubPointX(point)))} y=${shortHex(fieldToHex(jubjubPointY(point)))}`;
}

export function signatureLabel(sig: JubjubSchnorrSignature): string {
  return `R.x=${shortHex(fieldToHex(jubjubPointX(sig.R)))} sigma=${shortHex(bigintToHex(sig.sigma))}`;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function bigintToHex(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function signWithNonce(secret: bigint, message: Uint8Array, nonce: bigint): JubjubSchnorrSignature {
  if (message.length !== 32) {
    throw new Error(`Schnorr message must be 32 bytes, got ${message.length}`);
  }
  const s = modJubjubOrder(secret);
  const r = modJubjubOrder(nonce);
  if (s === 0n) throw new Error('Schnorr secret reduces to zero');
  if (r === 0n) throw new Error('Schnorr nonce reduces to zero');

  const R = ecMulGenerator(r);
  const P = ecMulGenerator(s);
  const c = schnorrChallenge(R, P, message);
  const sigma = modJubjubOrder(r + c * s);
  return { R, sigma };
}

function schnorrChallenge(R: JubjubPoint, P: JubjubPoint, message: Uint8Array): bigint {
  const rtType = new CompactTypeVector(6, CompactTypeField);
  const cFull = transientHash(rtType, [
    degradeToTransient(SCHNORR_DOMAIN_TAG),
    jubjubPointX(R),
    jubjubPointY(R),
    jubjubPointX(P),
    jubjubPointY(P),
    degradeToTransient(message),
  ]);
  return fitInJubjubScalar(cFull);
}

function fitInJubjubScalar(value: bigint): bigint {
  return value & ((1n << 248n) - 1n);
}

function modJubjubOrder(value: bigint): bigint {
  const m = value % JUBJUB_SCALAR_ORDER;
  return m < 0n ? m + JUBJUB_SCALAR_ORDER : m;
}

function sampleScalar(): bigint {
  const bytes = new Uint8Array(64);
  webcrypto.getRandomValues(bytes);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  const reduced = value % JUBJUB_SCALAR_ORDER;
  return reduced === 0n ? 1n : reduced;
}

function padRight32(text: string): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length > 32) {
    throw new Error(`Cannot pad ${text}: longer than 32 bytes`);
  }
  const out = new Uint8Array(32);
  out.set(encoded, 0);
  return out;
}

function fieldToHex(value: bigint): string {
  return bigintToHex(value);
}

function shortHex(hex: string): string {
  return `${hex.slice(0, 10)}...${hex.slice(-8)}`;
}
