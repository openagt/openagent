import { originDefaultBranch } from '@openagt/agent-data'
import { originGit } from '../dashboard-rpc/send-as.js'
import { publishedBase } from '@openagt/agent-data/names'
import type { StartFromPick } from '../registry.js'
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

/** How long a read of origin's branches waits: past this, origin counts as not reached. */
const ORIGIN_WAIT_MS = 10_000

/**
 * The branches origin has now, asked of origin itself: this clone's copies keep every branch it
 * ever saw, long after origin deleted it. Nothing where origin could not be read.
 */
export async function branchesOnOrigin(cwd: string): Promise<string[] | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>(resolve => {
    timer = setTimeout(() => resolve(undefined), ORIGIN_WAIT_MS)
    timer.unref()
  })
  // Asked as one of OpenAgent's accounts, never the person's own login.
  const listed = originGit(cwd).then(git => git(['ls-remote', '--heads', 'origin'], cwd)).catch(() => undefined)
  const out = await Promise.race([listed, late])
  clearTimeout(timer)
  if (out === undefined) return undefined
  return out.split('\n').flatMap(line => line.match(/\trefs\/heads\/(.+)$/)?.[1] ?? [])
}

/** What a pick of the launcher's menu starts from, as `startBranch` says it. */
function pickedBranch(pick: StartFromPick, local: string | undefined): { ref: string; name: string } | undefined {
  if (pick.kind === 'published') return { ref: publishedBase(pick.branch), name: pick.branch }
  return local !== undefined && local !== 'HEAD' ? { ref: 'HEAD', name: local } : undefined
}

/** A skill that is in the folder and not on the branch agents start from. */
export interface Waiting {
  /** The branch it has yet to reach, by name. */
  branch: string
  /** Whether the branch the folder is on has it: an agent started from that branch does. */
  here: boolean
}

/** How long this clone's copy of a remote branch counts as fresh, per project and branch. */
const FRESH_MS = 60_000
/** How long a read waits for the fetch that freshens it; the fetch itself goes on. */
const FETCH_WAIT_MS = 5_000
const fetched = new Map<string, number>()

/**
 * Which of the skills `names`, all in the project's folder, are waiting to reach the branch agents
 * start from: the one the launcher's menu has picked, given a `pick`, else the main branch. A skill
 * is said to be waiting only when that is known: an agent's checkout fetches the remote before it
 * starts, so before a skill is called waiting against a remote branch, this clone's copy of that
 * branch is fetched too (at most once a minute per project and branch), or a pull request merged a
 * moment ago would keep its skill waiting here.
 */
export async function waitingSkills(cwd: string, names: readonly string[], pick?: StartFromPick): Promise<{ start?: { ref: string; name: string }; waiting: Map<string, Waiting> }> {
  const start = pick ? pickedBranch(pick, await currentBranch(cwd).catch(() => undefined)) : await startBranch(cwd)
  if (!start || names.length === 0) return { ...(start ? { start } : {}), waiting: new Map() }
  let on = await skillsOn(cwd, start.ref)
  let missing = names.filter(name => !on.has(name))
  if (missing.length > 0 && start.ref !== 'HEAD' && Date.now() - (fetched.get(`${cwd}\0${start.name}`) ?? 0) > FRESH_MS) {
    fetched.set(`${cwd}\0${start.name}`, Date.now())
    const fetch = originGit(cwd).then(git => git(['fetch', '--quiet', 'origin', `+refs/heads/${start.name}:${publishedBase(start.name)}`], cwd)).catch(() => undefined)
    await Promise.race([fetch, new Promise(resolve => setTimeout(resolve, FETCH_WAIT_MS))])
    on = await skillsOn(cwd, start.ref)
    missing = names.filter(name => !on.has(name))
  }
  if (missing.length === 0) return { start, waiting: new Map() }
  const here = start.ref === 'HEAD' ? { has: () => false } : await skillsOn(cwd, 'HEAD')
  return { start, waiting: new Map(missing.map(name => [name, { branch: start.name, here: here.has(name) }])) }
}
