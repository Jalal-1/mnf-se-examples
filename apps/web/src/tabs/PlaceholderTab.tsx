import React from 'react';

interface Props {
  name: string;
}

const LABELS: Record<string, string> = {
  token: 'Token',
  election: 'Election',
  'fungible-token': 'Fungible Token',
  nft: 'NFT',
  'multi-token': 'Multi Token',
  'access-control': 'Access Control',
};

export function PlaceholderTab({ name }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-96 text-gray-500">
      <h2 className="text-2xl font-semibold mb-2">{LABELS[name] ?? name}</h2>
      <p className="text-gray-600">Coming soon</p>
    </div>
  );
}
