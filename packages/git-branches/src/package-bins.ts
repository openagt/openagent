import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * A package's commands as its package.json names them: what git-branches links into a checkout's
 * own bin directory, so a run's agent types a module's command by its name.
 */

/** The fields of a package.json this module reads; anything else is ignored. */
export interface PackageManifest {
  name?: unknown
  bin?: unknown
}

export async function readManifest(path: string): Promise<PackageManifest | undefined> {
  try {
    const data: unknown = JSON.parse(await readFile(path, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as PackageManifest) : undefined
  } catch {
    return undefined
  }
}

/** A package's commands: `bin` as one path (named after the package) or as a name → path map. */
export function packageBins(name: string, bin: unknown, pkgDir: string): Record<string, string> {
  if (typeof bin === 'string') return { [name.replace(/^@[^/]+\//, '')]: join(pkgDir, bin) }
  if (!bin || typeof bin !== 'object' || Array.isArray(bin)) return {}
  const bins: Record<string, string> = {}
  for (const [command, path] of Object.entries(bin)) if (typeof path === 'string') bins[command] = join(pkgDir, path)
  return bins
}
