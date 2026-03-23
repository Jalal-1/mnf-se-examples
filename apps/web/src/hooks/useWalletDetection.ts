import { useState, useEffect } from 'react';

export interface InitialWalletAPI {
  name: string;
  icon: string;
  apiVersion: string;
  connect: (networkId: string) => Promise<unknown>;
}

export function useWalletDetection(): {
  wallets: InitialWalletAPI[];
  isSearching: boolean;
} {
  const [wallets, setWallets] = useState<InitialWalletAPI[]>([]);
  const [isSearching, setIsSearching] = useState(true);

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 40; // 20 seconds

    const poll = setInterval(() => {
      attempts++;
      const midnight = (window as Window & { midnight?: Record<string, unknown> }).midnight;

      if (midnight) {
        const found: InitialWalletAPI[] = [];
        for (const key of Object.keys(midnight)) {
          const candidate = midnight[key];
          if (
            candidate &&
            typeof candidate === 'object' &&
            'name' in candidate &&
            'connect' in candidate &&
            typeof (candidate as Record<string, unknown>).connect === 'function'
          ) {
            found.push(candidate as unknown as InitialWalletAPI);
          }
        }
        if (found.length > 0) {
          setWallets(found);
          setIsSearching(false);
          clearInterval(poll);
          return;
        }
      }

      if (attempts >= maxAttempts) {
        setIsSearching(false);
        clearInterval(poll);
      }
    }, 500);

    return () => clearInterval(poll);
  }, []);

  return { wallets, isSearching };
}
