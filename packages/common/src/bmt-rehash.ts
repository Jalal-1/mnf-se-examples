/**
 * BMT Rehash Wrapper
 *
 * Works around a bug in compact-js where LedgerStateValue.decode() produces
 * BoundedMerkleTrees without properly rehashed internal nodes.
 * Without this, any contract using MerkleTree<N, T> in ledger state crashes with:
 *   "attempted to take root of non-rehashed bmt"
 *
 * Usage: wrap your PublicDataProvider with wrapPublicDataProviderWithRehash()
 * in your app's configureProviders() if your contract uses MerkleTree state.
 */

type StateValue = {
  type: string;
  value: any;
  entries?: StateValue[];
};

type ContractState = {
  data: Map<string, StateValue>;
  [key: string]: any;
};

const rehashStateValue = (sv: StateValue): StateValue => {
  if (sv.type === 'boundedMerkleTree' && sv.value && typeof sv.value.rehash === 'function') {
    sv.value.rehash();
  }
  if (sv.type === 'array' && Array.isArray(sv.entries)) {
    sv.entries.forEach(rehashStateValue);
  }
  return sv;
};

const rehashContractState = <T extends ContractState>(cs: T | null): T | null => {
  if (cs === null) return null;
  for (const sv of cs.data.values()) {
    rehashStateValue(sv);
  }
  return cs;
};

/**
 * Wrap a PublicDataProvider to automatically rehash all BoundedMerkleTrees
 * in returned ContractState objects. Only needed for contracts that use
 * MerkleTree<N, T> in their ledger state.
 */
export const wrapPublicDataProviderWithRehash = (inner: any): any => {
  const wrapped = { ...inner };

  if (typeof inner.queryContractState === 'function') {
    wrapped.queryContractState = async (...args: any[]) => {
      const result = await inner.queryContractState(...args);
      return rehashContractState(result);
    };
  }

  if (typeof inner.queryZSwapAndContractState === 'function') {
    wrapped.queryZSwapAndContractState = async (...args: any[]) => {
      const result = await inner.queryZSwapAndContractState(...args);
      if (result?.contractState) {
        rehashContractState(result.contractState);
      }
      return result;
    };
  }

  if (typeof inner.queryDeployContractState === 'function') {
    wrapped.queryDeployContractState = async (...args: any[]) => {
      const result = await inner.queryDeployContractState(...args);
      return rehashContractState(result);
    };
  }

  return wrapped;
};
