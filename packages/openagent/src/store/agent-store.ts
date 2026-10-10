import { join } from 'node:path'
import type { OpenAgentEvent } from '../events.js'
import { nodeFs } from '../node-fs.js'
import { OPENAGENT_DIR } from '../openagent-dir.js'
import { projectBranches, type BranchesFor, type Checkout } from './branches.js'
import { isRunId, parseRunCard, projectRuns, type AnyDiaryLine, type RunsFor } from './runs.js'
import { eventsOf, fromRunCard } from './run-record.js'

/**
 * The read side of a project's runs (#1774). The daemon runs no agent and writes no run: a run's
 * tool keeps the run's card (`<id>.json`) and diary (`<id>.jsonl`) under the `.openagent/`
 * of the run's own checkout while it works, and a finished run is whatever the project's runs
 * provider answers (`runs.ts`), when one of its packages provides them. The dashboard is a
 * projection of those files and that answer.
 */

export type AgentStatus = 'running' | 'done' | 'stopped' | 'failed' | 'waiting'

/**
 * A queryable snapshot of the agent, derived entirely from the event log. Lets the
 * dashboard render a header (and a future agent list) without parsing every line.
 */
export interface AgentMeta {
  status: AgentStatus
  /** Stable, path-safe id for this agent (derived from {@link startedAt}). */
  id: string
  /** ISO timestamp the store was opened (run start). */
  startedAt: string
  /** ISO timestamp of the last event written. */
  updatedAt: string
  /** ISO timestamp the run ended (the `end` event), absent while it is going. The skill's card field. */
  endedAt?: string
  /** What the run cost so far in US dollars, summed over its `usage` events; absent until one says. The skill's card field. */
  cost?: number
  /**
   * The OS pid of the process running this run, on {@link host} — whatever process the project's
   * start hook began. Recorded on the card so Stop has something to signal, and so a reader can
   * tell a run that is working from one whose process died without recording an ending (#716).
   */
  pid?: number
  /** The host the owning {@link pid} lives on, so a pid probe only trusts a match (#716). */
  host?: string
  /** What this session was asked for (from the `intent` event). */
  intent?: string
  /**
   * The run this one was started for, by its id: this run is that run's subagent. Written on the
   * card by the tool that started it; absent on a run a person or a schedule started.
   */
  parent?: string
  /**
   * The branch the run was told to start from, by its name: a person's local branch picked in the
   * launcher, or, for a subagent, its main agent's branch. Written on the card by the tool that
   * started it; absent on a run that started from origin's default branch.
   */
  base?: string
  /**
   * The commit the run's own work begins at: where its branch was made, for a run started from a
   * branch other than the default one (a subagent starts from its main agent's). Its changes are
   * measured from it; absent, from the default branch. Written on the card by the tool that
   * started it.
   */
  baseCommit?: string
  /**
   * The last commit of the run's work, written on the card when its main agent landed it: its
   * branch is gone, and its changes are read from this commit. Absent on a run that is not landed.
   */
  landed?: string
  /** The wrapped agent (from the `session` event). */
  driver?: string
  /** The workspace the agent builds in (from the `session` event). */
  workspace?: string
  /** The wrapped agent's real session id, once it reports one. */
  sessionId?: string
  /** The link shown to jump into the live agent session. */
  sessionLink?: string
  /**
   * The branch the agent's work is on: the card's, and for a run with a checkout the branch that
   * checkout has checked out right now (the branches provider reads it), since the agent renames
   * its branch itself while the card learns the new name only when the run ends.
   *
   * Recorded, not derived: a clean agent loses its checkout, and the agent renames its branch
   * itself (#1725), so no name built from the run's id is guaranteed to be the one holding the
   * commits.
   */
  branch?: string
  /**
   * The hand-off anchor a cloud run pushed for its session to clone at (#1601): an empty commit
   * unique to this run, folded from the `cloud-anchor` event. The session works on a `claude/*`
   * branch of the cloud's own naming, and this is the ancestor by which the daemon's adoption
   * pass recognizes which of origin's `claude/*` heads is this run's. Absent on non-web runs
   * and on web runs whose pre-hand-off push failed.
   */
  cloudAnchor?: string
  /**
   * The pull request this session's work is on (E6), recorded when one is opened rather than
   * re-derived from branch names and timestamps by every surface that wants it.
   */
  pr?: { number: number; url: string }
  /**
   * What this session's end-of-session handoff is armed to do (#1102): push its branch, and open
   * a draft PR for it. Both start on.
   *
   * On the meta because the checkboxes that show it live in a different process from the agent that
   * obeys it, and a tab opened after the agent started has no event history to fold — the same
   * reason {@link browserStreamPort} is here. Absent means an older agent, which the reader treats
   * as armed, matching what that agent will actually do.
   *
   * `merge` mirrors the auto-merge arming (#1216, #1382) — display-only, like the rest of this
   * field: the agent merges off its own config, never off the meta. Absent on records from before
   * #1382, which the reader treats as off.
   */
  handoff?: { push: boolean; pr: boolean; merge?: boolean }
  /**
   * How the handoff's merge half went (#1418), folded from the `handoff` event's `merge` field.
   *
   * What the daemon's CI watch scans for: `watched` is a PR waiting for green that *this* side
   * must merge (the repo could not arm the git host's auto-merge), `auto-armed` one the git host will land by
   * itself but whose checks going red is still ours to notice. On the meta because the watch
   * reads metas, not event logs, and must survive both the agent's process and the daemon's.
   * Absent on runs from before this field, and on every agent whose handoff had no merge to report.
   */
  mergeOutcome?: 'auto-armed' | 'merged' | 'watched' | 'withheld' | 'failed'
  /**
   * The choice gate the agent is currently parked on (#636): set when a `choice` event fires and
   * cleared when its `choice-resolved` (or the agent's `end`) arrives. Present means the agent is
   * paused waiting for the user's answer — the second "needs you" source after open PRs (#624).
   */
  pendingChoice?: { id: string; title: string }
  /**
   * The browser bridge holds a question this run's cloud session is parked on (#1668). Not stored:
   * the daemon annotates a web run's record on the way to the dashboard, the way a relayed run's
   * label is, because the bridge store is in memory and the archive on disk knows nothing of it.
   */
  cloudWaiting?: boolean
  /**
   * The run was started by another machine's daemon (#1648): its {@link host} is not this one.
   * Not stored either — annotated on the way to the dashboard like {@link cloudWaiting}, since
   * the shared data branch shows every machine's runs here and only this daemon knows which host
   * it is.
   */
  otherHost?: boolean
  /**
   * The run ended clean and its process is still alive on this host: the tool that runs it is
   * still saving its record and cleaning up its checkout, the window every surface says "saving…" for.
   * Not stored: annotated on the way to the dashboard like {@link otherHost}, since only this
   * machine can ask whether the process is alive.
   */
  saving?: boolean
  /**
   * The loopback port the agent's browser preview is listening on (#813), or absent when the agent
   * has no browser. What lets the daemon proxy the pane: the port is allocated per agent and the
   * dashboard is a different process, so meta is the only place it can learn it.
   */
  browserStreamPort?: number
  /**
   * Where this run executes (#1050/#1053/#610): `actions` for a GitHub Actions run, `web` for a
   * Claude Code cloud session, `remote` when relayed to a saved machine (#1067), absent for a
   * local run. Persisted so the agent view can tell a burst-mode Actions run from a stalled live
   * feed, show a cloud agent's session link after a reload, and gate the browser pane off (#1053).
   */
  target?: 'local' | 'actions' | 'remote' | 'web'
  /** The saved machine a remote agent (#1067) executes on, for the session list + notice after a reload. */
  remoteLabel?: string
  /**
   * The flow this agent started under (#1467): `build` for the scope→build orchestration, `prompt`
   * for the direct-prompt path (research and transparent runs record `prompt` too). Persisted so a
   * continuation (#762) can re-enter the flow its first leg ran — the composer's Resume always
   * arrives as a `prompt` start, and without this record a resumed build agent ended as a bare
   * prompt session (no synthesize framing, no backlog offer). Absent on records from before this
   * field, which a reader treats as unknown (the continuation then keeps the prompt path).
   */
  kind?: 'build' | 'prompt'
  /**
   * The model id the current leg's agent was started with (#1438), folded from each leg's
   * `session` event — a continuation (#762) may run a different model than the first leg, so
   * the latest leg wins rather than the first pinning it. Absent when the leg left the agent
   * on its own default (and on records from before this field).
   */
  model?: string
}

