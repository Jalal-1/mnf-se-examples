import type { Buffer } from 'buffer';

declare global {
  // eslint-disable-next-line no-var
  var Buffer: typeof Buffer;
  // eslint-disable-next-line no-var
  var process: NodeJS.Process;

  interface Window {
    midnight?: Record<string, unknown>;
  }
}

export {};
