import { ClaudeCodeDriver, claudeAccountsPath } from '@openagt/agent-driver-claude'
import { CodexDriver } from '@openagt/agent-driver-codex'
import { pickAccount, readAccounts, type Driver, type DriverModel } from '@openagt/agent-driver'
import { DRIVERS, type DriverName } from '../driver-names.js'

/** What one coding agent offers: its models, or why it could not say; `missing` when its CLI is not on the computer at all. */
export type DriverModels = { models: DriverModel[] } | { models: []; error: string; missing?: true }

/** The models of every coding agent a person can pick, by driver. */
export type ModelsView = Record<DriverName, DriverModels>

/** Where the dashboard reads which models each coding agent offers. */
export interface ModelsSource {
  read(): Promise<ModelsView>
}

/**
 * Ask each coding agent for its models, once per account: the first read asks, every later read
 * answers from what it said while the agent's runs take the same account first. The list changes
 * only with a new CLI version, a new login or another account, and each question starts a CLI, so
 * a menu opened again never waits on one. An agent that could not say is asked again at the next
 * read, so a CLI installed or logged in since is found. `whose` names the account an agent's runs
 * take first.
 */
export function cachedModelsSource(drivers: Record<DriverName, Pick<Driver, 'listModels'>>, whose: (name: DriverName) => string = () => ''): ModelsSource {
  const asked = new Map<DriverName, { account: string; answer: Promise<DriverModel[]> }>()
  const ask = (name: DriverName): Promise<DriverModels> => {
    const account = whose(name)
    let kept = asked.get(name)
    if (!kept || kept.account !== account) {
      const listModels = drivers[name].listModels
      const answer = listModels ? listModels.call(drivers[name]) : Promise.reject(new Error('this agent cannot list its models'))
      const asking = { account, answer }
      kept = asking
      asked.set(name, asking)
      answer.catch(() => {
        if (asked.get(name) === asking) asked.delete(name)
      })
    }
    return kept.answer.then(
      models => ({ models }),
      (err: unknown) => ({ models: [], error: err instanceof Error ? err.message : String(err), ...((err as NodeJS.ErrnoException).code === 'ENOENT' ? { missing: true as const } : {}) }),
    )
  }
  return {
    read: async () => Object.fromEntries(await Promise.all(DRIVERS.map(async name => [name, await ask(name)] as const))) as ModelsView,
  }
}

/** The daemon's own source: the coding agents on this machine, asked as the person's own login, on the Claude account runs take first. */
export function defaultModelsSource(): ModelsSource {
  const claudeFirst = (): string => {
    const first = pickAccount(readAccounts(claudeAccountsPath()), Date.now())
    return first ? `${first.name} ${first.accountId ?? ''}` : ''
  }
  return cachedModelsSource({ 'claude-code': new ClaudeCodeDriver({ accounts: {} }), codex: new CodexDriver() }, name => (name === 'claude-code' ? claudeFirst() : ''))
}
