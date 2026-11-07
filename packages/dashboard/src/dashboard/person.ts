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

/** How a command of this computer's is told who asks, when a person the owner invited does: their name, `%`-encoded. */
export const CALLER_ENV = 'OPENAGENT_CALLER'

/** The person at the page: the one this computer knows, or, for a call another person's device made, that person by their name. */
export function personAtPage(own: Person, name = caller.getStore()): Person {
  return name === undefined ? own : { name }
}

/** The person this computer's OpenAgent knows: their own record, else git's name or this computer's user. */
export async function readPerson(deps: { record?: () => Promise<PersonRecord | undefined>; gitName?: () => Promise<string | undefined> } = {}): Promise<Person> {
  const record = await (deps.record ?? (() => readPersonRecord()))().catch(() => undefined)
  if (record) return { name: record.name, ...(record.picture ? { avatar: record.picture } : {}), ...(record.github ? { github: record.github } : {}), own: true }
  return { name: (await (deps.gitName ?? readGitName)()) ?? userInfo().username }
}

/** git's `user.name`, as it is set for this person (asked from their home, so no project's own setting answers). */
async function readGitName(): Promise<string | undefined> {
  const name = (await nodeGitRunner()(['config', '--get', 'user.name'], homedir()).catch(() => '')).trim()
  return name || undefined
}
