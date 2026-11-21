import { defineModule, type RunAgent } from '@openagt/hooks'
import { CodexDriver, codexReady, type CodexReadyOptions } from './codex.js'
import { codexLogins } from './logins.js'

/**
 * Codex as a coding agent runs are on (`run.agent`, #2394). A run's sessions have full access: the
 * default sandbox keeps the agent in its workspace, which would stop it pushing its branch and
 * opening its pull request. Its turns take the person's Codex accounts, the list `codex`
 * ({@link codexLogins}). `checks` is how its CLI and the person's skills are asked, swapped in tests.
 */
export function codexAgent(checks: Pick<CodexReadyOptions, 'probe' | 'isRoot' | 'agentsSkills'> = {}): RunAgent {
  return {
    id: 'codex',
    label: 'Codex',
    accounts: codexLogins(),
    ready: ({ personal, addedAccount }) => codexReady({ ...checks, personal, addedAccount }),
    driver: ({ env, personal, accounts }) => new CodexDriver({ sandbox: 'danger-full-access', env, personal, ...(accounts ? { accounts } : {}) }),
  }
}

export default defineModule({ name: 'agent-driver-codex', hooks: { 'run.agent': [codexAgent()] } })
