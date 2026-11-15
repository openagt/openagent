import react from '@vitejs/plugin-react'
import vike from 'vike/plugin'
import { defineConfig } from 'vite'
import { fontLicenses } from '../../scripts/font-licenses.mjs'

export default defineConfig({
  plugins: [react(), vike(), fontLicenses()],
})
