import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DISTRIBUTION_ENV } from '@openagt/hooks'

/**
 * The package OpenAgent is installed as: the one that holds the distribution this process was
 * handed ({@link DISTRIBUTION_ENV}), such as `@openagt/dashboard`. People install it, update it
 * and see its version; `ui` is one of its dependencies.
 */
export interface OpenAgentPackage {
  name: string
  version: string
  /** Its folder, where it is installed. */
  dir: string
}

let cached: { file: string; found: OpenAgentPackage | undefined } | undefined

/**
 * OpenAgent's package: the nearest `package.json` with a name above the distribution's file;
 * none when no distribution was handed down. Read once per file.
 */
export function openagentPackage(env: NodeJS.ProcessEnv = process.env): OpenAgentPackage | undefined {
  const file = env[DISTRIBUTION_ENV]
  if (!file) return undefined
  if (cached?.file === file) return cached.found
  cached = { file, found: packageAbove(file) }
  return cached.found
}

function packageAbove(file: string): OpenAgentPackage | undefined {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
      if (typeof pkg.name === 'string' && pkg.name) return { name: pkg.name, version: typeof pkg.version === 'string' ? pkg.version : 'unknown', dir }
    } catch {
      // No package.json here, or none that reads: the folder above.
    }
    if (dirname(dir) === dir) return undefined
  }
}

/**
 * OpenAgent's version (#312): its package's ({@link openagentPackage}), what this computer tells
 * the machines it gets into and a phone. `unknown` when no distribution was handed down, not
 * `0.0.0`: the packages are unreleased and legitimately versioned `0.0.0`, so a numeric stand-in
 * would read as a real version.
 */
export function openagentVersion(): string {
  return openagentPackage()?.version ?? 'unknown'
}
