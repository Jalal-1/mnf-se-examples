import React from 'react';
import { NETWORKS, type NetworkConfig } from '../lib/config.js';

interface Props {
  selected: string;
  onChange: (key: string, config: NetworkConfig) => void;
  disabled?: boolean;
}

export function NetworkSelector({ selected, onChange, disabled }: Props) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-gray-400 font-medium">Network</label>
      <select
        value={selected}
        disabled={disabled}
        onChange={(e) => {
          const key = e.target.value;
          onChange(key, NETWORKS[key]);
        }}
        className="input w-48 cursor-pointer"
      >
        {Object.entries(NETWORKS).map(([key, net]) => (
          <option key={key} value={key}>
            {net.name}
          </option>
        ))}
      </select>
    </div>
  );
}
