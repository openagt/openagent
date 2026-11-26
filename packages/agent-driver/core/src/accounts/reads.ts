import { hostname } from 'node:os'
import type { AgentLogins } from '@openagt/hooks'
import { OWN_NAME, readAccounts, shownAccounts, type ShownAccount } from './accounts.js'
import { addingNow, type AddingNow } from './adding.js'
import type { LoginWiring } from './wiring.js'

// What the command's reads answer (`list`, `adding`), for the command and for the server part the
// card reads through alike.

/** An agent's account as `list` says it. */
export type ListedAccount = ShownAccount & { who?: string; signedOut?: true; computer?: string }

/**
 * A list's accounts as `list` says them. The person's own says the computer it is a login on, who
 * it is while it goes by no name they gave it, as `who`, and `signedOut` when the agent has no login
 * of theirs: runs skip it then. Commands still take its `name`.
 */
export async function listed(logins: AgentLogins, wiring: LoginWiring): Promise<ListedAccount[]> {
  const accounts = shownAccounts(readAccounts(wiring.path(logins.list)))
  const there = logins.ownLoginThere(wiring.env)
  const unnamed = (a: ShownAccount): boolean => a.name === OWN_NAME
  const who = accounts.some(a => a.own && unnamed(a)) ? await logins.ownName(wiring.env) : undefined
  const computer = hostname().replace(/\.local$/i, '')
  // An added one whose login is gone from this computer is signed out too: signed in to again under its name.
  const added = readAccounts(wiring.path(logins.list))
  const outOfAdded = (a: ShownAccount): boolean => {
    const account = added.find(one => one.name === a.name && one.login !== undefined)
    return account !== undefined && logins.addedLoginThere?.(account, wiring.env) === false
  }
  return accounts.map(a => (a.own ? { ...a, computer, ...(unnamed(a) && who !== undefined ? { who } : {}), ...(there ? {} : { signedOut: true as const }) } : outOfAdded(a) ? { ...a, signedOut: true as const } : a))
}

/** What `list` answers: each list's accounts by its name, in the order runs try them, and the lists whose agent's program this computer does not have. */
export interface Listing {
  [list: string]: ListedAccount[] | string[]
  notInstalled: string[]
}

export async function listing(wiring: LoginWiring): Promise<Listing> {
  const all = await wiring.logins()
  const [lists, installed] = await Promise.all([Promise.all(all.map(logins => listed(logins, wiring))), Promise.all(all.map(logins => logins.installed()))])
  return { ...Object.fromEntries(all.map((logins, at) => [logins.list, lists[at]!])), notInstalled: all.filter((_, at) => !installed[at]).map(logins => logins.list) }
}

/** What `adding` answers: how adding stands for each list. */
export async function addingAll(wiring: LoginWiring): Promise<Record<string, AddingNow>> {
  return Object.fromEntries((await wiring.logins()).map(logins => [logins.list, addingNow(logins.list, wiring)]))
}
