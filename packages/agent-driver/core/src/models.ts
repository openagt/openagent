import type { DriverModel, RunAgent } from '@openagt/hooks'
import { accountsPath, pickAccount, readAccounts } from './accounts/accounts.js'

// Which models a coding agent offers (`RunAgent.models`), as the agent itself answers. An adapter
// asks its agent once per account, so every surface that names a model reads it freely: the list
// changes only with a new CLI version, a new login or another account, and each question starts a
// CLI, so a menu opened again never waits on one.

/** What one coding agent offers: its models, or why it could not say; `missing` when its CLI is not on the computer, or not one it can run. */
export type AgentModels = { models: DriverModel[] } | { models: []; error: string; missing?: true }

/** An agent's models as asked once per account: `read` answers what it said while its runs take the same account first; `fresh` asks again. */
export interface ModelsAsked {
  read(opts?: { fresh?: boolean }): Promise<DriverModel[]>
}

/**
 * Ask a coding agent for its models (`ask`), once per account: the first read asks, every later
 * read answers from what it said while the agent's runs take the same account first (`whose`
 * names it). An agent that could not say is asked again at the next read, so a CLI installed or
 * logged in since is found; a read with `fresh` asks again whatever it said, as after an update.
 */
export function modelsAskedOnce(ask: () => Promise<DriverModel[]>, whose: () => string = () => ''): ModelsAsked {
  let kept: { account: string; answer: Promise<DriverModel[]> } | undefined
  return {
    read({ fresh = false } = {}) {
      const account = whose()
      if (fresh || !kept || kept.account !== account) {
        const asking = { account, answer: ask() }
        kept = asking
        asking.answer.catch(() => {
          if (kept === asking) kept = undefined
        })
      }
      return kept.answer
    },
  }
}

/** Which account a list's runs take first on this machine, as {@link modelsAskedOnce} tells two apart. */
export function firstAccountOf(list: string, env: NodeJS.ProcessEnv = process.env): string {
  const account = pickAccount(readAccounts(accountsPath(list, env)), Date.now())
  return account ? `${account.name} ${account.accountId ?? ''}` : ''
}

/** What `agent` says it offers, or why it could not say: in words, and whether its program is missing. */
export async function modelsOf(agent: RunAgent, opts: { fresh?: boolean } = {}): Promise<AgentModels> {
  if (!agent.models) return { models: [], error: 'this agent cannot list its models' }
  return agent.models(opts).then(
    models => ({ models }),
    (err: unknown) => ({ models: [], error: err instanceof Error ? err.message : String(err), ...(['ENOENT', 'EACCES'].includes(String((err as NodeJS.ErrnoException).code)) ? { missing: true as const } : {}) }),
  )
}