/**
 * The slice of a filesystem the store's reads need: the logic is testable with an in-memory fs,
 * and only {@link nodeStoreFs} touches disk.
 */
export interface StoreFs {
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  append(path: string, contents: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  /** List a directory's entries (names only). Missing dir yields `[]`. */
  readdir(path: string): Promise<string[]>
}

/** Newest run first: an id sorts chronologically, so the id order IS the time order (no parse). */
const byIdDesc = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

/**
 * A project's finished runs, most-recent first: what its runs provider answers, unfolded into
 * OpenAgent's meta. No provider, or one that cannot be read, is no runs, never a throw.
 *
 * `since` (epoch ms) is for a caller that only wants recent runs — a poll on a cadence, not the
 * history list. `fresh` asks the provider past its last answer: the caller knows a run just finished.
 */
export async function listAgents(cwd: string, runs: RunsFor = projectRuns, opts: { since?: number; fresh?: boolean } = {}): Promise<AgentMeta[]> {
  const { since, fresh } = opts
  const cards = (await (await runs(cwd).catch(() => undefined))?.list(fresh ? { fresh } : {}).catch(() => [])) ?? []
  return cards
    .filter(card => since === undefined || Date.parse(card.startedAt) >= since)
    .map(fromRunCard)
    .sort(byIdDesc)
}

/**
 * One finished run's whole diary, from the project's runs provider: for a reader that follows a
 * run past its checkout. `undefined` for an unknown or unsafe id, a project with no provider, and
 * a record that still says `running` — the marker a run's tool may leave as it starts, before its
 * checkout exists: that run is not finished, its diary is still to come in the checkout.
 */
export async function readFinishedDiary(cwd: string, agentId: string, runs: RunsFor = projectRuns): Promise<AnyDiaryLine[] | undefined> {
  if (!isRunId(agentId)) return undefined
  const run = await (await runs(cwd).catch(() => undefined))?.show(agentId).catch(() => undefined)
  return run && run.card.status !== 'running' ? run.diary : undefined
}

/**
 * Whether `pid` is a live process on this host. `process.kill(pid, 0)` sends no signal but
 * throws `ESRCH` once the process is gone; `EPERM` means it exists under another user (still
 * alive). A pid on a *different* host is unknowable here, so callers guard on {@link AgentMeta.host}
 * before trusting a result. A recycled pid (another process reusing a dead agent's number) reads as
 * alive — an accepted, vanishingly rare miss on a single dev box.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * The run a checkout holds, off its live card, `<id>.json` under the checkout's `.openagent/`:
 * the shape agent-driver's log writes, read as the meta the card unfolds to, `running` or not (a
 * run that ended waiting on a question keeps its checkout), on the branch the checkout is on now
 * (the provider read it), since the agent renames its branch itself while its card learns the new
 * name only when the run ends. `undefined` when there is no card.
 * Never healed here: the tool that started the run sweeps its own dead runs.
 */
export async function readLiveMeta(checkout: Checkout, fs: StoreFs = nodeStoreFs()): Promise<AgentMeta | undefined> {
  const path = join(checkout.path, OPENAGENT_DIR, `${checkout.id}.json`)
  if (!(await fs.exists(path))) return undefined
  const card = parseRunCard(await fs.read(path).catch(() => ''))
  if (!card) return undefined
  return fromRunCard(checkout.branch ? { ...card, branch: checkout.branch } : card)
}

/** A run with a checkout, plus that checkout (#738): where to read the run's git and file status from. */
export interface LiveAgent extends AgentMeta {
  /** The run's own checkout, a worktree under `.branches/`. */
  cwd: string
}

/**
 * Every run of a project that has a checkout (#738): each checkout the project's branches
 * provider lists, its card through {@link readLiveMeta}. Newest first, by id. Never throws: a
 * project with no provider has no checkouts, and an unreadable checkout is skipped.
 */
export async function readLiveMetas(cwd: string, fs: StoreFs = nodeStoreFs(), branches: BranchesFor = projectBranches): Promise<LiveAgent[]> {
  const checkouts = (await (await branches(cwd).catch(() => undefined))?.list().catch(() => [])) ?? []
  const agents: LiveAgent[] = []
  for (const checkout of checkouts) {
    const meta = await readLiveMeta(checkout, fs).catch(() => undefined)
    if (meta) agents.push({ ...meta, cwd: checkout.path })
  }
  return agents.sort(byIdDesc)
}

/** A diary file's lines; a torn trailing line from a write in flight is dropped. */
function parseDiary(raw: string): AnyDiaryLine[] {
  const lines: AnyDiaryLine[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      lines.push(JSON.parse(trimmed) as AnyDiaryLine)
    } catch {
      break
    }
  }
  return lines
}

