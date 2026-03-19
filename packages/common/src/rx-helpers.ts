import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { nativeToken } from '@midnight-ntwrk/ledger-v8';
import * as Rx from 'rxjs';

/** Wait until the wallet has fully synced with the network. Returns the synced state. */
export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((state) => state.isSynced),
    ),
  );

/** Wait until the wallet has a non-zero unshielded balance. Returns the balance. */
export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((state) => state.isSynced),
      Rx.map((s) => s.unshielded.balances[nativeToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );
