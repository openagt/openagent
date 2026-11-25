import { useEffect, useState } from 'react'
import { NO_PROJECT, rpcClient, useAskOn, useModuleHost, usePolled, type ModuleHost, type ReadState } from '@openagt/ui/module'
import type { AccountsRead } from '../src/server.js'

// The module's calls of its own server part (`../src/server.ts`), typed by it. OpenAgent's GitHub
// accounts are this computer's, so they are read in no project of the dashboard's (`NO_PROJECT`).
// Each call throws the reason it failed, so a polled read keeps the last answer it had.

export type { AccountsRead, Carries, GithubAccount, PrHandoff, Pressed } from '../src/server.js'

/** The client of the server part, for a host that calls in a project: a place's (`UiHost`) or a view's (`ModuleHost`). */
export const server = (host: Pick<ModuleHost, 'call'>) => rpcClient<typeof import('../src/server.js')>(host)

/** OpenAgent's GitHub accounts, read once. */
export function readAccounts(host: Pick<ModuleHost, 'call'>): Promise<AccountsRead> {
  return server(host).accounts(NO_PROJECT, {})
}

/** How often the accounts are read again: often while something is under way (an install, the browser's yes), less while something is missing, seldom once all is there. */
const BUSY_MS = 2_000
const MISSING_MS = 8_000
const SELDOM_MS = 30_000

/** Where the accounts stand, said by a colour: green when there is nothing to do, amber for a step to take, grey for gh not here. */
export type LoginState = 'connected' | 'step' | 'not-installed'

export function loginState(read: AccountsRead): LoginState {
  if (!read.installed) return 'not-installed'
  return read.accounts.length > 0 && read.accounts.every(account => account.ok) ? 'connected' : 'step'
}

/** What is missing for the accounts, in words. */
export function missingWords(read: AccountsRead): string {
  return !read.installed ? `${read.tool}, the tool for ${read.name}, is not installed.` : read.accounts.length === 0 ? `OpenAgent has no ${read.name} account yet.` : `${read.name} no longer takes a login: add it again.`
}

/**
 * OpenAgent's GitHub accounts, read again at the pace the last answer calls for. The answer is
 * kept in this browser too: a place that opens later (the gear's menu, the next load's
 * Permissions) shows it from its first frame, never empty while the same question is asked again.
 */
export function useAccounts(): { accounts: AccountsRead | undefined; state: ReadState; reload: () => Promise<void> } {
  const host = useModuleHost()
  const [every, setEvery] = useState(SELDOM_MS)
  const { value, state, reload, refresh } = usePolled<AccountsRead | undefined>(() => readAccounts(host), undefined, every, [], { remember: 'github:accounts', stored: true })
  useAskOn(every, refresh)
  const next = value?.installing || value?.loggingIn ? BUSY_MS : value && loginState(value) !== 'connected' ? MISSING_MS : SELDOM_MS
  useEffect(() => {
    if (next !== every) setEvery(next)
  }, [next, every])
  return { accounts: value, state, reload }
}