/**
 * One run's events, for a reader that replays them: the diary in the run's checkout while it has
 * one (it is the newer of the two), else the finished run's diary from the runs provider.
 * `undefined` for an unknown or unsafe id.
 */
export async function loadAgentEvents(cwd: string, id: string, fs: StoreFs = nodeStoreFs(), runs: RunsFor = projectRuns, branches: BranchesFor = projectBranches): Promise<OpenAgentEvent[] | undefined> {
  if (!isRunId(id)) return undefined
  const live = (await readLiveMetas(cwd, fs, branches).catch((): LiveAgent[] => [])).find(agent => agent.id === id)
  const liveDiary = live ? join(live.cwd, OPENAGENT_DIR, `${id}.jsonl`) : undefined
  if (liveDiary && (await fs.exists(liveDiary))) return eventsOf(parseDiary(await fs.read(liveDiary).catch(() => '')))
  const diary = await readFinishedDiary(cwd, id, runs)
  return diary ? eventsOf(diary) : undefined
}

/** How long a line saying what a run is doing may be. */
const DOING_MAX = 140

/** One diary line as what the agent is doing, or `undefined` for a line that says nothing of it. */
function doingOf(line: AnyDiaryLine): string | undefined {
  const text =
    line.kind === 'action' && typeof line['label'] === 'string'
      ? typeof line['detail'] === 'string' ? `${line['label']} ${line['detail']}` : line['label']
      : line.kind === 'said' && typeof line['text'] === 'string'
        ? line['text']
        : undefined
  const flat = text?.replace(/\s+/g, ' ').trim()
  if (!flat) return undefined
  return flat.length > DOING_MAX ? flat.slice(0, DOING_MAX - 1) + '…' : flat
}

