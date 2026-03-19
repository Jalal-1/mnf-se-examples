import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}
