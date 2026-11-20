import { codingAgents } from '@openagt/agent-driver'
import type { AgentLogins } from '@openagt/hooks'
import { accountsPath } from './accounts.js'
import { addingPath, startAddingProcess } from './adding.js'

// Everything adding, removing and reading the accounts reach for beyond the list itself, in one
// place: the coding agents' own part of their accounts (`RunAgent.accounts`, the distribution's),
// the files beside the accounts, and the processes a sign-in runs in. The modules that use it take
// it as a value, so a test hands them its own; only this one knows the real ones.

/** What adding, removing and reading the accounts reach for, swapped in tests. */
export interface LoginWiring {
  /** The coding agents' accounts, one for each list: those of the distribution handed down to this process. */
  logins: () => Promise<readonly AgentLogins[]>
  /** Where a list's accounts are. */
  path: (list: string) => string
  now: () => number
  /** The environment the agents' own logins are read in. */
  env: NodeJS.ProcessEnv
  /** No browser on this computer: a server's, or a Linux computer with no display. The person signs in on another device. */
  headless: () => boolean
  /** Where a list's sign-in says how it goes. */
  addingPath: (list: string) => string
  /** Start a list's sign-in, on its own: what the sign-in itself runs is `signIn` (`login.ts`). */
  startAdding: (list: string, name: string) => void
  /** This process, as a sign-in says it runs in it. */
  ownPid: () => number
  /** Whether a sign-in's process is still there. */
  isRunning: (pid: number) => boolean
  /** Stop a sign-in's process. */
  stopAdding: (pid: number) => void
}

/** The coding agents' accounts, one for each list, the first agent's where two name one. */
export async function agentLogins(env: NodeJS.ProcessEnv = process.env): Promise<AgentLogins[]> {
  const logins: AgentLogins[] = []
  for (const agent of await codingAgents(undefined, env)) if (agent.accounts && !logins.some(one => one.list === agent.accounts!.list)) logins.push(agent.accounts)
  return logins
}

/** The logins of the user `env` is. */
export function loginWiring(env: NodeJS.ProcessEnv = process.env): LoginWiring {
  return {
    logins: () => agentLogins(env),
    path: list => accountsPath(list, env),
    now: Date.now,
    env,
    headless: () => env['OPENAGENT_SERVER'] === '1' || (process.platform === 'linux' && !env['DISPLAY'] && !env['WAYLAND_DISPLAY']),
    addingPath: list => addingPath(list, env),
    startAdding: startAddingProcess,
    ownPid: () => process.pid,
    isRunning: pid => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },
    stopAdding: pid => {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // Gone already.
      }
    },
  }
}
