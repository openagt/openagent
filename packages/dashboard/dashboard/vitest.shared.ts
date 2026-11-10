import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * The vitest config of every directory of UI tests: the dashboard's own, and the `dashboard/` of each
 * package that brings a page or a Settings section. One config and one setup file, so a fix to how
 * the tests run (a timeout, a mock) lands in all of them.
 *
 * Deliberately NOT vite.config.ts: that one carries the dev-daemon and Tailwind plugins, which serve
 * the app and only get in the way here. The tests need the JSX transform, a DOM, and the module API
 * resolved to the dashboard's own source: a package's pages render inside a fake host and never load
 * the dashboard.
 *
 * `configUrl` is the calling config's `import.meta.url`; `setupFiles` are the directory's own, run
 * after the shared one.
 */
export function uiTestConfig(configUrl: string, own: { setupFiles?: string[] } = {}) {
  return defineConfig({
    // Pinned for the same reason as vite.config.ts: each directory sits in a package whose scripts
    // run one level up (A7), so the cwd is not the root these globs are written against.
    root: fileURLToPath(new URL('.', configUrl)),
    plugins: [react()],
    resolve: {
      alias: { '@openagt/dashboard/module': fileURLToPath(new URL('./module/index.ts', import.meta.url)) },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['**/*.test.ts', '**/*.test.tsx'],
      exclude: ['node_modules/**', 'dist/**'],
      setupFiles: [fileURLToPath(new URL('./vitest.setup.ts', import.meta.url)), ...(own.setupFiles ?? [])],
      // Comfortably above the setup file's 5s query ceiling (#886), so a test that does hit the
      // ceiling reports the element it was actually waiting for instead of dying on vitest's own
      // 5s limit first and naming nothing.
      testTimeout: 20_000,
    },
  })
}
