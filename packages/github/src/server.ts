import { act, read, type RpcHost } from '@openagt/hooks/rpc'
import { PICKED_GITHUB_ACCOUNT, PICKED_PROFILE, PROFILES, START_FROM, profileOf, type RunFound, type PullRequestState } from '@openagt/hooks'
import { nodeGitRunner, originDefaultBranch, currentBranch, isSafeAgentId, originGit, pushBranchByName, pushRefusalLine } from '@openagt/git-branches'
import { forgetRequests, isWorking, prHandoffOf, readRunPr, requestText, type PrHandoff } from './handoff.js'
import { homeUrlFor } from './home.js'
import { cachedPrStates, requestsRead } from './pulls.js'
import { HOST } from './accounts.js'
import type { GithubAccounts } from './cli.js'
import { accountsChanged, cliAnswer, githubAccounts } from './host-accounts.js'
import { addOwner, readHosted, readOwners, removeOwner, type HostedRead } from './hosted.js'

// github's server part (`@openagt/hooks/rpc`): what its places in the dashboard read and do.
// OpenAgent's own GitHub accounts, for the Permissions page and every place that picks one: read,
// picked for runs, forgotten, added by a login in the browser, and gh installed for them. A press
// runs this package's own command in this process, never one a page sent. The accounts are this
// computer's and no project's: the dashboard calls these in no project of its own.

export type { GithubAccount, GithubAccounts } from './cli.js'
export type { HostedRead, HostedRepo } from './hosted.js'
export type { Carries, PrHandoff } from './handoff.js'

/** What a press answered: done, with what it did in a few words, or why not, in words for the person. */
export type Pressed = { ok: true; said?: string } | { ok: false; error: string }

/** OpenAgent's GitHub accounts, and the projects on GitHub, by name: what uses them. */
export interface AccountsRead extends GithubAccounts {
  projects: string[]
}

/** OpenAgent's GitHub accounts and what is missing for them: the last answer, the accounts read again behind it. */
export const accounts = read(async (host: RpcHost): Promise<AccountsRead> => {
  const [read, projects] = await Promise.all([githubAccounts(), host.projects().catch(() => [])])
  return { ...read, projects: projects.filter(project => project.remote?.split('/')[0] === HOST).map(project => project.name) }
})

/** A press of the accounts' own commands: what is read of them after it is read after it. */
async function press(args: string[]): Promise<Pressed> {
  const done = await cliAnswer(args)
  accountsChanged()
  return done.ok ? { ok: true } : done
}

/** Runs use `login`, one of OpenAgent's own accounts, from now on. */
export const useForRuns = act(async (_host: RpcHost, { login }: { login: string }): Promise<Pressed> => press(['use', String(login)]))

/**
 * Take an account off, on this computer: gh forgets it, and its token goes on working wherever
 * else it is. The account runs use is not taken off: another is picked first.
 */
export const forget = act(async (_host: RpcHost, { login }: { login: string }): Promise<Pressed> => {
  const runs = (await githubAccounts()).accounts.find(account => account.runs)
  if (runs?.login === login) return { ok: false, error: `Runs use @${login}: pick another account for runs first.` }
  return press(['forget', String(login)])
})

/** Log another account in, in the browser: the code the person types, and where. */
export const login = act(async (): Promise<{ ok: true; code: string; url: string } | { ok: false; error: string }> => {
  const done = await cliAnswer(['login'])
  accountsChanged()
  if (!done.ok) return done
  const said = done.output as { code?: unknown; url?: unknown } | null
  return typeof said?.code === 'string' && typeof said.url === 'string' && said.url.startsWith('https://') ? { ok: true, code: said.code, url: said.url } : { ok: false, error: 'gh gave no code to log in with.' }
})

/** Give up the login under way: gh stops waiting, and the press to add an account is back. */
export const stopLogin = act(async (): Promise<Pressed> => press(['stop-login']))

