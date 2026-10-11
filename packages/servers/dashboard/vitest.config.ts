import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Unit tests for the module's Settings section: the JSX transform, a DOM, and `@openagt/dashboard/module` resolved to
// OpenAgent's own source, since the tests render the pages inside a fake host and never
// load the dashboard.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: { '@openagt/dashboard/module': fileURLToPath(new URL('../../openagent/dashboard/module/index.ts', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 20_000,
  },
})
