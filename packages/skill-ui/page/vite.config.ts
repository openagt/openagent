import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { hostInputs, hostModules, type HostFile } from '../dist/host-modules.js'

// The page `npx @openagt/skill-ui` serves, built into the package: `dist/page`. What it shares with
// a skill is what OpenAgent's dashboard shares, minus the dashboard's own name.
const contract = fileURLToPath(new URL('../dist/module/index.js', import.meta.url))
const SHARED: Record<string, HostFile> = { '@openagt/skill-ui/module': { entry: 'skill-ui', file: contract } }

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [hostModules(SHARED), react(), tailwindcss()],
  resolve: { alias: { '@openagt/skill-ui/module': contract } },
  build: {
    outDir: fileURLToPath(new URL('../dist/page', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), ...hostInputs(SHARED) },
      preserveEntrySignatures: 'exports-only',
    },
  },
})
