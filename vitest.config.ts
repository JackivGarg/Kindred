import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// PostgreSQL/WASM fixtures and browser-like component tests are memory-intensive.
// Bound concurrency instead of extending timeouts or sharing isolated test state.
export default mergeConfig(viteConfig, defineConfig({ test: { maxWorkers: 4 } }));
