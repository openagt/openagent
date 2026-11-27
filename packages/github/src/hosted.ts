import { isRepoOwner, readRepoOwners, writeRepoOwners } from '@openagt/projects'
import { readdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TeamCaller } from '@openagt/hooks'
import { HOST } from './accounts.js'
import { cliAnswer, hostAccounts } from './host-accounts.js'
import { isTeammate, loginsFor, readTeammateOwners, teammateFolder, writeTeammateOwners } from './team.js'

// The repositories on GitHub the project picker lists beside the ones on this computer (Rom's
// design: "GitHub users/orgs, and the OA accounts' repos", `composer.where`): each of OpenAgent's
// accounts lists its own, as itself, and each user or organization the person named (Settings ›
// GitHub) is listed as the account runs use (`github repos`). The lists are read in the background
// and kept, so the picker never waits on GitHub but the first time.

/** A repository on GitHub, not looked for on this computer. */
export interface HostedRepo {
  /** `github.com/<owner>/<name>`: what a clone is asked for. */
  address: string
  url: string
  private: boolean
  description?: string
  /** When it was last pushed to, ISO. */
  pushedAt?: string
  /** Why it is listed: the account it is one of, or the owner the person named. */
  from: string
}

/** How old the kept lists may be before a read asks the hosts again, behind the answer. */
export const HOSTED_MAX_AGE_MS = 10 * 60_000

/** How long a first read waits for the hosts before it answers with nothing yet. */
export const HOSTED_FIRST_WAIT_MS = 1500

/** What a read answers: the lists as kept, and whether the hosts are being asked now. */
export interface HostedRead {
  repos: HostedRepo[]
  loading: boolean
  /** A host did not answer the last time it was asked: its repositories are missing from the lists. */
  unreached?: true
}

/** What a listing is asked through: the package's own command, and OpenAgent's accounts and the person's owners. */
export const hostedWiring = {
  run: (_host: string, args: string[]) => cliAnswer(args),
  hosts: () => hostAccounts(),
  owners: () => readRepoOwners(),
  /** On a machine shared by a team, the owners each teammate named: listed beside the machine's, each shown to whoever named it. */
  teammatesOwners: () => everyTeammatesOwners(),
  now: () => Date.now(),
}

/** The owners every teammate named, by their folders beside the machine's. */
async function everyTeammatesOwners(): Promise<string[]> {
  const root = dirname(teammateFolder('x'))
  const logins = await readdir(root).catch((): string[] => [])
  return [...new Set((await Promise.all(logins.map(login => readTeammateOwners(login)))).flat())]
}

/** Every repository the hosts list now: each account's own, then each named owner's, each row saying where it was listed from. */
async function listHosted(): Promise<Listed> {
  const [hosts, machineOwners, teammatesOwners] = await Promise.all([
    hostedWiring.hosts(),
    hostedWiring.owners().catch((): string[] => []),
    hostedWiring.teammatesOwners().catch((): string[] => []),
  ])
  const owners = [...new Set([...machineOwners, ...teammatesOwners])]
  const asks: { host: string; args: string[]; from: string }[] = []
  for (const row of hosts) {
    for (const login of row.logins) asks.push({ host: row.host, args: ['repos', '--user', login], from: `@${login}` })
    for (const owner of owners) {
      const [host, name] = owner.split('/') as [string, string]
      if (host === row.host) asks.push({ host, args: ['repos', '--owner', name], from: name })
    }
  }
  const lists = await Promise.all(asks.map(async ask => ({ ask, said: await hostedWiring.run(ask.host, ask.args).catch(() => undefined) })))
  const repos: HostedRepo[] = []
  let unreached = false
  for (const { ask, said } of lists) {
    if (!said?.ok) {
      unreached = true
      continue
    }
    const listed = ((said.output ?? {}) as { repos?: unknown }).repos
    for (const row of Array.isArray(listed) ? listed : []) {
      const { address, url, private: hidden, description, pushedAt } = (row ?? {}) as Record<string, unknown>
      if (typeof address !== 'string' || typeof url !== 'string') continue
      repos.push({ address, url, private: hidden === true, ...(typeof description === 'string' && description ? { description } : {}), ...(typeof pushedAt === 'string' ? { pushedAt } : {}), from: ask.from })
    }
  }
  return { repos, ...(unreached ? { unreached } : {}) }
}

/**
 * The rows `caller` is shown, one address once, in the order listed. With no caller, all of
 * them. On a machine shared by a team: what their own accounts and the shared ones list, and
 * the owners they named; a teammate's owners are asked as the machine's account, so of those a
 * teammate is shown only the public repositories.
 */
