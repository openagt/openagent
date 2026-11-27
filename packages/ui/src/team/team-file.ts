import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { sameLogin } from '@openagt/hooks'

// Team mode (a machine shared by a team, each person signed in as themselves with GitHub): what it
// keeps, in one file of the computer's own beside the registry, mode 0600. Whether it is on, whose
// it is, who may sign in, and the browsers signed in, each by a hash of its key, never the key.
// Off, as on every laptop, nobody signs in and the dashboard is the person's who runs it.

/** A person as GitHub says who they are. */
export interface TeamPerson {
  login: string
  /** GitHub's number for the account: the same after a rename. */
  id: number
  name?: string
  avatar?: string
}

/** One person the owner let in, by GitHub username; who they are once they have signed in. */
export interface TeamMember {
  login: string
  /** When the owner added them (ISO). */
  added: string
  /** GitHub's account, from their first sign-in. */
  person?: TeamPerson
  /** Their last sign-in (ISO). */
  signedIn?: string
}

/** A browser signed in: whose it is, by GitHub username, and until when. */
export interface TeamSession {
  /** sha256 of the cookie's key, hex. */
  hash: string
  login: string
  expires: string
}

/** What the file holds. */
export interface Team {
  on: boolean
  /** Who turned it on: the one person who changes it. */
  owner?: TeamPerson
  members: TeamMember[]
  sessions: TeamSession[]
  /**
   * A key the programs on this computer call the dashboard with (a second `openagent`): it is
   * behind a proxy that every visitor reaches from this computer's own address, so a call from here
   * says nothing of who made it. Whoever reads this file is this computer's person, as the owner.
   */
  localKey?: string
}

export const TEAM_FILE = 'openagent-team.json'
const TEAM_FILE_MODE = 0o600
/** How long a browser stays signed in. */
export const SESSION_DAYS = 30

/** The team file: `$XDG_CONFIG_HOME/openagent-team.json`, else `~/.openagent-team.json`, as the registry. */
export function teamPath(env: NodeJS.ProcessEnv): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, TEAM_FILE)
  return join(env.HOME ?? '', '.' + TEAM_FILE)
}

const OFF: Team = { on: false, members: [], sessions: [] }

/** The file read as it is: off when it is absent or unreadable. */
export async function readTeam(path: string): Promise<Team> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return OFF
  }
  try {
    return teamOf(JSON.parse(text) as unknown)
  } catch {
    return OFF
  }
}

/** What a parsed file says, whatever is wrong in it dropped. */
function teamOf(raw: unknown): Team {
  if (typeof raw !== 'object' || raw === null) return OFF
  const r = raw as Record<string, unknown>
  const owner = personOf(r.owner)
  const members = Array.isArray(r.members)
    ? r.members.flatMap((m: unknown): TeamMember[] => {
        if (typeof m !== 'object' || m === null) return []
        const o = m as Record<string, unknown>
        if (typeof o.login !== 'string' || typeof o.added !== 'string') return []
        const person = personOf(o.person)
        return [{ login: o.login, added: o.added, ...(person ? { person } : {}), ...(typeof o.signedIn === 'string' ? { signedIn: o.signedIn } : {}) }]
      })
    : []
  const sessions = Array.isArray(r.sessions)
    ? r.sessions.flatMap((s: unknown): TeamSession[] => {
        if (typeof s !== 'object' || s === null) return []
        const o = s as Record<string, unknown>
        return typeof o.hash === 'string' && typeof o.login === 'string' && typeof o.expires === 'string' ? [{ hash: o.hash, login: o.login, expires: o.expires }] : []
      })
    : []
  // On with nobody to own it is no team anyone could change: off.
  return {
    on: r.on === true && owner !== undefined,
    ...(owner ? { owner } : {}),
    members,
    sessions,
    ...(typeof r.localKey === 'string' ? { localKey: r.localKey } : {}),
  }
}

function personOf(raw: unknown): TeamPerson | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.login !== 'string' || typeof o.id !== 'number') return undefined
  return { login: o.login, id: o.id, ...(typeof o.name === 'string' ? { name: o.name } : {}), ...(typeof o.avatar === 'string' ? { avatar: o.avatar } : {}) }
}

/**
 * The team file of one computer: read again only when it changed on disk (a `openagent team` typed
 * on the computer changes it under the dashboard), and changed one change at a time.
 */
export interface TeamStore {
  read(): Promise<Team>
  /** Change it: `change` gets what is there now and gives back what is saved. */
  change(change: (team: Team) => Team): Promise<Team>
}

export function teamStore(path: string): TeamStore {
  let cached: { mtimeMs: number; team: Team } | undefined
  let queue: Promise<unknown> = Promise.resolve()
  const read = async (): Promise<Team> => {
    const mtimeMs = await stat(path).then(
      s => s.mtimeMs,
      () => -1,
    )
    if (cached?.mtimeMs === mtimeMs) return cached.team
    const team = await readTeam(path)
    cached = { mtimeMs, team }
    return team
  }
  const change = (fn: (team: Team) => Team): Promise<Team> => {
    const next = queue.then(async () => {
      const team = fn(await readTeam(path))
      await mkdir(dirname(path), { recursive: true })
      const temp = `${path}.${process.pid}.tmp`
      await writeFile(temp, `${JSON.stringify(team, null, 2)}\n`, { mode: TEAM_FILE_MODE })
      await rename(temp, path)
      cached = undefined
      return team
    })
    queue = next.catch(() => undefined)
    return next
  }
  return { read, change }
}

/** A new key: 32 random bytes, url-safe. */
export function newKey(): string {
  return randomBytes(32).toString('base64url')
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Whether `login` may sign in: the owner or a member. */
export function mayEnter(team: Team, login: string): boolean {
  return (team.owner !== undefined && sameLogin(team.owner.login, login)) || team.members.some(m => sameLogin(m.login, login))
}

/** The person signed in with `key`, while the session holds and they may still enter. */
export function personOfKey(team: Team, key: string, now = new Date()): TeamPerson | undefined {
  const hash = hashKey(key)
  const session = team.sessions.find(s => s.hash === hash && Date.parse(s.expires) > now.getTime())
  if (!session || !mayEnter(team, session.login)) return undefined
  if (team.owner && sameLogin(team.owner.login, session.login)) return team.owner
  const member = team.members.find(m => sameLogin(m.login, session.login))
  return member?.person ?? (member ? { login: member.login, id: 0 } : undefined)
}

/** `team` with a new browser signed in as `person`, and their member row told so; ended sessions dropped. */
export function signedIn(team: Team, person: TeamPerson, hash: string, now = new Date()): Team {
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const isOwner = team.owner !== undefined && sameLogin(team.owner.login, person.login)
  return {
    ...team,
    ...(isOwner ? { owner: person } : {}),
    members: team.members.map(m => (sameLogin(m.login, person.login) ? { ...m, login: person.login, person, signedIn: now.toISOString() } : m)),
    sessions: [...team.sessions.filter(s => Date.parse(s.expires) > now.getTime()), { hash, login: person.login, expires }],
  }
}
