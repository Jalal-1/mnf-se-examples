import {
  type ContractAddress,
  CompactTypeBytes,
  CompactTypeUnsignedInteger,
  persistentHash,
  rawTokenType,
} from '@midnight-ntwrk/compact-runtime';
import { Token, type TokenPrivateState, createWitnesses } from '@mnf-se/token-contract';
import type { MidnightProviders, FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

// ── Types ──────────────────────────────────────────────────────────────────

export type TokenCircuits = 'mint' | 'mint_unshielded' | 'burn' | 'get_color';

export const TokenPrivateStateId = 'tokenPrivateState';

export type TokenProviders = MidnightProviders<
  TokenCircuits,
  typeof TokenPrivateStateId,
  TokenPrivateState
>;

export type DeployedTokenContract =
  | DeployedContract<Token.Contract<TokenPrivateState>>
  | FoundContract<Token.Contract<TokenPrivateState>>;

// ── Compiled contract (browser — ZK assets served via HTTP) ────────────────

const TOKEN_ZK_PATH = './contract/token';

const tokenCompiledContract = CompiledContract.make<Token.Contract<TokenPrivateState>>(
  'Token',
  Token.Contract,
).pipe(
  CompiledContract.withWitnesses(createWitnesses()),
  CompiledContract.withCompiledFileAssets(TOKEN_ZK_PATH),
);

// ── Deploy / Join ──────────────────────────────────────────────────────────

export async function deploy(
  providers: TokenProviders,
  domainSep: string,
): Promise<DeployedTokenContract> {
  const domainSepBytes = new Uint8Array(32);
  const encoder = new TextEncoder();
  domainSepBytes.set(encoder.encode(domainSep.substring(0, 32)));

  return await deployContract(providers as any, {
    compiledContract: tokenCompiledContract,
    privateStateId: TokenPrivateStateId,
    initialPrivateState: { secretKey: crypto.getRandomValues(new Uint8Array(32)) },
    args: [domainSepBytes],
  });
}

export async function joinContract(
  providers: TokenProviders,
  contractAddress: string,
  privateState: TokenPrivateState,
): Promise<DeployedTokenContract> {
  return await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: tokenCompiledContract,
    privateStateId: TokenPrivateStateId,
    initialPrivateState: privateState,
  });
}

// ── Token Circuit Calls ────────────────────────────────────────────────────

export async function mintShielded(
  contract: DeployedTokenContract,
  amount: number,
  recipientKey: Uint8Array,
): Promise<FinalizedTxData> {
  const result = await contract.callTx.mint(BigInt(amount), { bytes: recipientKey });
  return result.public;
}

export async function mintUnshielded(
  contract: DeployedTokenContract,
  amount: number,
  recipientAddress: Uint8Array,
): Promise<FinalizedTxData> {
  if (amount <= 0) throw new Error('Amount must be greater than zero');
  const result = await contract.callTx.mint_unshielded(BigInt(amount), { bytes: recipientAddress });
  return result.public;
}

export async function burnTokens(
  contract: DeployedTokenContract,
  coin: { nonce: Uint8Array; color: Uint8Array; value: bigint },
): Promise<FinalizedTxData> {
  const result = await contract.callTx.burn(coin);
  return result.public;
}

// ── Read Contract State ────────────────────────────────────────────────────

export type TokenPublicState = {
  owner: string;
  shieldedSupply: bigint;
  unshieldedSupply: bigint;
  domainSeparator: string;
  tokenColor: string;
};

export async function getTokenState(
  providers: TokenProviders,
  contractAddress: ContractAddress,
): Promise<TokenPublicState | null> {
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  if (!contractState) return null;

  try {
    const stateArr = (contractState as any).data.state.asArray()!;
    const bytesType = new CompactTypeBytes(32);
    const uintType = new CompactTypeUnsignedInteger(18446744073709551615n, 8);

    // State layout: [0]=owner, [1]=shielded_supply, [2]=unshielded_supply, [3]=domain_separator
    const ownerCell = stateArr[0]!.asCell()!;
    const ownerBytes = bytesType.fromValue([...ownerCell.value]);
    const owner = Array.from(ownerBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const shieldedCell = stateArr[1]!.asCell()!;
    const shieldedSupply = uintType.fromValue([...shieldedCell.value]);

    const unshieldedCell = stateArr[2]!.asCell()!;
    const unshieldedSupply = uintType.fromValue([...unshieldedCell.value]);

    const dsCell = stateArr[3]!.asCell()!;
    const dsBytes = bytesType.fromValue([...dsCell.value]);
    const domainSeparator = new TextDecoder().decode(dsBytes).replace(/\0+$/, '');

    // Compute the token color (used for wallet balance lookup)
    const tokenColor = rawTokenType(dsBytes, contractAddress);

    return { owner, shieldedSupply, unshieldedSupply, domainSeparator, tokenColor };
  } catch {
    return null;
  }
}

// ── Key Derivation ─────────────────────────────────────────────────────────

/**
 * Derive the public key from a secret key, matching the contract's derive_public_key circuit:
 *   persistentHash([pad(32, "midnight:token:pk:"), sk])
 */
export function derivePublicKey(secretKey: Uint8Array): Uint8Array {
  const bytesType = new CompactTypeBytes(32);
  const prefix = new Uint8Array(32);
  const prefixStr = 'midnight:token:pk:';
  for (let i = 0; i < prefixStr.length; i++) {
    prefix[i] = prefixStr.charCodeAt(i);
  }
  return persistentHash(
    {
      alignment: () => bytesType.alignment().concat(bytesType.alignment()),
      toValue: (v: Uint8Array[]) => bytesType.toValue(v[0]).concat(bytesType.toValue(v[1])),
      fromValue: () => {
        throw new Error('not needed');
      },
    },
    [prefix, secretKey],
  );
}
