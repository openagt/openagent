import { hostname } from 'node:os'
import { nodeGitRunner, repositoryAddress } from '@openagt/agent-data'
import { isPidAlive, readAllAgents, type AgentMeta, type BranchesFor } from '../store/index.js'
import { pullRequestState, requestedBranches, takesRequests } from './pr-states.js'
import { unpublishedRuns, type Unpublished } from './unpublished.js'
import { isHostName } from '../registry.js'

// A run's row, as the dashboard's lists show it (dashboard-rpc/reads.ts): the run as its record
// says it, with what only this daemon knows and the disk cannot marked on it. Kept apart from the
// RPCs that serve the rows, since every function an RPC module exports is a call the page can make.

/**
 * A project's runs as its records and checkouts say them, each as recorded: the ones this
 * computer runs, and every other computer's whose record came through the project's shared records.
 * A run of this computer's that has no record yet is its project's git user's, as its record will be.
 */
export async function recordedRuns(cwd: string): Promise<AgentMeta[]> {
  const runs = (await readAllAgents(cwd)).map(asRecorded)
  const thisHost = hostname()
  if (!runs.some(run => run.person === undefined && run.host === thisHost)) return runs
  const person = await gitUserOf(cwd)
  return person === undefined ? runs : runs.map(run => (run.person === undefined && run.host === thisHost ? { ...run, person } : run))
}

/** How long a project's git user is trusted before git is asked again. */
const GIT_USER_KEPT_MS = 60_000
const gitUsers = new Map<string, { person?: string; until: number }>()

/** Whom git commits as in the project, as the runs' records are kept under it: its email, lowered. */
async function gitUserOf(cwd: string): Promise<string | undefined> {
  const kept = gitUsers.get(cwd)
  if (kept && kept.until > Date.now()) return kept.person
  const said = await nodeGitRunner()(['config', 'user.email'], cwd).then(
    out => out.trim().toLowerCase(),
    () => '',
  )
  gitUsers.set(cwd, { ...(said ? { person: said } : {}), until: Date.now() + GIT_USER_KEPT_MS })
  return said || undefined
}

/**
 * What a run's row marks beside its name, for both lists of runs, a project's and all projects'
 * together: how its pull request stands, and the work it left on this machine.
 */
export async function withRowMarks(cwd: string, agents: AgentMeta[]): Promise<AgentMeta[]> {
  return withUnpublished(cwd, withPrStates(agents))
}

/** How a request stands, as the modules last read it (`pr-states.ts`). */
type PrStates = { get(url: string): { state: NonNullable<AgentMeta['prState']>; title?: string } | undefined }

/**
 * Each run that has a pull request, marked with how the request stands, so its row can show it, and
 * with its title, so the jump finds the run by it: as the modules last read the requests at their
 * git host.
 */
export function withPrStates(agents: AgentMeta[], known: PrStates = { get: pullRequestState }): AgentMeta[] {
  if (!agents.some(agent => agent.pr !== undefined || agent.earlierPrs?.length)) return agents
  return agents.map(agent => {
    const listed = agent.pr && known.get(agent.pr.url)
    const earlierPrs = agent.earlierPrs?.map(pr => {
      const state = known.get(pr.url)?.state
      return state ? { ...pr, state } : pr
    })
    return listed || earlierPrs ? { ...agent, ...(listed ? { prState: listed.state, ...(listed.title ? { prTitle: listed.title } : {}) } : {}), ...(earlierPrs ? { earlierPrs } : {}) } : agent
  })
}

/**
 * Each finished run whose work never left this machine, marked with how many files it left
 * uncommitted and how many commits wait, so its row can say so as the Human Queue does: the same
 * rule, {@link unpublishedRuns}. A provider that cannot be read marks nothing.
 */
export async function withUnpublished(cwd: string, agents: AgentMeta[], branches?: BranchesFor): Promise<AgentMeta[]> {
  // A branch with an open request is published, as the modules last read the requests.
  const requested = async () => ((await takesRequests(await repositoryAddress(cwd).catch(() => undefined))) ? requestedBranches() : undefined)
  const found = await unpublishedRuns(cwd, agents, branches, requested).catch(() => new Map<string, Unpublished>())
  if (found.size === 0) return agents
  return agents.map(agent => {
    const work = found.get(agent.id)
    if (!work) return agent
    return { ...agent, ...(work.commits > 0 ? { unpublished: work.commits } : {}), ...(work.uncommitted > 0 ? { uncommitted: work.uncommitted } : {}) }
  })
}

/**
 * A run another machine's daemon started is marked as from another host (#1648): the data branch
 * is shared precisely so other machines' runs show up here, and a row that looked exactly like
 * one of this daemon's own sent the user reading the archive by hand to learn whose it was. A run
 * with no recorded host predates the field and passes through untouched.
 */
export function markOtherHost(agent: AgentMeta, thisHost: string = hostname()): AgentMeta {
  if (agent.host === undefined || agent.host === thisHost) return agent
  return { ...agent, otherHost: true }
}

/**
 * A run that ended clean while the process its card names is still alive on this host is marked
 * saving: the tool that runs it saves the run's record and cleans up its checkout after the card says
 * done, and a row that said "done" through that window read as finished with nothing coming. A
 * run of another host, or with no recorded process, passes through untouched.
 */
export function markSaving(agent: AgentMeta, thisHost: string = hostname(), alive: (pid: number) => boolean = isPidAlive): AgentMeta {
  if (agent.status !== 'done' || agent.pid === undefined || agent.host !== thisHost || !alive(agent.pid)) return agent
  return { ...agent, saving: true }
}

/** Every annotation a run gets on its way to the dashboard, once it is as recorded ({@link asRecorded}): what the daemon knows and the disk cannot. */
export function forDashboard(agent: AgentMeta): AgentMeta {
  return markSaving(markOtherHost(agent))
}

/**
 * A run as its record may say it. A record is a file anyone with the project can write, and its
 * tool's own words are read into the row as they are, so the words only this daemon gives a row
 * are taken off it first: that it is another computer's, that it is being saved. A computer's name
 * that is no name is none.
 */
export function asRecorded(agent: AgentMeta): AgentMeta {
  const { otherHost: _other, saving: _saving, ...said } = agent
  if (said.host !== undefined && !isHostName(said.host)) delete said.host
  return said
}