async function shownTo(rows: readonly HostedRepo[], caller: TeamCaller | undefined): Promise<HostedRepo[]> {
  let shown: readonly HostedRepo[] = rows
  if (caller) {
    const logins = (await hostedWiring.hosts()).flatMap(row => row.logins)
    const fromAccounts = new Set(loginsFor(caller, logins).map(login => `@${login}`))
    const named = new Set((isTeammate(caller) ? await readTeammateOwners(caller.login) : await hostedWiring.owners().catch((): string[] => [])).map(owner => owner.slice(HOST.length + 1)))
    shown = rows.filter(row => fromAccounts.has(row.from) || (named.has(row.from) && !(isTeammate(caller) && row.private)))
  }
  const seen = new Set<string>()
  return shown.filter(row => !seen.has(row.address.toLowerCase()) && seen.add(row.address.toLowerCase()))
}

type Listed = Omit<HostedRead, 'loading'>

let kept: (Listed & { at: number }) | undefined
let running: Promise<Listed> | undefined

function listOnce(): Promise<Listed> {
  running ??= listHosted()
    .then(
      listed => ((kept = { ...listed, at: hostedWiring.now() }), listed),
      () => kept ?? { repos: [] },
    )
    .finally(() => (running = undefined))
  return running
}

/**
 * The hosts' repositories as kept. The first read waits {@link HOSTED_FIRST_WAIT_MS} at most, and
 * then says they are still being read; a read of old lists answers them and asks again behind.
 */
export async function readHosted(caller?: TeamCaller): Promise<HostedRead> {
  if (!kept) {
    const listing = listOnce()
    const first = await Promise.race([listing, new Promise<undefined>(done => setTimeout(() => done(undefined), HOSTED_FIRST_WAIT_MS))])
    return first ? { ...first, repos: await shownTo(first.repos, caller), loading: false } : { repos: [], loading: true }
  }
  if (hostedWiring.now() - kept.at > HOSTED_MAX_AGE_MS) void listOnce()
  return { repos: await shownTo(kept.repos, caller), loading: running !== undefined, ...(kept.unreached ? { unreached: kept.unreached } : {}) }
}

/** Ask the hosts again now, and answer what they listed: after the person named another owner. */
export function refreshHosted(): Promise<HostedRepo[]> {
  return (running ?? Promise.resolve())
    .then(listOnce)
    .then(listed => listed.repos)
}

/** Forget the kept lists: for a test. */
export function forgetHosted(): void {
  kept = undefined
  running = undefined
}

/** The owners `caller` named: the machine's person's, kept in their own folder (the same on each of their computers); a teammate's, in theirs. */
function ownersOf(caller: TeamCaller | undefined): Promise<string[]> {
  return isTeammate(caller) ? readTeammateOwners(caller.login) : hostedWiring.owners()
}

async function saveOwners(caller: TeamCaller | undefined, owners: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isTeammate(caller)) {
    const written = await writeRepoOwners(owners)
    return written.ok ? { ok: true } : { ok: false, error: written.error }
  }
  await writeTeammateOwners(caller.login, owners)
  return { ok: true }
}

/** The users and organizations on GitHub the person named, by name, kept in their own folder: the same on each of their computers. */
export async function readOwners(caller?: TeamCaller): Promise<string[]> {
  return (await ownersOf(caller)).filter(owner => owner.startsWith(`${HOST}/`)).map(owner => owner.slice(HOST.length + 1))
}

/** List one more user's or organization's repositories, as a person types it: `vikejs`, `@vikejs`, `github.com/vikejs` or its page's address. */
export async function addOwner(typed: string, caller?: TeamCaller): Promise<{ ok: true } | { ok: false; error: string }> {
  const said = typeof typed === 'string' ? typed.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '') : ''
  const named = said.toLowerCase().startsWith(`${HOST}/`) ? said.slice(HOST.length + 1) : said.replace(/^@/, '')
  const owner = `${HOST}/${named}`
  if (!isRepoOwner(owner)) return { ok: false, error: `"${said.slice(0, 80)}" is not a GitHub user or organization. One looks like vikejs, or github.com/vikejs.` }
  const owners = await ownersOf(caller)
  if (owners.some(one => one.toLowerCase() === owner.toLowerCase())) return { ok: true }
  const written = await saveOwners(caller, [...owners, owner])
  if (!written.ok) return written
  void refreshHosted()
  return { ok: true }
}

/** Stop listing an owner's repositories, by its name. */
export async function removeOwner(name: string, caller?: TeamCaller): Promise<{ ok: true } | { ok: false; error: string }> {
  const owners = await ownersOf(caller)
  const owner = `${HOST}/${name}`
  if (!owners.includes(owner)) return { ok: true }
  const written = await saveOwners(caller, owners.filter(one => one !== owner))
  if (!written.ok) return written
  void refreshHosted()
  return { ok: true }
}
