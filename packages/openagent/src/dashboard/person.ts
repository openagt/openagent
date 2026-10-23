import { AsyncLocalStorage } from 'node:async_hooks'
import { homedir, userInfo } from 'node:os'
import { nodeGitRunner } from '@openagt/agent-data'
import { projectGitHost, type GitHostFor } from '../store/git-host.js'
import { isPersonName } from '../registry.js'

/**
 * The person at this dashboard, as the foot of its sidebar shows them: a name, and a picture
 * where a git host knows one. The name is git's own `user.name`, the one every commit of theirs
 * carries, else the git host's name for them, else their login there, else this computer's user.
 * The picture is asked of the git host of the first project that has one: OpenAgent names no git
 * host, so a project's own package answers (`me`).
 */
export interface Person {
  name: string
  /** Their login at the git host, when one answered. */
  login?: string
  /** A picture of them: an https address. */
  avatar?: string
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

/** The person at the page: the one this computer knows, or, for a call another person's device made, that person by their name. */
export function personAtPage(own: Person, name = caller.getStore()): Person {
  return name === undefined ? own : { name }
}

/** `projects` are the listed projects' folders, in the list's order. */
export async function readPerson(deps: { projects: () => Promise<string[]>; gitName?: () => Promise<string | undefined>; gitHost?: GitHostFor }): Promise<Person> {
  const gitName = await (deps.gitName ?? readGitName)()
  const host = await signedIn(await deps.projects(), deps.gitHost ?? projectGitHost)
  const name = gitName ?? host?.name ?? host?.login ?? userInfo().username
  return { name, ...(host ? { login: host.login } : {}), ...(host?.avatar ? { avatar: host.avatar } : {}) }
}

/** git's `user.name`, as it is set for this person (asked from their home, so no project's own setting answers). */
async function readGitName(): Promise<string | undefined> {
  const name = (await nodeGitRunner()(['config', '--get', 'user.name'], homedir()).catch(() => '')).trim()
  return name || undefined
}

/**
 * Who is signed in, asked of the first project that has a git host: the sign-in is the person's,
 * not the project's, so another project's would answer the same, and nobody signed in (no `gh`,
 * say) is asked once, not once per project.
 */
async function signedIn(paths: readonly string[], gitHost: GitHostFor) {
  for (const path of paths) {
    const host = await gitHost(path).catch(() => undefined)
    if (host) return host.me().catch(() => undefined)
  }
  return undefined
}
