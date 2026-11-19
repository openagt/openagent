import { createHash } from 'node:crypto'

/**
 * A person's logins on another person's computer (#2140). That computer gives each person who
 * starts a run on it a user and an OpenAgent of their own, and a run there uses that person's own
 * GitHub and Claude logins. They reach it as copies: the person's own OpenAgent on the server
 * both computers are in at copies its logins there, the first time it starts a run there. A
 * person may make a login of their own there instead, and a copy never takes its place.
 *
 * What a computer says of a login there is only whose it is, where it came from and a mark of it:
 * the start of its SHA-256, by which the copier tells whether the copy is still its own login.
 * The login itself is never said. The marks are the devices package's (`servers/own.ts`), made the same way.
 */

/** One login there, as that computer says it. */
export interface LoginThere {
  /** GitHub: the account. */
  account?: string
  /** A copy from the person's own OpenAgent on a server, or one the person made there. */
  source: 'copied' | 'made'
  /** For a copy: the server it came from. */
  from?: string
  mark?: string
}

/** The person's logins on that computer: each one it has. */
export interface MachineLogins {
  github?: LoginThere
  claude?: LoginThere
}

/** Logins handed to that computer: each as its own word, who the Claude login is when known, with the server they are copies from, when they are. */
export interface GivenLogins {
  github?: string
  claude?: string
  claudeAccount?: string
  from?: string
}

/** An account's id at Claude, as Claude Code keeps it: what goes beside a Claude login. */
export const isClaudeAccountId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

/** How long a mark is: as the devices package keeps it. */
const MARK_LENGTH = 16
/** A login is a word, and not a long one. */
const MAX_LOGIN = 4096

export const isMark = (value: unknown): value is string => typeof value === 'string' && new RegExp(`^[0-9a-f]{${MARK_LENGTH}}$`).test(value)
/** A server's name as a copied login says where it came from: its host or its address. */
export const isServerName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9.:\-[\]]{0,252}$/.test(value)
const isAccount = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(value)
/** A login as it is handed over: letters, digits and the few marks a token is written with, nothing a line could break on. */
export const isLoginWord = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_LOGIN && /^[A-Za-z0-9_\-.]+$/.test(value)

/** A login's mark: the start of its SHA-256. */
export function markOf(login: string): string {
  return createHash('sha256').update(login).digest('hex').slice(0, MARK_LENGTH)
}

function readOne(value: unknown): LoginThere | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { account, source, from, mark } = value as Record<string, unknown>
  if (source !== 'copied' && source !== 'made') return undefined
  return { source, ...(isAccount(account) ? { account } : {}), ...(isServerName(from) ? { from } : {}), ...(isMark(mark) ? { mark } : {}) }
}

/** What another computer said of the logins there, as far as it reads as such: it is another computer's data. */
export function readLogins(value: unknown): MachineLogins {
  if (!value || typeof value !== 'object') return {}
  const { github, claude } = value as Record<string, unknown>
  const [g, c] = [readOne(github), readOne(claude)]
  return { ...(g ? { github: g } : {}), ...(c ? { claude: c } : {}) }
}

/**
 * The devices package's `server own` answer of a person's own OpenAgent, as that computer says it: each
 * login that is there, a copy when it names the server it came from.
 */
export function loginsOfOwn(said: unknown): MachineLogins {
  const logins = said && typeof said === 'object' ? (said as { logins?: unknown }).logins : undefined
  if (!logins || typeof logins !== 'object') return {}
  const one = (value: unknown): LoginThere | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const { there, account, from, mark } = value as Record<string, unknown>
    if (there !== true) return undefined
    return { source: isServerName(from) ? 'copied' : 'made', ...(isAccount(account) ? { account } : {}), ...(isServerName(from) ? { from } : {}), ...(isMark(mark) ? { mark } : {}) }
  }
  const { github, claude } = logins as Record<string, unknown>
  const [g, c] = [one(github), one(claude)]
  return { ...(g ? { github: g } : {}), ...(c ? { claude: c } : {}) }
}

/**
 * Which of this OpenAgent's own logins go to that computer: one it has none of, and one it has a
 * copy of that is no longer this one. Never one the person made there.
 */
export function loginsToCopy(own: { github?: string; claude?: string; claudeAccount?: string }, there: MachineLogins): Omit<GivenLogins, 'from'> {
  const wanted = (mine: string | undefined, theirs: LoginThere | undefined): mine is string => mine !== undefined && (theirs === undefined || (theirs.source === 'copied' && theirs.mark !== markOf(mine)))
  return {
    ...(wanted(own.github, there.github) ? { github: own.github } : {}),
    ...(wanted(own.claude, there.claude) ? { claude: own.claude, ...(own.claudeAccount !== undefined ? { claudeAccount: own.claudeAccount } : {}) } : {}),
  }
}
