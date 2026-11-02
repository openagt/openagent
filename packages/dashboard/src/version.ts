import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * OpenAgent's version: this package's own, the one people install, read from its `package.json`
 * at runtime (#312). What this computer tells the machines it gets into and a phone.
 * The compiled file lives one level under the package root (`dist/` or `dist-test/`), so its
 * `package.json` is always `../package.json`. Cached after the first read; `unknown` if the file
 * is somehow unreadable, not `0.0.0`: the packages are unreleased and legitimately versioned
 * `0.0.0`, so a numeric stand-in would read as a real version.
 */
let cachedVersion: string | undefined
export function openagentVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    cachedVersion = pkg.version ?? 'unknown'
  } catch {
    cachedVersion = 'unknown'
  }
  return cachedVersion
}
