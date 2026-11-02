import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Locate the built dashboard bundle (#405): `dist/dashboard-bundle`, where Vite
 * writes it. Returns the directory only when its `index.html` exists, else undefined (the caller
 * then serves the legacy page.ts). Shared by the daemon and the per-agent foreground dashboard (#427).
 *
 * One path, because there is one layout. The dashboard used to be its own package, so a published
 * install read a copy of the bundle under this package's dist while the workspace read the original
 * under the other package's — two candidates, a copy step, and a turbo task to sequence them. Now
 * Vite writes here directly and both cases are the same directory (A7).
 */
export async function resolveDashboardBundle(): Promise<string | undefined> {
  // Resolved from the package root rather than from this module, so the answer is the same
  // directory whether this is running out of `dist/`, `dist-test/`, or `src/` — all three sit one
  // level under the package, and the bundle is only ever built once, into `dist/`.
  const here = dirname(fileURLToPath(import.meta.url)) // <pkg>/{dist,dist-test,src}/dashboard
  const dir = join(here, '..', '..', 'dist', 'dashboard-bundle')
  return (await stat(join(dir, 'index.html')).then(s => s.isFile()).catch(() => false)) ? dir : undefined
}
