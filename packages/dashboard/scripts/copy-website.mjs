// Build the website and copy it into `dist/website` (#1919).
//
// On an installed computer the website's own name is answered by the dashboard, so the dashboard
// carries the website, built from the same checkout: its landing page, its other pages and their
// files. What only the public host reads (its domain file, its Jekyll switch, Vite's manifest) is
// left out. Usage: `node scripts/copy-website.mjs`.
import { execFileSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const website = fileURLToPath(new URL('../../openagent.build/', import.meta.url))
const target = fileURLToPath(new URL('../dist/website/', import.meta.url))
const HOST_ONLY = new Set(['CNAME', '.nojekyll', '.vite'])

execFileSync('pnpm', ['run', 'build'], { cwd: website, stdio: 'inherit' })
rmSync(target, { recursive: true, force: true })
cpSync(`${website}dist/client`, target, { recursive: true, filter: source => !HOST_ONLY.has(basename(source)) })
