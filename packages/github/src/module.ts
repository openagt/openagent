import { realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { errorMessage, nodeGitRunner, sessionFolder, sessionsHome } from '@openagt/agent-data'
import { defineModule, RunOrder, type ModuleDefinition, type PullRequest, type RunContext } from '@openagt/hooks'
import { readFacts, runEnv } from './accounts.js'
import { nodeGhRunner } from './gh.js'
import { homeUrlFor } from './home.js'
import { listRequests } from './requests.js'
import { accountNamed, tokenOf } from './working-account.js'

/**
 * github, the module (#2394): the account a run works as on GitHub, first of its steps, and the
 * pull request its branch has, read back once the branch is, into the run's facts
 * (`RunFacts.github`), which the run's record keeps. Its skill, with the command it teaches, is in
 * every run of a project on GitHub: its text says the project's pull requests are there, which is
 * wrong anywhere else.
 */

/** One of OpenAgent's GitHub accounts, as a run works as it: its login, and what the run's environment gets for it. */
export interface WorkingAs {
  login: string
  env: Record<string, string>
}

/** What the module works with; the real one when absent. */
export interface GithubDeps {
  /** The newest pull request whose head is `branch` in the project at `dir`, open or closed; none when there is none, or GitHub cannot say. */
  requestOfBranch?: (dir: string, branch: string) => Promise<PullRequest | undefined>
  /** Whether the repository at `dir` is on GitHub. */
  onGithub?: (dir: string) => Promise<boolean>
  /** OpenAgent's account `user`, else the one runs use, as a run in the repository at `dir` works as it, its commits made in `commitsIn`; throws when OpenAgent has no such account. */
  workAs?: (dir: string, user: string | undefined, commitsIn: CommitsIn) => Promise<WorkingAs>
}

/** Where a run's commits are made, and go as its account: its project's repository, or a session's own folder, with the copies of its repos. */
export type CommitsIn = { project: string } | { session: string }

export function githubModule(deps: GithubDeps = {}): ModuleDefinition {
  const requestOfBranch = deps.requestOfBranch ?? branchRequest
  const onGithub = deps.onGithub ?? (async (dir: string) => (await homeUrlFor(dir).catch(() => undefined)) !== undefined)
  const workAs = deps.workAs ?? openagentAccount
  return defineModule({
    name: 'github',
    hooks: {
      'run.skills': async ({ project }) => (project && (await onGithub(project.dir)) ? [{ name: 'github', dir: new URL('../', import.meta.url), command: 'github' }] : []),
      'run.step': [
        { order: RunOrder.ACCOUNTS, name: "work as the run's account", run: ctx => workAsAccount(ctx, onGithub, workAs) },
        { order: RunOrder.RECORD - 10, name: 'read the pull request back', run: ctx => readRequest(ctx, requestOfBranch) },
      ],
    },
  })
}

export default githubModule()

/** OpenAgent's account `user`, else the one runs use, with the token GitHub said is its own, and its name on the commits made in `commitsIn`. */
async function openagentAccount(dir: string, user: string | undefined, commitsIn: CommitsIn): Promise<WorkingAs> {
  const gh = nodeGhRunner()
  const { login, dir: home } = await accountNamed(user, dir, gh, process.env)
  return { login, env: runEnv(await tokenOf(login, home, dir, gh), home, readFacts(home), process.env, await gitDirsOf(commitsIn)) }
}

/**
 * The git directories of `commitsIn`, as git's `gitdir:` matches them, by their real path: a
 * project's own (its common directory, its main checkout's) and its worktrees' (in it), the run's
 * among them; or every repository in a session's folder. A repository elsewhere, such as one a
 * test makes in the temporary folder, is not among them, and commits as its own config says.
 */
export async function gitDirsOf(commitsIn: CommitsIn): Promise<string[]> {
  if ('session' in commitsIn) return [`${realPath(sessionFolder(sessionsHome(), commitsIn.session))}/**`]
  const common = realpathSync((await nodeGitRunner()(['rev-parse', '--path-format=absolute', '--git-common-dir'], commitsIn.project)).trim())
  return [common, `${common}/**`]
}

/** `path` with its links resolved, as far as it exists: a session's folder is made after its account is picked. */
function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(realPath(parent), basename(path))
  }
}

/**
 * The run works as one of OpenAgent's GitHub accounts, never the person's own login: the one
 * picked for it (`options.github.account`), else the account runs use. What its environment gets
 * for it is the run's from here on, its agent's and its own git's, and its login goes on its
 * record. The repository that decides is the project's: a project on no GitHub repository works
 * as no account of this module's, and one picked an account there is refused. A session with no
 * project works as its account whatever its repos, and with none: its folder is on no host, and
 * it may reach GitHub all the same (a clone, a new repository, the person's pull requests). With
 * no account picked and none OpenAgent has, such a session goes on as no account: it may need
 * none. An account picked that cannot be worked as is refused, rather than run as someone else.
 */
async function workAsAccount(ctx: RunContext, onGithub: (dir: string) => Promise<boolean>, workAs: NonNullable<GithubDeps['workAs']>): Promise<void> {
  const picked = ctx.options.github?.account
  if (ctx.project && !(await onGithub(ctx.project.dir))) {
    if (picked !== undefined) throw new Error(`This session works as @${picked} on GitHub, and it works in no repository on GitHub.`)
    return
  }
  let working: WorkingAs
  try {
    // A session's own folder is made after its account is picked: gh is asked in the person's home folder.
    working = await workAs(ctx.project?.dir ?? homedir(), picked, ctx.project ? { project: ctx.project.dir } : { session: ctx.id })
  } catch (err) {
    if (!ctx.project && picked === undefined) return
    throw new Error(picked !== undefined ? `This session works as @${picked} on GitHub, and it cannot be used here: ${errorMessage(err)}` : errorMessage(err))
  }
  Object.assign(ctx.env, working.env)
  ctx.facts.github = { ...ctx.facts.github, account: working.login }
}

/** The newest pull request of a branch on GitHub; none for a project that is not on GitHub. */
async function branchRequest(dir: string, branch: string): Promise<PullRequest | undefined> {
  if ((await homeUrlFor(dir).catch(() => undefined)) === undefined) return undefined
  const [newest] = await listRequests(dir, { branch })
  return newest ? { number: newest.number, url: newest.url } : undefined
}

/**
 * The pull request the agent opened, if any, read back off the branch the run's work is on; a
 * run with no branch has none. The run's request and the ones it opened before: a request other
 * than the run's puts that one among the earlier ones, each once, and never the run's own, so work
 * moved back to a branch takes its request back. The earlier ones are said whenever the run has
 * had any, so a list emptied by the work moving back is said too.
 */
async function readRequest(ctx: RunContext, requestOfBranch: NonNullable<GithubDeps['requestOfBranch']>): Promise<void> {
  const branch = ctx.facts['git-branches']?.branch
  if (branch === undefined || !ctx.project) return
  const before = ctx.facts.github ?? {}
  const pr = await requestOfBranch(ctx.project.dir, branch).catch(() => undefined)
  let named = before.pr
  let earlier = before.earlierPrs ?? []
  if (pr && named && pr.url !== named.url) earlier = [...earlier, { number: named.number, url: named.url }]
  if (pr) named = pr
  earlier = earlier.filter((one, at) => one.url !== named?.url && earlier.findIndex(other => other.url === one.url) === at)
  ctx.facts.github = {
    ...(before.account !== undefined ? { account: before.account } : {}),
    ...(named ? { pr: named } : {}),
    ...(before.earlierPrs !== undefined || earlier.length > 0 ? { earlierPrs: earlier } : {}),
  }
}
