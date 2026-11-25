import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where the sessions with no project work: `$XDG_CONFIG_HOME/openagent-sessions` when that is set,
 * beside the personal folder, else `~/.openagent-sessions`. The shell serves it as the sessions'
 * own place, and starts a run with no project there; the modules make each session's folder in it
 * (git-branches), keep its records (store-filesystem) and sweep it (agent-driver). It sits beside
 * the personal folder, not in it: the personal folder is committed whole and synced to the
 * person's repository, and a session's folder holds its work, not its record.
 */
export function sessionsHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'openagent-sessions')
  return join(env.HOME || homedir(), '.openagent-sessions')
}
