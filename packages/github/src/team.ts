import { ownedFor, ownerOf, ownsIt, sameLogin, type TeamCaller } from '@openagt/hooks'
import { changeTeamPicks, picksPath, readTeamPicks, type TeamPicks } from './accounts.js'
import type { GithubAccount, GithubAccounts } from './cli.js'

// OpenAgent's GitHub accounts on a machine shared by a team (Team mode): each is its adder's (one
// from before, the team owner's), its owner shares it with the team or not, and each person picks
// the one their runs use. What a person sees, picks and works as is theirs and the shared ones.

/** One account as the team's word says it: whose, and whether shared. */
function owned(team: TeamPicks, login: string): { owner?: string; shared?: boolean } {
  const owner = team.owners[login]
  return { ...(owner !== undefined ? { owner } : {}), ...(team.shared.includes(login) ? { shared: true } : {}) }
}

/** The logins `caller` may work as, theirs first, in the folders' order. */
export function loginsFor(caller: TeamCaller, logins: readonly string[], path: string = picksPath()): string[] {
  const team = readTeamPicks(path)
  const theirs = logins.filter(login => ownsIt(caller, owned(team, login)))
  const shared = logins.filter(login => !theirs.includes(login) && ownedFor(caller, owned(team, login)))
  return [...theirs, ...shared]
}

/** The account `caller`'s runs use: their pick while they may still use it, else their first, else a shared one; none when there is none. */
export function runsLoginFor(caller: TeamCaller, logins: readonly string[], path: string = picksPath()): string | undefined {
  const usable = loginsFor(caller, logins, path)
  const picked = readTeamPicks(path).runsFor[caller.login.toLowerCase()]
  return (picked !== undefined ? usable.find(login => sameLogin(login, picked)) : undefined) ?? usable[0]
}

/**
 * The login a run of `caller`'s works as: `wanted` (the session's pick, or the one picked for every
 * next run), when it is theirs or shared, else their runs' one. Refused when `wanted` is someone
 * else's: a run never goes as an account its person may not use.
 */
export function teamLogin(caller: TeamCaller, wanted: string | undefined, logins: readonly string[], path: string = picksPath()): string | undefined {
  const usable = loginsFor(caller, logins, path)
  if (wanted !== undefined) {
    const found = usable.find(login => sameLogin(login, wanted))
    if (found === undefined) throw new Error(`@${wanted} is not your GitHub account here, and nobody shared it with the team.`)
    return found
  }
  return runsLoginFor(caller, logins, path)
}

/** The accounts as `caller` sees them: theirs and the shared ones, each saying whose, and "runs" on their own runs' one. */
export function accountsFor(read: GithubAccounts, caller: TeamCaller | undefined, path: string = picksPath()): GithubAccounts {
  if (!caller) return read
  const team = readTeamPicks(path)
  const logins = read.accounts.map(account => account.login)
  const usable = loginsFor(caller, logins, path)
  const runs = runsLoginFor(caller, logins, path)
  const accounts = usable.flatMap((login): GithubAccount[] => {
    const account = read.accounts.find(one => one.login === login)
    if (!account) return []
    const own = owned(team, login)
    return [{ ...account, runs: login === runs, of: ownerOf(caller, own), mine: ownsIt(caller, own), ...(own.shared ? { shared: true } : {}) }]
  })
  return { ...read, accounts }
}

/** `caller`'s runs use `login` from now on: theirs, or a shared one. */
export function useForRunsAs(caller: TeamCaller, login: string, logins: readonly string[], path: string = picksPath()): void {
  if (!loginsFor(caller, logins, path).some(one => sameLogin(one, login))) throw new Error(`@${login} is not your GitHub account here, and nobody shared it with the team.`)
  changeTeamPicks(team => ({ ...team, runsFor: { ...team.runsFor, [caller.login.toLowerCase()]: login } }), path)
}

/** `login` shared with the team, or not: only its owner does it. */
export function shareAs(caller: TeamCaller, login: string, on: boolean, path: string = picksPath()): void {
  const team = readTeamPicks(path)
  if (!ownsIt(caller, owned(team, login))) throw new Error(`@${login} is someone else’s: only they share it.`)
  changeTeamPicks(now => ({ ...now, shared: on ? [...now.shared.filter(one => one !== login), login] : now.shared.filter(one => one !== login) }), path)
}

/** Whether `caller` may take `login` off: only its owner. */
export function mayForget(caller: TeamCaller | undefined, login: string, path: string = picksPath()): boolean {
  return ownsIt(caller, owned(readTeamPicks(path), login))
}

/** The login about to be started is for `caller`: the account it adds is theirs. */
export function addingFor(caller: TeamCaller | undefined, path: string = picksPath()): void {
  if (!caller) return
  changeTeamPicks(team => ({ ...team, adding: caller.login }), path)
}
