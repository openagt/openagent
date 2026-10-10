import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The module's build: one browser module, `dist/dashboard/dashboard.js`, plus its stylesheet. React
// and `@openagt/dashboard/module` stay bare imports: the dashboard's import map supplies its own running
// copies, so the module shares the page's React and components instead of bundling them.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('../dist/dashboard', import.meta.url)),
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./index.tsx', import.meta.url)),
      formats: ['es'],
      fileName: () => 'dashboard.js',
      cssFileName: 'dashboard',
    },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@openagt/dashboard/module'],
    },
  },
})
