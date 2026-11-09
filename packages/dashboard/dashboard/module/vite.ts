import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig as defineBuild, type UserConfig } from 'vite'
import { defineConfig as defineTests, type ViteUserConfig } from 'vitest/config'

// How a module package builds and tests its dashboard part, the same for every module: its
// `dashboard/vite.config.ts` is `export default moduleBuild(import.meta.url)`, its
// `dashboard/vitest.config.ts` is `export default moduleTests(import.meta.url)`, the URL naming
// the module's `dashboard/` folder.

/**
 * The module's build: one browser module, `dist/dashboard/dashboard.js`, plus its stylesheet. React
 * and `@openagt/dashboard/module` stay bare imports: the dashboard's import map supplies its own
 * running copies, so the module shares the page's React and components instead of bundling them.
 */
export function moduleBuild(configUrl: string): UserConfig {
  const at = (path: string) => fileURLToPath(new URL(path, configUrl))
  return defineBuild({
    root: at('.'),
    plugins: [tailwindcss()],
    build: {
      outDir: at('../dist/dashboard'),
      emptyOutDir: true,
      lib: {
        entry: at('./index.tsx'),
        formats: ['es'],
        fileName: () => 'dashboard.js',
        cssFileName: 'dashboard',
      },
      rollupOptions: {
        external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@openagt/dashboard/module'],
      },
    },
  })
}

/**
 * The module's unit tests: the JSX transform, a DOM, and `@openagt/dashboard/module` with its test
 * kit, `@openagt/dashboard/module/testing`, resolved to OpenAgent's own source, since the tests
 * render the module inside a fake host and never load the dashboard.
 */
export function moduleTests(configUrl: string): ViteUserConfig {
  const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
  return defineTests({
    root: fileURLToPath(new URL('.', configUrl)),
    plugins: [react()],
    resolve: {
      alias: [
        { find: /^@openagt\/dashboard\/module$/, replacement: here('./index.ts') },
        { find: /^@openagt\/dashboard\/module\/testing$/, replacement: here('./testing.tsx') },
      ],
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['**/*.test.ts', '**/*.test.tsx'],
      exclude: ['node_modules/**', 'dist/**'],
      setupFiles: [here('./vitest.setup.ts')],
      // Comfortably above the setup's 5s query ceiling, so a test that does hit the ceiling reports
      // the element it was waiting for instead of dying on vitest's own 5s limit first.
      testTimeout: 20_000,
    },
  })
}
