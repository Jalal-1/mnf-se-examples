/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as ledger from '@midnight-ntwrk/ledger-v7';
import type { MidnightProvider, WalletProvider, UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import * as Rx from 'rxjs';
import type { WalletContext } from './types.js';

/**
 * Create the unified WalletProvider & MidnightProvider for midnight-js.
 * This bridges the wallet-sdk-facade to the midnight-js contract API by
 * implementing balance, sign, finalize, and submit operations.
 *
 * wallet-sdk 2.0.0 fixes the signRecipe bug from 1.0.0, so no manual
 * intent signing workaround is needed.
 */
export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  return {
    getCoinPublicKey(): ledger.CoinPublicKey {
      return ctx.shieldedSecretKeys.coinPublicKey;
    },
    getEncryptionPublicKey(): ledger.EncPublicKey {
      return ctx.shieldedSecretKeys.encryptionPublicKey;
    },
    async balanceTx(
      tx: UnboundTransaction,
      ttl?: Date,
    ): Promise<ledger.FinalizedTransaction> {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return await ctx.wallet.finalizeRecipe(recipe);
    },
    async submitTx(tx: ledger.FinalizedTransaction): Promise<ledger.TransactionId> {
      return await ctx.wallet.submitTransaction(tx);
    },
  };
};
