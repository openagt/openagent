import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * OpenAgent's version: this package's own, the one people install, read from its `package.json`
 * at runtime (#312). Handed to the dashboard, which tells it to machines and a phone.
 * The compiled entry lives one level under the package root (`dist/` or
 * `dist-test/`), so its `package.json` is always `../package.json`. Cached after
 * the first read; falls back to `unknown` if the file is somehow unreadable.
 */
let cachedVersion: string | undefined
export function openagentVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    // `unknown`, not `0.0.0`: the packages are unreleased and legitimately versioned `0.0.0`, so a
    // numeric fallback would make a failed read indistinguishable from a correct one (#312).
    cachedVersion = pkg.version ?? 'unknown'
  } catch {
    cachedVersion = 'unknown'
  }
  return cachedVersion
}
