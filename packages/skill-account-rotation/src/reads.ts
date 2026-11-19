import { hostname } from 'node:os'
import { handedOverBy, OWN_NAME, readAccounts, shownAccounts, type AccountsAgent, type ShownAccount } from './accounts.js'
import { addingNow, type AddingNow } from './adding.js'
import { ownLoginThere, ownName } from './login.js'
import type { LoginWiring } from './wiring.js'

// What the command's reads answer (`list`, `adding`), for the command and for the server part the
// card reads through alike.

/** An agent's account as `list` says it. */
export type ListedAccount = ShownAccount & { who?: string; signedOut?: true; computer?: string; from?: string; comesBack?: true }

/**
 * An agent's accounts as `list` says them. The person's own says the computer it is a login on, who
 * it is while it goes by no name they gave it, as `who`, and `signedOut` when the agent has no login
 * of theirs: runs skip it then. Commands still take its `name`. On a server, one a computer of the
 * person's handed over says which, as `from`, and `comesBack` when removing it here would only bring it back.
 */
export async function listed(agent: AccountsAgent, wiring: LoginWiring): Promise<ListedAccount[]> {
  const accounts = shownAccounts(readAccounts(wiring.path(agent)))
  const there = ownLoginThere(agent, wiring)
  const unnamed = (a: ShownAccount): boolean => a.name === OWN_NAME
  const who = accounts.some(a => a.own && unnamed(a)) ? await ownName(agent, wiring) : undefined
  const computer = hostname().replace(/\.local$/i, '')
  const handedOver = handedOverBy(agent, wiring.env)
  return accounts.map(a => {
    if (a.own) return { ...a, computer, ...(unnamed(a) && who !== undefined ? { who } : {}), ...(there ? {} : { signedOut: true as const }) }
    const handed = handedOver.get(a.name)
    return handed ? { ...a, from: handed.from, ...(handed.comesBack ? { comesBack: true as const } : {}) } : a
  })
}

/** What `list` answers: each agent's accounts in the order runs try them, and the agents whose program this computer does not have. */
export interface Listing {
  claude: ListedAccount[]
  codex: ListedAccount[]
  notInstalled: AccountsAgent[]
}

export async function listing(wiring: LoginWiring): Promise<Listing> {
  const agents = ['claude', 'codex'] as const
  const [claude, codex, installed] = await Promise.all([listed('claude', wiring), listed('codex', wiring), Promise.all(agents.map(each => wiring.installed(each)))])
  return { claude, codex, notInstalled: agents.filter((_, at) => !installed[at]) }
}

/** What `adding` answers: how adding stands for each agent. */
export function addingBoth(wiring: LoginWiring): Record<AccountsAgent, AddingNow> {
  return { claude: addingNow('claude', wiring), codex: addingNow('codex', wiring) }
}
