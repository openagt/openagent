import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, include: ['**/*.test.ts', '**/*.test.tsx'], setupFiles: ['./vitest.setup.ts'], testTimeout: 20_000 },
})
