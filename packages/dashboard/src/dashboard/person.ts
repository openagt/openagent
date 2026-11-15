import { AsyncLocalStorage } from 'node:async_hooks'
import { homedir, userInfo } from 'node:os'
import { nodeGitRunner, readPersonRecord, type PersonRecord } from '@openagt/agent-data'
import { isPersonName } from '../registry.js'

/**
 * The person at this dashboard, as the foot of its sidebar shows them: their name, and a picture
 * when they have one. Both are the person's own (`person.json` in the personal folder, the same on
 * every computer of theirs): what they typed in Settings, or copied once from a GitHub profile.
 * With none set, the name is git's own `user.name`, else this computer's user, and no picture;
 * no git host is ever asked.
 */
export interface Person {
  name: string
  /** The email git commits as on this computer, lowered: what the records of their runs are kept under. */
  email?: string
  /** A picture of them: an https address. */
  avatar?: string
  /** The GitHub login the name and picture were copied from. */
  github?: string
  /** Whether the person set their name in OpenAgent, rather than it being the computer's. */
  own?: true
}

/**
 * Who a call came from, when the door in front of OpenAgent says (the devices package): the name
 * of the person whose device made it, `%`-encoded, as a header carries only plain letters. Said
 * only on a computer several persons use.
 */
export const PERSON_HEADER = 'x-openagent-person'

const caller = new AsyncLocalStorage<string>()

/** The name a header says, as it was; nothing for a word that is no name. */
function nameIn(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined
  try {
    const name = decodeURIComponent(header)
    return isPersonName(name) ? name : undefined
  } catch {
    return undefined
  }
}

/** Run `call` as one a person's device made, by their name, when the request said one. */
export function asCaller<T>(header: string | string[] | undefined, call: () => Promise<T>): Promise<T> {
  const name = nameIn(header)
  return name === undefined ? call() : caller.run(name, call)
}

/** The person whose device made this call, by their name: only a person the owner invited is said. */
export function callerAtPage(): string | undefined {
  return caller.getStore()
}

/**
 * Whether the person asking is this computer's owner, who alone names it: not a person the owner
 * invited, at the owner's OpenAgent (the door says who), nor on an OpenAgent of their own here.
 */
export function ownerAsks(): boolean {
  return callerAtPage() === undefined && !process.env.OPENAGENT_PERSON
}

/** How a command of this computer's is told who asks, when a person the owner invited does: their name, `%`-encoded. */
export const CALLER_ENV = 'OPENAGENT_CALLER'

/** The person at the page: the one this computer knows, or, for a call another person's device made, that person by their name. */
export function personAtPage(own: Person, name = caller.getStore()): Person {
  return name === undefined ? own : { name }
}

/** The person this computer's OpenAgent knows: their own record, else git's name or this computer's user; and git's email, which their runs are kept under. */
export async function readPerson(deps: { record?: () => Promise<PersonRecord | undefined>; gitName?: () => Promise<string | undefined>; gitEmail?: () => Promise<string | undefined> } = {}): Promise<Person> {
  const [record, email] = await Promise.all([(deps.record ?? (() => readPersonRecord()))().catch(() => undefined), (deps.gitEmail ?? readGitEmail)()])
  const mail = email !== undefined ? { email } : {}
  if (record) return { name: record.name, ...mail, ...(record.picture ? { avatar: record.picture } : {}), ...(record.github ? { github: record.github } : {}), own: true }
  return { name: (await (deps.gitName ?? readGitName)()) ?? userInfo().username, ...mail }
}

/** git's `user.name`, as it is set for this person (asked from their home, so no project's own setting answers). */
async function readGitName(): Promise<string | undefined> {
  const name = (await nodeGitRunner()(['config', '--get', 'user.name'], homedir()).catch(() => '')).trim()
  return name || undefined
}

/** git's `user.email`, the same way, lowered as the runs' records keep it. */
async function readGitEmail(): Promise<string | undefined> {
  const email = (await nodeGitRunner()(['config', '--get', 'user.email'], homedir()).catch(() => '')).trim().toLowerCase()
  return email || undefined
}