/**
 * What each of the named runs is doing now, by id: the last thing its diary says it did (a tool
 * it used, with what) or said, on one line. Only a run with a checkout whose card says `running`
 * has an entry: an ended run is doing nothing, and its row says how it ended.
 */
export async function readDoing(cwd: string, ids: readonly string[], fs: StoreFs = nodeStoreFs(), branches: BranchesFor = projectBranches): Promise<Record<string, string>> {
  const doing: Record<string, string> = {}
  const live = await readLiveMetas(cwd, fs, branches).catch((): LiveAgent[] => [])
  for (const agent of live) {
    if (agent.status !== 'running' || !ids.includes(agent.id)) continue
    const lines = (await fs.read(join(agent.cwd, OPENAGENT_DIR, `${agent.id}.jsonl`)).catch(() => '')).split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const said = doingOf(parseDiary(lines[i]!)[0] ?? { kind: '' })
      if (said === undefined) continue
      doing[agent.id] = said
      break
    }
  }
  return doing
}

/** A {@link StoreFs} backed by `node:fs/promises`. See {@link nodeFs}. */
export function nodeStoreFs(): StoreFs {
  // Destructured rather than returned whole: the narrow interface is the contract,
  // so the object should not carry methods the store was never handed.
  const { read, write, append, exists, mkdir, readdir } = nodeFs()
  return { read, write, append, exists, mkdir, readdir }
}

/** The runs each project had a checkout for at its last {@link readAllAgents}, by project path. */
const liveSeen = new Map<string, Set<string>>()

/**
 * A project's runs: the ones with a checkout prepended to the finished ones, newest-first.
 * Forgiving — a side that cannot be read simply contributes nothing.
 *
 * The checkout's card wins over the recorded one (#768): a resumed run has a record from its
 * first leg AND is going again, and the record alone would show a running agent as finished.
 */
export async function readAllAgents(cwd: string, fs: StoreFs = nodeStoreFs(), runs: RunsFor = projectRuns, branches: BranchesFor = projectBranches): Promise<AgentMeta[]> {
  const live = await readLiveMetas(cwd, fs, branches).catch(() => [] as LiveAgent[])
  // A run that left its checkout since the last read was recorded a moment before: the provider's
  // list read before that would not have it, and its row would blink out until the next read.
  const ids = new Set(live.map(agent => agent.id))
  const before = liveSeen.get(cwd)
  liveSeen.set(cwd, ids)
  const fresh = before !== undefined && [...before].some(id => !ids.has(id))
  const archived = await listAgents(cwd, runs, { fresh }).catch(() => [] as AgentMeta[])
  // A run that is both (a stopped run keeps its checkout, and is recorded) reads as its checkout's
  // card, plus the one late fact the record alone learns: the pull request the dashboard's own
  // Open PR wrote onto the record, since OpenAgent never writes a checkout's card.
  const recorded = new Map(archived.map(agent => [agent.id, agent]))
  const withRecordedPr = (agent: LiveAgent): AgentMeta => {
    const pr = recorded.get(agent.id)?.pr
    return agent.pr === undefined && pr ? { ...agent, pr } : agent
  }
  return [...live.map(withRecordedPr), ...archived.filter(agent => !live.some(l => l.id === agent.id))]
}

/** One run's meta by id, the checkout's card winning over the record: {@link readAllAgents}'s rule for a single row. */
export async function findAgent(cwd: string, agentId: string, fs: StoreFs = nodeStoreFs(), runs: RunsFor = projectRuns, branches: BranchesFor = projectBranches): Promise<AgentMeta | undefined> {
  return (await readAllAgents(cwd, fs, runs, branches)).find(agent => agent.id === agentId)
}
