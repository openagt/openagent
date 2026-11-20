import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// The bridge's key (#1237), and the folder this plugin keeps its own files in on this computer.
// The extension shows the key on each call to the bridge, which is the one address of OpenAgent's
// that a caller from elsewhere may reach: what keeps other callers out.

/**
 * This plugin's own folder on this computer: `$XDG_CONFIG_HOME/openagent-claude-web` when that is
 * set, else `~/.openagent-claude-web`. Never synced. It holds the bridge's key and the browser
 * OpenAgent runs for the extension, its profile signed in to claude.ai.
 */
export function claudeWebDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'openagent-claude-web') : join(env.HOME ?? homedir(), '.openagent-claude-web')
}

const TOKEN_FILE = 'token'

/** The bridge's key, as kept; none before the plugin was first switched on. */
export async function readToken(dir: string = claudeWebDir()): Promise<string | undefined> {
  const kept = (await readFile(join(dir, TOKEN_FILE), 'utf8').catch(() => '')).trim()
  return kept || undefined
}

/**
 * The bridge's key: the one kept, or a new one, kept from now on. Its file is the person's alone,
 * as its folder is: the key lets a caller read the prompts of the sessions this computer starts.
 */
export async function ensureToken(dir: string = claudeWebDir()): Promise<string> {
  const kept = await readToken(dir)
  if (kept) return kept
  const token = randomBytes(32).toString('base64url')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700).catch(() => {})
  const writing = join(dir, `.${TOKEN_FILE}.${process.pid}`)
  await writeFile(writing, token + '\n', { mode: 0o600 })
  await rename(writing, join(dir, TOKEN_FILE))
  return token
}
