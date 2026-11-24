import { stat } from 'node:fs/promises'
import { errorMessage, nodeGitRunner } from './git.js'
import { type GitRunner, START_FROM, defineModule, isBranchName, RunOrder, type AppContext, type AttentionArgs, type AttentionItem, type ModuleDefinition, type ProjectRef, type RunContext, type Settings, sessionsHome } from '@openagt/hooks'
import { publishedBase, agentBranchName } from './branch-names.js'
import { readBranchesAhead } from './branch-ahead.js'
import { attachCheckout, createCheckout } from './checkout.js'
import { cleanup } from './cleanup.js'
import { readFolderBehind } from './folder-behind.js'
import { branchesOnOrigin } from './origin-branches.js'
import { originGit } from './origin-git.js'
import { reclaimWorktree } from './reclaim.js'
import { isCopyName } from './repo-names.js'
import { checkedRepos, dropUntouchedCopies, openSessionFolder, SESSION_FOLDER_STAYS } from './session-folder.js'
import { unpublishedItems, unpublishedRuns } from './unpublished.js'
import { currentBranch, worktreeBranch, worktreePath, type AddedWorktree } from './worktree.js'
import { PROJECTS_ENV, SESSION_ENV } from './add.js'

/**
 * git-branches, the module (#2394): where a run works, made before anything is linked into it;
 * the branch the agent left its work on, read back once its turns are over; and the checkout
 * reclaimed once the record says how the run ended; a project removed with its files, the agents'
 * checkouts taken back (`cleanup.ts`). What it finds out is in the run's facts
 * (`RunFacts['git-branches']`), which the run's record keeps and a resume starts from. What needs
 * the person (`app.attention`): a run's work left uncommitted or never pushed, a project's folder
 * behind its remote, and a branch picked to start from that origin no longer has.
 */

/** What the module works with; the real one when absent. */
export interface GitBranchesDeps {
  git?: GitRunner
}

export function gitBranchesModule(deps: GitBranchesDeps = {}): ModuleDefinition {
  const git = deps.git ?? nodeGitRunner()
  return defineModule({
    name: 'git-branches',
    hooks: {
      'run.step': [
        { order: RunOrder.WORKSPACE, name: 'make the checkout', run: ctx => makeCheckout(ctx, git) },
        { order: RunOrder.CONTEXT, name: 'hand the agent its projects', run: handProjects },
        { order: RunOrder.RECORD - 20, name: 'read the branch back', run: ctx => readBranch(ctx, git) },
        { order: RunOrder.CLEANUP, name: 'reclaim the checkout', run: ctx => reclaim(ctx, git) },
      ],
      'app.attention': (args, app) => attention(args, app, git),
      // A project taken off the list with its files: the agents' checkouts go, under the reclaim rule.
      'app.lifecycle': { projectRemoved: (project, _app, { files }) => (files ? cleanup(project.dir, git) : undefined) },
    },
  })
}

export default gitBranchesModule()

/**
 * Where the run works: for a run with no project, a folder of its own in the sessions home, with
 * a copy of each of its repos; else a checkout of the project, the branches package's one
 * sequence, on a fresh branch or on the one the run was given. A continued run goes on in the
 * checkout it kept, or in a new one attached to its branch. A run in a project has the copies of
 * its repos too, in a session's folder beside its checkout, and its prompt says where each one
 * made now is: the agent starts in the checkout, and would not find them.
 *
 * A run that makes its own branch writes down the commit the branch was made at, kept for its
 * whole life: the run's own work is what came after it, which is how it is still told apart once
 * it is merged. A branch the run was given holds another run's work, begun elsewhere, and a branch
 * a continued run still has holds its own, so neither writes one; a branch that was gone
 * everywhere, made again from where its base is now, writes the new one.
 */
