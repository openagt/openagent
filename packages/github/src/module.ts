import { realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { errorMessage, nodeGitRunner, remoteHostOf, sessionFolder, sessionsHome } from '@openagt/agent-data'
import { defineModule, PICKED_GITHUB_ACCOUNT, RunOrder, type AttentionItem, type GitAccess, type ModuleDefinition, type ProjectRun, type PullRequest, type RunContext } from '@openagt/hooks'
import { cachedOpenPrs, cachedPrStates, mergeLookup, requestsRead, type OpenPr } from './pulls.js'

export type { OpenPr } from './pulls.js'
import { HOST, readFacts, runEnv } from './accounts.js'
import { nodeGhRunner } from './gh.js'
import { homeUrlFor } from './home.js'
import { ADD_ACCOUNT } from './ids.js'
import { githubAccounts, hostAccounts, sendAs } from './host-accounts.js'
import type { GithubAccounts } from './cli.js'
import { listRequests } from './requests.js'
import { accountNamed, tokenOf } from './working-account.js'

/**
 * github, the module (#2394): the account a run works as on GitHub, first of its steps, and the
 * pull request its branch has, read back once the branch is, into the run's facts
 * (`RunFacts.github`), which the run's record keeps; and the account git work outside a run goes
 * as on GitHub (`account.access`): a push or a fetch a person's press makes. Its skill, with the command it teaches, is in
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
  /** How git outside a run reaches a repository on GitHub: as the account runs use; none when OpenAgent has none. */
  reach?: () => Promise<GitAccess | undefined>
  /** OpenAgent's GitHub accounts and gh's own state, as the Permissions page lists them. */
  accounts?: () => Promise<Pick<GithubAccounts, 'installed' | 'accounts'>>
  /** The open pull requests of the project at `dir`; throws where GitHub cannot say. */
  openRequests?: (dir: string) => Promise<OpenPr[]>
  /** Read how every recent request of the project at `dir` stands. */
  requestStates?: (dir: string) => Promise<unknown>
}

/** Where a run's commits are made, and go as its account: its project's repository, or a session's own folder, with the copies of its repos. */
/** Where a run's commits are made: a project's checkouts, and the session's folder too when the run has copies of repos there; or a session's folder alone. */
export type CommitsIn = { project: string; session?: string } | { session: string }

