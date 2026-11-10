import { hostname } from 'node:os'
import { nodeGitRunner } from '@openagt/agent-data'
import { isPidAlive, readAllAgents, type AgentMeta, type BranchesFor } from '../store/index.js'
import { cachedPrStates, type PrState } from './pull-requests.js'
import { unpublishedRuns, type Unpublished } from './unpublished.js'
import { bridgeQuestions } from './bridge-store.js'
import type { SavedMachine } from '../dashboard-rpc/context.js'
import { isHostName } from '../registry.js'
import { machineKind, machineName } from '../reached-by-line.js'

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
export async function gitUserOf(cwd: string): Promise<string | undefined> {
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
  return withUnpublished(cwd, await withPrStates(cwd, agents))
}

/**
 * Each run that has a pull request, marked with how the request stands, so its row can show it:
 * from one cached listing of the project's requests, read only when one of the runs has a request.
 */
export async function withPrStates(cwd: string, agents: AgentMeta[], states: (cwd: string) => Promise<Map<string, PrState>> = cachedPrStates): Promise<AgentMeta[]> {
  if (!agents.some(agent => agent.pr !== undefined || agent.earlierPrs?.length)) return agents
  const known = await states(cwd)
  return agents.map(agent => {
    const prState = agent.pr && known.get(agent.pr.url)
    const earlierPrs = agent.earlierPrs?.map(pr => {
      const state = known.get(pr.url)
      return state ? { ...pr, state } : pr
    })
    return prState || earlierPrs ? { ...agent, ...(prState ? { prState } : {}), ...(earlierPrs ? { earlierPrs } : {}) } : agent
  })
}

/**
 * Each finished run whose work never left this machine, marked with how many files it left
 * uncommitted and how many commits wait, so its row can say so as the Human Queue does: the same
 * rule, {@link unpublishedRuns}. A provider that cannot be read marks nothing.
 */
export async function withUnpublished(cwd: string, agents: AgentMeta[], branches?: BranchesFor): Promise<AgentMeta[]> {
  const found = await unpublishedRuns(cwd, agents, branches).catch(() => new Map<string, Unpublished>())
  if (found.size === 0) return agents
  return agents.map(agent => {
    const work = found.get(agent.id)
    if (!work) return agent
    return { ...agent, ...(work.commits > 0 ? { unpublished: work.commits } : {}), ...(work.uncommitted > 0 ? { uncommitted: work.uncommitted } : {}) }
  })
}

/**
 * A project's runs with the ones this daemon follows on a machine (#1067), which live in its
 * memory. A run this computer sent that has no record here is listed first, as followed, so a
 * reload re-opens it instead of losing it. One that has a record keeps the record's row, in
 * its place, which holds more (its branch, its pull request, its parent), and takes from the
 * followed one what the machine said since: whether it works, and its session. A run followed
 * by its record is listed only while that record is there: deleted, it is gone from the list.
 */
export function withFollowed(followed: AgentMeta[], local: AgentMeta[], sent: (agentId: string) => boolean): AgentMeta[] {
  if (followed.length === 0) return local
  const live = new Map(followed.map(run => [run.id, run]))
  const recorded = new Set(local.map(agent => agent.id))
  const rows = local.map(record => {
    const run = live.get(record.id)
    if (!run) return record
    const { remoteLabel, remoteKind } = run
    // Where it runs is known: this computer sent it there, whatever name the machine goes by now.
    const { otherHost: _other, ...known } = record
    return { ...known, status: run.status, updatedAt: run.updatedAt, target: 'remote' as const, ...(remoteLabel !== undefined ? { remoteLabel } : {}), ...(remoteKind !== undefined ? { remoteKind } : {}), ...(run.sessionId !== undefined ? { sessionId: run.sessionId } : {}) }
  })
  return [...followed.filter(run => !recorded.has(run.id) && sent(run.id)), ...rows]
}

/**
 * A web run whose cloud session is waiting on a human — the bridge holds its parked question, or
 * claude.ai's session list shows it awaiting input (#1332) — is marked waiting (#1668), so its row
 * says so instead of "in cloud": the archive on disk cannot know, only the daemon's bridge store
 * does. Every other run passes through untouched.
 */
export function markCloudWaiting(agent: AgentMeta): AgentMeta {
  if (agent.target !== 'web' || !agent.sessionId || !bridgeQuestions().waiting(agent.sessionId)) return agent
  return { ...agent, cloudWaiting: true }
}

/**
 * A run another machine's daemon started is marked as from another host (#1648): the data branch
 * is shared precisely so other machines' runs show up here, and a row that looked exactly like
 * one of this daemon's own sent the user reading the archive by hand to learn whose it was. A run
 * with no recorded host predates the field and passes through untouched.
 */
export function markOtherHost(agent: AgentMeta, thisHost: string = hostname()): AgentMeta {
  // A run on a saved machine says where it runs by the machine's name, not as someone else's.
  if (agent.host === undefined || agent.host === thisHost || agent.remoteLabel !== undefined) return agent
  return { ...agent, otherHost: true }
}

/**
 * What a run's row says of the saved machine it runs on: its own name, and what it is, which its
 * icon draws, as every list of machines says them (reached-by-line.ts).
 */
export function onMachine(machine: SavedMachine): Pick<AgentMeta, 'remoteLabel' | 'remoteKind'> {
  return { remoteLabel: machineName(machine), remoteKind: machineKind(machine).kind }
}

/**
 * A run whose record names the computer of a saved machine runs on that machine, whoever started
 * it there, and reads like one this computer sent: by the name the machine was given. The record
 * comes through the project's shared records, so it is here for a run started on the machine's
 * own page too, and after this daemon forgot the runs it sent. A run of this computer, and one of
 * a computer that is no saved machine, pass through untouched.
 */
export function markMachine(agent: AgentMeta, machineOf: (host: string) => SavedMachine | undefined, thisHost: string = hostname()): AgentMeta {
  if (agent.host === undefined || agent.host === thisHost || agent.remoteLabel !== undefined) return agent
  const machine = machineOf(agent.host)
  return machine === undefined ? agent : { ...agent, target: 'remote', ...onMachine(machine) }
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
export function forDashboard(agent: AgentMeta, machineOf: (host: string) => SavedMachine | undefined): AgentMeta {
  return markSaving(markOtherHost(markMachine(markCloudWaiting(agent), machineOf)))
}

/**
 * A run as its record may say it. A record is a file anyone with the project can write, and its
 * tool's own words are read into the row as they are, so the words only this daemon gives a row
 * are taken off it first: that it runs on a saved machine and which, that it is another
 * computer's, that it is being saved, when its computer was last seen. A computer's name that is
 * no name is none.
 */
export function asRecorded(agent: AgentMeta): AgentMeta {
  const { remoteLabel: _label, remoteKind: _kind, otherHost: _other, saving: _saving, cloudWaiting: _waiting, seenAt: _seen, ...said } = agent
  if (said.target === 'remote') delete said.target
  if (said.host !== undefined && !isHostName(said.host)) delete said.host
  return said
}
