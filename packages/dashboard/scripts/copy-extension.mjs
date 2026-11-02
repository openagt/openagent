// Copy the Claude web bridge extension into `dist/chrome-extension` (#1720).
//
// The package ships `dist` only, and the bridge browser installs the extension from its files,
// so without this copy the bridge browser only works from a checkout. The files copied are the
// extension's own `WATCHED_FILES`: every file Chrome loads, and the list its self-reload
// fingerprints. A file left out of the copy would switch that self-reload off without an error,
// so there is no second list to drift. Usage: `node scripts/copy-extension.mjs [<target dir>]`.
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const source = fileURLToPath(new URL('../../chrome-extension/', import.meta.url))
const target = process.argv[2] ?? fileURLToPath(new URL('../dist/chrome-extension/', import.meta.url))

const files = runInNewContext(`${readFileSync(join(source, 'fingerprint.js'), 'utf8')}\nWATCHED_FILES`)
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const file of files) copyFileSync(join(source, file), join(target, file))
