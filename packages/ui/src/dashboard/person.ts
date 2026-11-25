import { homedir, userInfo } from 'node:os'
import { nodeGitRunner } from '../git.js'
import { PERSON_INFO, type PersonInfo } from '@openagt/hooks'
import { distributionSettings } from '../distribution-hooks.js'

/**
 * The person at this dashboard, as the foot of its sidebar shows them: their name, and a picture
 * when they have one. Both are the person's own (the catalog's `user-info.person`, saved with the
 * person, the same on every computer of theirs): what they typed in Settings › Profile, or copied
 * once from a profile at a git host. With no name set, the name is git's own `user.name`, else this
 * computer's user; with no picture, none. No git host is ever asked.
 */
export interface Person {
  name: string
  /** The email git commits as on this computer, lowered: what the records of their runs are kept under. */
  email?: string
  /** A picture of them: an https address. */
  avatar?: string
  /** The login at a git host the name and picture were copied from. */
  login?: string
  /** Whether the person set their name in OpenAgent, rather than it being the computer's. */
  own?: true
}

/** The person this computer's OpenAgent knows: their own name and picture, else git's name or this computer's user; and git's email, which their runs are kept under. */
export async function readPerson(deps: { info?: () => Promise<PersonInfo>; gitName?: () => Promise<string | undefined>; gitEmail?: () => Promise<string | undefined> } = {}): Promise<Person> {
  const [info, email] = await Promise.all([(deps.info ?? readPersonInfo)().catch((): PersonInfo => ({})), (deps.gitEmail ?? readGitEmail)()])
  return {
    name: info.name ?? (await (deps.gitName ?? readGitName)()) ?? userInfo().username,
    ...(email !== undefined ? { email } : {}),
    ...(info.picture ? { avatar: info.picture } : {}),
    ...(info.login ? { login: info.login } : {}),
    ...(info.name !== undefined ? { own: true as const } : {}),
  }
}

/** The person's own name and picture, as the distribution's store keeps them. */
async function readPersonInfo(): Promise<PersonInfo> {
  return (await distributionSettings()).get(PERSON_INFO)
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
