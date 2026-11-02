import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Unit tests for the dashboard's hooks and components. Deliberately NOT vite.config.ts:
// that one carries the dev-daemon and Tailwind plugins, which serve the app and only get in the
// way here. All the unit tests need is the JSX transform.
export default defineConfig({
  // Pinned for the same reason as vite.config.ts: the dashboard is a directory in a package whose
  // scripts run one level up (A7), so the cwd is not the root these globs are written against.
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**'],
    setupFiles: ['./vitest.setup.ts'],
    // Comfortably above the setup file's 5s query ceiling (#886), so a test that does hit the
    // ceiling reports the element it was actually waiting for instead of dying on vitest's own
    // 5s limit first and naming nothing.
    testTimeout: 20_000,
  },
})