export function githubModule(deps: GithubDeps = {}): ModuleDefinition {
  const requestOfBranch = deps.requestOfBranch ?? branchRequest
  const onGithub = deps.onGithub ?? (async (dir: string) => (await homeUrlFor(dir).catch(() => undefined)) !== undefined)
  const workAs = deps.workAs ?? openagentAccount
  const reach = deps.reach ?? runsAccountAccess
  const accounts = deps.accounts ?? githubAccounts
  return defineModule({
    name: 'github',
    hooks: {
      'account.access': {
        git: async remote => (remoteHostOf(remote) === HOST ? reach() : undefined),
        hosts: hostAccounts,
        sendAs,
        mergeCommit: async (dir, branch, number) => ((await onGithub(dir)) ? mergeLookup(dir, branch, number) : undefined),
      },
      'app.attention': async args => {
        if (args.project === undefined) return accountsMissing(await accounts())
        if (!(await onGithub(args.project.dir))) return []
        // Every request of the project read with them, whatever its state: the lists mark a run whose request merged.
        const [open] = await Promise.all([(deps.openRequests ?? cachedOpenPrs)(args.project.dir), (deps.requestStates ?? cachedPrStates)(args.project.dir).catch(() => undefined)])
        const items = requestsWaiting(open, (await args.runs?.()) ?? [])
        args.pullRequestsRead?.([...requestsRead(), ...open.map(pr => ({ url: pr.url, state: pr.isDraft ? ('draft' as const) : ('open' as const), title: pr.title, ...(pr.headRefName !== undefined ? { branch: pr.headRefName } : {}) }))])
        return items
      },
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
 * git's way to GitHub as the account runs use, for git work outside a run: its token, never the
 * person's own login; no commit is made with it, so no name on commits. None when OpenAgent has no
 * account there, or its token cannot be read: the work is then refused by git, not done as someone else.
 */
async function runsAccountAccess(): Promise<GitAccess | undefined> {
  const gh = nodeGhRunner()
  const home = homedir()
  try {
    const { login, dir } = await accountNamed(undefined, home, gh, process.env)
    return { env: runEnv(await tokenOf(login, dir, home, gh), dir, readFacts(dir), process.env) }
  } catch {
    return undefined
  }
}

/**
 * The git directories of `commitsIn`, as git's `gitdir:` matches them, by their real path: a
 * project's own (its common directory, its main checkout's) and its worktrees' (in it), the run's
 * among them, with every repository in the session's folder when the run has copies of repos
 * there; or every repository in a session's folder alone. A repository elsewhere, such as one a
 * test makes in the temporary folder, is not among them, and commits as its own config says.
 */
export async function gitDirsOf(commitsIn: CommitsIn): Promise<string[]> {
  const session = commitsIn.session !== undefined ? [`${realPath(sessionFolder(sessionsHome(), commitsIn.session))}/**`] : []
  if (!('project' in commitsIn)) return session
  const common = realpathSync((await nodeGitRunner()(['rev-parse', '--path-format=absolute', '--git-common-dir'], commitsIn.project)).trim())
  return [common, `${common}/**`, ...session]
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
 * picked for it (`options.github.account`, its profile's among them), else the one picked for every
 * next run on this computer (`PICKED_GITHUB_ACCOUNT`), else the account runs use. What its
 * environment gets for it is the run's from here on, its agent's and its own git's, and its login
 * goes on its record. The repository that decides is the project's: a project on no GitHub
 * repository works as no account of this module's, and one picked an account there is refused. A
 * session with no project works as its account whatever its repos, and with none: its folder is on
 * no host, and it may reach GitHub all the same (a clone, a new repository, the person's pull
 * requests). With no account picked and none OpenAgent has, such a session goes on as no account:
 * it may need none. An account picked for the run that cannot be worked as is refused, rather than
 * run as someone else; the one picked for every next run that this computer no longer has gives
 * way to the account runs use.
 */
async function workAsAccount(ctx: RunContext, onGithub: (dir: string) => Promise<boolean>, workAs: NonNullable<GithubDeps['workAs']>): Promise<void> {
  const picked = ctx.options.github?.account
  if (ctx.project && !(await onGithub(ctx.project.dir))) {
    if (picked !== undefined) throw new Error(`This session works as @${picked} on GitHub, and it works in no repository on GitHub.`)
    return
  }
  // A session's own folder is made after its account is picked: gh is asked in the person's home folder.
  const dir = ctx.project?.dir ?? homedir()
  const commitsIn: CommitsIn = ctx.project ? { project: ctx.project.dir, ...(ctx.options['git-branches']?.repos?.length ? { session: ctx.id } : {}) } : { session: ctx.id }
  const kept = picked === undefined ? await ctx.settings.get(PICKED_GITHUB_ACCOUNT).catch(() => undefined) : undefined
  let working: WorkingAs
  try {
    working = await workAs(dir, picked ?? kept, commitsIn).catch(err => (kept !== undefined ? workAs(dir, undefined, commitsIn) : Promise.reject(err)))
  } catch (err) {
    if (!ctx.project && picked === undefined) return
    throw new Error(picked !== undefined ? `This session works as @${picked} on GitHub, and it cannot be used here: ${errorMessage(err)}` : errorMessage(err))
  }
  Object.assign(ctx.env, working.env)
  ctx.facts.github = { ...ctx.facts.github, account: working.login }
}

/**
 * What runs need on GitHub, as the onboarding card, the person's menu and the dot on their picture
 * say it: gh, an account of OpenAgent's own, or a login GitHub still takes. Its fix is the dialog
 * that adds an account, which installs gh first where it is missing.
 */
export function accountsMissing({ installed, accounts }: Pick<GithubAccounts, 'installed' | 'accounts'>): AttentionItem[] {
  if (installed && accounts.length > 0 && accounts.every(account => account.ok)) return []
  const words = !installed ? 'gh, the tool for GitHub, is not installed.' : accounts.length === 0 ? 'OpenAgent pushes and opens pull requests with an account of its own, never your own login.' : 'GitHub no longer takes a login: add it again.'
  const label = !installed ? 'Install gh' : accounts.length === 0 ? 'Add a GitHub account' : 'Add your GitHub account again'
  return [{ kind: 'setup', scope: 'computer', id: 'no-account', words: 'Connect GitHub', detail: words, fix: { label, action: ADD_ACCOUNT } }]
}

/**
 * The project's open pull requests, each waiting on the person to merge it: a run's, by the request
 * its record names, else by the branch a run worked on, where a press of its row goes to the run;
 * one opened by hand opens on GitHub. A draft opened by hand is not asking for review, so it is
 * left out; a draft on a run's branch is not: the agent opened it as a draft so it does not ask
 * reviewers, and nothing else would say the work is there.
 */
export function requestsWaiting(open: readonly OpenPr[], runs: readonly ProjectRun[]): AttentionItem[] {
  return open.flatMap((pr): AttentionItem[] => {
    const run = runs.find(one => one.pr?.url === pr.url) ?? (pr.headRefName !== undefined ? runs.find(one => one.branch === pr.headRefName) : undefined)
    if (pr.isDraft && !run) return []
    return [
      {
        kind: 'waiting',
        ...(run ? { scope: 'run' as const, run: run.id } : { scope: 'project' as const }),
        id: pr.url,
        words: 'Needs merge',
        title: run?.name ?? pr.title,
        detail: `#${pr.number}`,
        mark: 'pull-request',
        ...(pr.createdAt ? { since: pr.createdAt } : {}),
        fix: { label: `Open PR #${pr.number}`, href: pr.url },
      },
    ]
  })
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
