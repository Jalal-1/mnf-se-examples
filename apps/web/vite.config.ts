import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      process: 'process/browser',
      buffer: 'buffer',
      util: 'util',
      crypto: path.resolve(__dirname, 'src/lib/crypto-shim.ts'),
      stream: 'stream-browserify',
      events: 'events',
    },
  },
  plugins: [
    react(),
    wasm(),
    viteStaticCopy({
      targets: [
        { src: path.resolve(__dirname, '..', 'counter', 'contract', 'dist', 'managed', 'counter') + '/*', dest: 'contract/counter' },
        { src: path.resolve(__dirname, '..', 'token', 'contract', 'dist', 'managed', 'token') + '/*', dest: 'contract/token' },
        { src: path.resolve(__dirname, '..', 'fungible-token', 'contract', 'dist', 'managed', 'fungible-token') + '/*', dest: 'contract/fungible-token' },
        { src: path.resolve(__dirname, '..', 'nft', 'contract', 'dist', 'managed', 'nft') + '/*', dest: 'contract/nft' },
        { src: path.resolve(__dirname, '..', 'multi-token', 'contract', 'dist', 'managed', 'multi-token') + '/*', dest: 'contract/multi-token' },
        { src: path.resolve(__dirname, '..', 'access-control', 'contract', 'dist', 'managed', 'access-control') + '/*', dest: 'contract/access-control' },
        { src: path.resolve(__dirname, '..', 'election', 'contract', 'dist', 'managed', 'election') + '/*', dest: 'contract/election' },
      ],
    }),
  ],
  optimizeDeps: {
    include: ['level', 'browser-level', 'abstract-level', 'level-supports', 'level-transcoder'],
    esbuildOptions: { target: 'esnext' },
  },
  build: { target: 'esnext' },
  worker: { format: 'es' },
  assetsInclude: ['**/*.wasm'],
  publicDir: 'public',
  server: {
    port: 5173,
    fs: { allow: ['../..'] },
    proxy: {
      // Proof server endpoints (wallet SDK calls /prove, /check at origin)
      '/prove': { target: 'http://127.0.0.1:6300', changeOrigin: true },
      '/check': { target: 'http://127.0.0.1:6300', changeOrigin: true },
      '/version': { target: 'http://127.0.0.1:6300', changeOrigin: true },
      // Indexer GraphQL HTTP (WebSocket goes direct, no CORS issue)
      '/api/v3': { target: 'http://127.0.0.1:8088', changeOrigin: true },
    },
  },
});