/** Install gh, with no admin; the page follows the install. */
export const install = act(async (): Promise<Pressed> => press(['install']))

/** The repositories OpenAgent's accounts and the owners the person named have on GitHub: what the project picker offers to add (`composer.where`). */
export const repos = read(async (): Promise<HostedRead> => readHosted())

/** The users and organizations on GitHub whose repositories the picker lists, by name. */
export const owners = read(async (): Promise<string[]> => readOwners())

/** List one more user's or organization's repositories, as a person types it. */
export const addRepoOwner = act(async (_host: RpcHost, { owner }: { owner: string }): Promise<Pressed> => addOwner(owner))

/** Stop listing an owner's repositories. */
export const removeRepoOwner = act(async (_host: RpcHost, { owner }: { owner: string }): Promise<Pressed> => removeOwner(owner))

/**
 * The GitHub account the next run started on this computer works as where its options name none,
 * as its first step reads it (`module.ts`): its profile's (`profile`, else the one picked for every
 * next run) where that names one, else the one picked for every next run here; none for the
 * account runs use.
 */
export const picked = read(async (host: RpcHost, input: { profile?: string }): Promise<{ login?: string }> => {
  const id = typeof input?.profile === 'string' ? input.profile : await host.settings.get(PICKED_PROFILE)
  const login = profileOf(await host.settings.get(PROFILES), id).options.github?.account ?? (await host.settings.get(PICKED_GITHUB_ACCOUNT))
  return login !== undefined ? { login } : {}
})

/** Pick the GitHub account every next run on this computer works as: `login`, or none for the account runs use. */
export const pick = act(async (host: RpcHost, { login }: { login?: string }): Promise<Pressed> => {
  await host.settings.set(PICKED_GITHUB_ACCOUNT, PICKED_GITHUB_ACCOUNT.parse(login))
  return { ok: true }
})

/** Whether the project the call is in is on GitHub; a session with no project may reach GitHub all the same. */
export const where = read(async (host: RpcHost): Promise<{ project: boolean; github: boolean }> => {
  const project = await host.project()
  return { project: project !== undefined, github: project === undefined || project.remote?.split('/')[0] === HOST }
})

/** Whether the page named a run: an id is a path segment in every read here, so nothing that climbs out of a folder is one. */
function isRunId(id: unknown): id is string {
  return typeof id === 'string' && isSafeAgentId(id)
}

/** The ended run a press acts on, as its host finds it; why the press is refused otherwise: no run by that id, or one still writing its branch. */
async function endedRun(host: RpcHost, agentId: unknown): Promise<{ run: RunFound | undefined } | { refused: Pressed }> {
  if (!isRunId(agentId)) return { refused: { ok: false, error: 'Unknown session.' } }
  const run = await host.run(agentId)
  return isWorking(run?.record?.status) ? { refused: { ok: false, error: 'That session is still going; stop it first.' } } : { run }
}

/** The requests a merge pressed here left to this package's own watcher, which GitHub does not report as armed: said as merging once the checks pass. */
const watched = new Set<string>()

/** What the bar under an ended run offers for its pull request, or a copy's (`repo`, by its name in the session's folder). */
export const pullRequest = read(async (host: RpcHost, { agentId, repo }: { agentId: string; repo?: string }): Promise<PrHandoff> => {
  if (!isRunId(agentId)) return {}
  const run = await host.run(agentId)
  if (isWorking(run?.record?.status)) return {}
  const offered = await prHandoffOf(await readRunPr(host.root, agentId, run, repo).catch(() => undefined))
  host.pullRequestsRead(requestsRead())
  return offered.merge && offered.pr && watched.has(offered.pr.url) ? { pr: offered.pr, armed: true } : offered
})

/**
 * Open a pull request for the run's branch, or a copy's: the branch pushed as an account of
 * OpenAgent's, then the request opened, into the branch the run's options name (`github.prBase`)
 * or the repository's default. Its title and body say what its commits did. A run's request is
 * written on its record, which every place then reads it from.
 */
