import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Compiles the gallery's Tailwind entry to one plain .css file, which build.mts inlines into
// every card. Separate from the app's vite.config.ts on purpose: no dev daemon, no React
// plugin — this build exists only to produce CSS.
export default defineConfig({
  plugins: [tailwindcss()],
  logLevel: 'warn',
  build: {
    outDir: fileURLToPath(new URL('./.css-build', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./gallery.css', import.meta.url)),
    },
  },
})