async function makeCheckout(ctx: RunContext, git: GitRunner): Promise<void> {
  const options = ctx.options['git-branches'] ?? {}
  // The repos are named by whoever wrote the options: a name that is no folder's, or a folder that is no repository's, refuses the run.
  const repos = await checkedRepos(options.repos ?? [], git)
  if (!ctx.project) {
    const folder = await openSessionFolder(sessionsHome(), ctx.id, repos, git)
    ctx.workspace = folder.path
    // A fresh run starts in the folder that holds its copies; a resume given more is told of the new ones (projects' line).
    if (ctx.resume && folder.made.length > 0) ctx.facts['git-branches'] = { ...ctx.facts['git-branches'], copies: { folder: folder.path, branch: agentBranchName(ctx.id), made: folder.made.map(({ name, from }) => ({ name, from })) } }
    return
  }
  const { dir } = ctx.project
  const before = ctx.facts['git-branches'] ?? {}
  // The branch ends up on git's command line: only a branch name goes there. Refused, not dropped:
  // a run started from the main branch instead would be a silent swap.
  for (const named of [options.base, options.branch]) if (named !== undefined && !isBranchName(named.replace(/^refs\/remotes\//, ''))) throw new Error(`not a branch name: ${named}`)
  const base = options.base ?? (options.branch === undefined && !ctx.resume ? await pickedBase(ctx.project.id, dir, ctx.settings, git) : undefined)
  if (ctx.resume) {
    const checkout = await keptCheckout(dir, ctx.id, before.branch, options.base, git)
    ctx.workspace = checkout.path
    ctx.facts['git-branches'] = { ...before, branch: checkout.branch, ...(checkout.again ? { again: true, ...(await startCommit(checkout.path, git)) } : {}) }
  } else {
    const checkout =
      options.branch !== undefined
        ? await attachCheckout(dir, { agentId: ctx.id, branch: options.branch }, git)
        : await createCheckout(dir, { agentId: ctx.id, ...(base !== undefined ? { base } : {}) }, git)
    ctx.workspace = checkout.path
    ctx.facts['git-branches'] = { branch: checkout.branch, ...(options.branch === undefined ? await startCommit(checkout.path, git) : {}) }
  }
  if (repos.length === 0) return
  const copies = await openSessionFolder(sessionsHome(), ctx.id, repos, git)
  ctx.facts['git-branches'] = { ...ctx.facts['git-branches'], copies: { folder: copies.path, branch: agentBranchName(ctx.id), made: copies.made.map(({ name, from }) => ({ name, from })) } }
}

/**
 * Where a run of the project starts from when its options name nothing: the pick made in the
 * launcher for every next run of the project (`START_FROM`), the branch its folder is on now, or
 * origin's copy of one of its branches; origin's default branch with none. A folder on no branch
 * has no local branch to start from.
 */
async function pickedBase(projectId: string, dir: string, settings: Settings, git: GitRunner): Promise<string | undefined> {
  const pick = (await settings.get(START_FROM).catch(() => ({}) as Record<string, never>))[projectId]
  if (pick?.kind === 'local') return currentBranch(dir, git)
  return pick?.kind === 'published' ? publishedBase(pick.branch) : undefined
}

/**
 * The person's projects the session may bring in itself (Auto), handed to its agent's environment
 * with the session's id: what its `add` command reads.
 */
function handProjects(ctx: RunContext): void {
  const projects = ctx.options['git-branches']?.projects ?? []
  if (projects.length === 0) return
  ctx.env[PROJECTS_ENV] = JSON.stringify(projects)
  ctx.env[SESSION_ENV] = ctx.id
}

/**
 * A continued run's checkout: the one it kept, or a new one attached to its branch; a branch that
 * went with the checkout, for holding nothing, starts again from `base`, or origin's default branch.
 */
async function keptCheckout(dir: string, id: string, branch: string | undefined, base: string | undefined, git: GitRunner): Promise<AddedWorktree> {
  const on = branch ?? agentBranchName(id)
  const path = worktreePath(dir, id)
  if (await stat(path).then(s => s.isDirectory(), () => false)) return { path, branch: on }
  return attachCheckout(dir, { agentId: id, branch: on, ...(base !== undefined ? { base } : {}) }, git)
}

/** The commit a checkout just made is at: where the run's own work begins. Nothing when git cannot say. */
async function startCommit(checkout: string, git: GitRunner): Promise<{ baseCommit?: string }> {
  const commit = (await git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], checkout).catch(() => '')).trim()
  return commit ? { baseCommit: commit } : {}
}

/** The branch the agent left its work on: it renames its branch itself. A session's folder has none. */
async function readBranch(ctx: RunContext, git: GitRunner): Promise<void> {
  const facts = ctx.facts['git-branches']
  if (facts?.branch === undefined || ctx.workspace === undefined) return
  facts.branch = (await worktreeBranch(ctx.workspace, git).catch(() => undefined)) ?? facts.branch
}

/**
 * The checkout goes once its branch holds everything in it (the branches rule), and the branch
 * stays on this machine: nothing is pushed here, publishing is the agent's when it was asked, the
 * person's otherwise. A dirty tree keeps the checkout, and the sweep tries again later. A waiting
 * run keeps it on purpose: the answer resumes the run there. A session's folder is its work, kept
 * for the person and for the run going on later. A run in a project keeps, of its copies of repos,
 * the ones that hold work.
 */
async function reclaim(ctx: RunContext, git: GitRunner): Promise<void> {
  const facts = (ctx.facts['git-branches'] ??= {})
  if (ctx.workspace === undefined) facts.reclaimed = { reclaimed: false, reason: 'no checkout' }
  else if (ctx.outcome?.status === 'waiting') facts.reclaimed = { reclaimed: false, reason: 'waiting' }
  else if (!ctx.project) facts.reclaimed = { reclaimed: false, reason: SESSION_FOLDER_STAYS }
  else {
    const from = facts.baseCommit
    const reclaimed = await reclaimWorktree(ctx.project.dir, ctx.workspace, { birthBranch: agentBranchName(ctx.id), ...(from !== undefined ? { from } : {}), git }).catch(
      (err: unknown) => ({ ok: false, reason: errorMessage(err) }) as const,
    )
    facts.reclaimed = reclaimed.ok ? { reclaimed: true, ...(reclaimed.branchesDeleted ? { deleted: reclaimed.branchesDeleted } : {}) } : { reclaimed: false, reason: reclaimed.reason }
    // Its copies of repos, the ones added while it went on too: the ones it never touched go with the run, the rest stay with their work.
    await dropUntouchedCopies(sessionsHome(), ctx.id, git).catch(() => {})
  }
}

/** How long what origin was found to have is kept, per project: the launcher asks what needs the person every few seconds. */
const ORIGIN_KEPT_MS = 60_000
const onOrigin = new Map<string, { at: number; branches: Promise<string[] | undefined> }>()

/**
 * What needs the person, as this module sees it: the work its runs left on this machine,
 * uncommitted or never pushed; a project's folder behind its remote's main branch, which a press
 * brings up (`attention.fix` `update-folder`); and, for the run the launcher
 * would start, a branch picked to start from that origin no longer has, so the person is told
 * above the box rather than by a run that fails to make its checkout. Origin is asked as an
 * account of OpenAgent's; where none reaches it, the clone's own copy counts, and a pick is not
 * doubted.
 */
async function attention(args: AttentionArgs, app: AppContext, git: GitRunner): Promise<AttentionItem[]> {
  const project = args.project
  if (!project) return []
  const [origin, unpublished] = await Promise.all([originGit(project.dir, remote => app.gitAccess(remote), git).catch(() => undefined), workLeft(project, app, git)])
  const items: AttentionItem[] = [...unpublished]
  const behind = await readFolderBehind(project.dir, { git, origin }).catch(() => undefined)
  if (behind) {
    items.push({
      kind: 'setup',
      scope: 'project',
      id: 'folder-behind',
      words: `This project’s folder is ${counted(behind.behind)} behind ${behind.branch}.`,
      fix: { label: 'Update folder', action: 'update-folder' },
    })
  }
  const options = args.options?.['git-branches']
  const pick = options?.base === undefined && options?.branch === undefined ? (await app.settings.get(START_FROM).catch(() => ({}) as Record<string, never>))[project.id] : undefined
  if (pick?.kind === 'published' && origin) {
    const known = onOrigin.get(project.dir)
    const read = known && Date.now() - known.at < ORIGIN_KEPT_MS ? known : { at: Date.now(), branches: branchesOnOrigin(project.dir, origin) }
    onOrigin.set(project.dir, read)
    const branches = await read.branches
    if (branches && !branches.includes(pick.branch)) {
      items.push({ kind: 'setup', scope: 'run', id: 'start-branch-gone', words: `The branch ${pick.branch} is no longer on origin.`, detail: 'Pick another branch to start from.' })
    }
  }
  return items
}

/** How long what the runs left is kept, per project: every list of what waits asks every few seconds, and so does the launcher. */
const LEFT_KEPT_MS = 5_000
const left = new Map<string, { at: number; items: Promise<AttentionItem[]> }>()

/**
 * The project's finished runs whose work never left this machine (`unpublished.ts`), as items
 * waiting on the person, read from this package's own checkouts and branches. A read that failed
 * throws, so the project is not read whole, and is not kept.
 */
function workLeft(project: ProjectRef, app: AppContext, git: GitRunner): Promise<AttentionItem[]> {
  const known = left.get(project.dir)
  if (known && Date.now() - known.at < LEFT_KEPT_MS) return known.items
  const items = (async () => {
    const runs = await app.runs(project)
    return unpublishedItems(runs, await unpublishedRuns(runs, (branches, from) => readBranchesAhead(project.dir, branches, git, from)))
  })()
  const read = { at: Date.now(), items }
  left.set(project.dir, read)
  items.catch(() => {
    if (left.get(project.dir) === read) left.delete(project.dir)
  })
  return items
}

/** `1 commit`, `1,863 commits`. */
function counted(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'commit' : 'commits'}`
}