export const openPr = act(async (host: RpcHost, { agentId, repo, draft }: { agentId: string; repo?: string; draft?: boolean }): Promise<Pressed & { number?: number }> => {
  const ended = await endedRun(host, agentId)
  if ('refused' in ended) return ended.refused
  const read = await readRunPr(host.root, agentId, ended.run, repo, { fresh: true }).catch(() => null)
  if (read === null) return { ok: false, error: "GitHub could not say whether this branch has a pull request already; try again." }
  const offered = await prHandoffOf(read, async () => undefined)
  if (!read || !offered.open || read.at.branch === undefined) return { ok: false, error: offered.pr ? `This session already has PR #${offered.pr.number}.` : 'This session has no work to open a pull request for.' }
  const { cwd, branch } = { cwd: read.at.cwd, branch: read.at.branch }
  const git = await originGit(cwd, host.gitAccess)
  if (!git) return { ok: false, error: 'OpenAgent has no account to push this branch as: add one in Permissions.' }
  const pushed = await pushBranchByName(cwd, branch, git)
  if (!pushed.ok) return { ok: false, error: `Could not push the branch: ${pushRefusalLine(branch, pushed)}` }
  const text = await requestText(cwd, agentId, read.handoff)
  const base = repo === undefined ? ended.run?.record?.options?.github?.prBase : undefined
  const opened = await cliAnswer(['open', `--branch=${branch}`, `--title=${text.title}`, `--body=${text.body}`, ...(base !== undefined ? [`--base=${base}`] : []), ...(draft ? ['--draft'] : [])], cwd)
  forgetRequests(cwd, branch)
  if (!opened.ok) return { ok: false, error: `Could not open the pull request: ${opened.error}` }
  const request = (opened.output as { request?: { number?: unknown; url?: unknown } }).request
  if (typeof request?.number !== 'number' || typeof request.url !== 'string') return { ok: false, error: 'GitHub named no pull request.' }
  if (repo === undefined) await host.record(agentId, { github: { pr: { number: request.number, url: request.url } } })
  return { ok: true, said: `Opened ${draft ? 'draft ' : ''}PR #${request.number}.`, number: request.number }
})

/** Push the commits the run's open request does not have yet: the branch to origin, as an account of OpenAgent's. */
export const updatePr = act(async (host: RpcHost, { agentId, repo }: { agentId: string; repo?: string }): Promise<Pressed> => {
  const ended = await endedRun(host, agentId)
  if ('refused' in ended) return ended.refused
  const read = await readRunPr(host.root, agentId, ended.run, repo)
  if (!read || read.at.branch === undefined) return { ok: false, error: 'This session recorded no branch to push.' }
  const git = await originGit(read.at.cwd, host.gitAccess)
  if (!git) return { ok: false, error: 'OpenAgent has no account to push this branch as: add one in Permissions.' }
  const pushed = await pushBranchByName(read.at.cwd, read.at.branch, git)
  forgetRequests(read.at.cwd, read.at.branch)
  return pushed.ok ? { ok: true, said: 'Pushed.' } : { ok: false, error: `Could not push the branch: ${pushRefusalLine(read.at.branch, pushed)}` }
})

/**
 * Merge the run's open request: merged at once where its checks have passed, else armed on GitHub
 * to merge once they do, or watched by this package where the repository allows no auto-merge; a
 * draft is marked ready on the way. "Already merged" is an answer, not an action.
 */
