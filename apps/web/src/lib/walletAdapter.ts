import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import type { WalletProvider, MidnightProvider, UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import {
  type CoinPublicKey,
  type EncPublicKey,
  type FinalizedTransaction,
  Binding,
  Proof,
  SignatureEnabled,
  Transaction,
} from '@midnight-ntwrk/ledger-v8';

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8Array(hex: string): Uint8Array {
  const cleaned = hex.replace(/^0x/, '');
  const matches = cleaned.match(/.{1,2}/g);
  if (!matches) return new Uint8Array();
  return new Uint8Array(matches.map((b) => parseInt(b, 16)));
}

export interface ShieldedAddresses {
  shieldedCoinPublicKey: CoinPublicKey;
  shieldedEncryptionPublicKey: EncPublicKey;
}

export function createWalletProviderFromConnectedAPI(
  connectedAPI: ConnectedAPI,
  shieldedAddresses: ShieldedAddresses,
): WalletProvider & MidnightProvider {
  const walletProvider: WalletProvider = {
    getCoinPublicKey(): CoinPublicKey {
      return shieldedAddresses.shieldedCoinPublicKey;
    },
    getEncryptionPublicKey(): EncPublicKey {
      return shieldedAddresses.shieldedEncryptionPublicKey;
    },
    async balanceTx(tx: UnboundTransaction): Promise<FinalizedTransaction> {
      const serialized = tx.serialize();
      const hexTx = uint8ArrayToHex(serialized);
      const result = await connectedAPI.balanceUnsealedTransaction(hexTx);
      const resultBytes = hexToUint8Array(result.tx);
      return Transaction.deserialize('signature', 'proof', 'binding', resultBytes) as Transaction<
        SignatureEnabled,
        Proof,
        Binding
      >;
    },
  };

  const midnightProvider: MidnightProvider = {
    async submitTx(tx: FinalizedTransaction): Promise<string> {
      const serialized = tx.serialize();
      const hexTx = uint8ArrayToHex(serialized);
      await connectedAPI.submitTransaction(hexTx);
      return tx.identifiers()[0];
    },
  };

  return { ...walletProvider, ...midnightProvider };
}
