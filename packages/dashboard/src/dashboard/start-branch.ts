import { nodeGitRunner, originDefaultBranch } from '@openagt/agent-data'
import { skillsOn } from '../project-skills/branch.js'
import { currentBranch } from './git-status.js'

/**
 * The branch agents start from in the project at `cwd`: origin's default branch as this clone has
 * it, else the branch the folder is on (a project with no remote starts an agent from its last
 * local commit). `ref` is what git is asked, `name` what a person reads. None where the folder is
 * on no branch, or is no repository.
 */
export async function startBranch(cwd: string): Promise<{ ref: string; name: string } | undefined> {
  const main = await originDefaultBranch(cwd).catch(() => undefined)
  if (main !== undefined) return { ref: main, name: main.slice('origin/'.length) }
  const local = await currentBranch(cwd).catch(() => undefined)
  return local !== undefined && local !== 'HEAD' ? { ref: 'HEAD', name: local } : undefined
}

/** A skill that is in the folder and not on the branch agents start from. */
export interface Waiting {
  /** The branch it has yet to reach, by name. */
  branch: string
  /** Whether the branch the folder is on has it: an agent started from that branch does. */
  here: boolean
}

/** How long this clone's copy of the remote's default branch counts as fresh, per project. */
const FRESH_MS = 60_000
/** How long a read waits for the fetch that freshens it; the fetch itself goes on. */
const FETCH_WAIT_MS = 5_000
const fetched = new Map<string, number>()

/**
 * Which of the skills `names`, all in the project's folder, are waiting to reach the branch agents
 * start from. A skill is said to be waiting only when that is known: an agent's checkout fetches
 * the remote before it starts, so before a skill is called waiting against a remote branch, this
 * clone's copy of that branch is fetched too (at most once a minute per project), or a pull
 * request merged a moment ago would keep its skill waiting here.
 */
export async function waitingSkills(cwd: string, names: readonly string[]): Promise<{ start?: { ref: string; name: string }; waiting: Map<string, Waiting> }> {
  const start = await startBranch(cwd)
  if (!start || names.length === 0) return { ...(start ? { start } : {}), waiting: new Map() }
  let on = await skillsOn(cwd, start.ref)
  let missing = names.filter(name => !on.has(name))
  if (missing.length > 0 && start.ref !== 'HEAD' && Date.now() - (fetched.get(cwd) ?? 0) > FRESH_MS) {
    fetched.set(cwd, Date.now())
    const fetch = nodeGitRunner()(['fetch', '--quiet', 'origin', start.name], cwd).catch(() => undefined)
    await Promise.race([fetch, new Promise(resolve => setTimeout(resolve, FETCH_WAIT_MS))])
    on = await skillsOn(cwd, start.ref)
    missing = names.filter(name => !on.has(name))
  }
  if (missing.length === 0) return { start, waiting: new Map() }
  const here = start.ref === 'HEAD' ? { has: () => false } : await skillsOn(cwd, 'HEAD')
  return { start, waiting: new Map(missing.map(name => [name, { branch: start.name, here: here.has(name) }])) }
}