export const mergePr = act(async (host: RpcHost, { agentId, repo }: { agentId: string; repo?: string }): Promise<Pressed> => {
  const ended = await endedRun(host, agentId)
  if ('refused' in ended) return ended.refused
  const read = await readRunPr(host.root, agentId, ended.run, repo)
  const pr = read?.pr
  if (!read || !pr) return { ok: false, error: 'This session has no pull request to merge.' }
  if (pr.state !== 'OPEN') return { ok: false, error: `This session's PR is already ${pr.state.toLowerCase()}.` }
  const merged = await cliAnswer(['merge', String(pr.number)], read.at.cwd)
  forgetRequests(read.at.cwd, read.at.branch)
  if (!merged.ok) return { ok: false, error: `Could not merge the pull request: ${merged.error}` }
  const outcome = (merged.output as { outcome?: unknown }).outcome
  if (outcome === 'watching') watched.add(pr.url)
  return { ok: true, said: outcome === 'merged' ? `Merged PR #${pr.number}.` : `PR #${pr.number} merges when its checks pass.` }
})

/** The project's page on GitHub; none for a project whose origin is not there. */
export const home = read(async (host: RpcHost): Promise<{ url?: string }> => {
  if (!(await host.project())) return {}
  const url = await homeUrlFor(host.root).catch(() => undefined)
  return url !== undefined ? { url } : {}
})

/** The private repository a project with no origin would be given on GitHub, `<account>/<folder>`; none for one that has an origin, or no account to create it with. */
export const repositoryOffer = read(async (host: RpcHost): Promise<{ repository?: string }> => {
  if (!(await host.project())) return {}
  const offer = await cliAnswer(['create', '--check'], host.root)
  const repository = offer.ok ? (offer.output as { repository?: unknown }).repository : undefined
  return typeof repository === 'string' ? { repository } : {}
})

/** Create that repository, set it as the project's origin and push the project to it. */
export const createRepository = act(async (host: RpcHost): Promise<Pressed> => {
  if (!(await host.project())) return { ok: false, error: 'A session with no project has no repository to create.' }
  const created = await cliAnswer(['create'], host.root)
  return created.ok ? { ok: true, said: `Created ${String((created.output as { repository?: unknown }).repository ?? 'the repository')}.` } : { ok: false, error: `Could not create the repository: ${created.error}` }
})

/**
 * Where a pull request of the project's next run goes, for its launcher: the main branch, and the
 * branch the run starts from (git-branches' `START_FROM` pick) where that is another branch origin
 * has, which a request goes into unless the person picks the main branch. Nothing for a session
 * with no project or a project with no remote.
 */
export const prTarget = read(async (host: RpcHost): Promise<{ main?: string; start?: string }> => {
  const project = await host.project()
  if (!project) return {}
  const [origin, picks] = await Promise.all([originDefaultBranch(host.root).catch(() => undefined), host.settings.get(START_FROM)])
  if (origin === undefined) return {}
  const main = origin.slice('origin/'.length)
  const pick = picks[project.id]
  const branch = pick === undefined ? undefined : pick.kind === 'published' ? pick.branch : await currentBranch(host.root).catch(() => undefined)
  if (branch === undefined || branch === main) return { main }
  // A branch of this machine origin does not have takes no pull request: it goes into the main branch.
  const onOrigin = pick?.kind === 'published' || (await nodeGitRunner()(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], host.root).then(() => true, () => false))
  return onOrigin ? { main, start: branch } : { main }
})

/** One of a run's pull requests, and how it stands, as GitHub last said; no state for one it has not said. */
export interface RunPr {
  number: number
  url: string
  state?: PullRequestState
}

/** The run's pull requests, oldest first: the ones it opened before, then the one its record names, each with how it stands. */
export const runPrs = read(async (host: RpcHost, { agentId }: { agentId: string }): Promise<RunPr[]> => {
  if (!isRunId(agentId)) return []
  const record = (await host.run(agentId))?.record
  const own = record?.pr
  const prs = [...(record?.earlierPrs ?? []).filter(pr => pr.url !== own?.url), ...(own ? [own] : [])]
  if (prs.length === 0) return []
  const states = await cachedPrStates(host.root).catch(() => undefined)
  host.pullRequestsRead(requestsRead())
  return prs.map(pr => {
    const state = states?.get(pr.url)?.state
    return { number: pr.number, url: pr.url, ...(state ? { state } : {}) }
  })
})
