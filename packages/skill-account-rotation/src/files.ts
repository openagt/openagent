import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// Where the package keeps its files, and how it writes one. Each file is the user's own, beside
// OpenAgent's other files, and may hold a login or a page to sign in at: readable by that user only.

/** The file `name` of the user `env` is: `$XDG_CONFIG_HOME/<name>` when that is set, else `~/.<name>`. */
export function configFile(name: string, env: NodeJS.ProcessEnv): string {
  return env['XDG_CONFIG_HOME'] ? join(env['XDG_CONFIG_HOME'], name) : join(env['HOME'] ?? homedir(), `.${name}`)
}

/**
 * `text` as the whole of the file at `path`, readable by this user only: written to a new file of
 * that mode, then moved over the old one, so a reader never sees half of it, nor anyone else any.
 */
export function writePrivate(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const next = `${path}.${process.pid}.new`
  writeFileSync(next, text, { mode: 0o600 })
  chmodSync(next, 0o600)
  renameSync(next, path)
}
