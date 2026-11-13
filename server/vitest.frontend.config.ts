import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('../extensions/app-home', import.meta.url)),
  test: { globals: true, include: ['tests/**/*.spec.ts'] },
});
