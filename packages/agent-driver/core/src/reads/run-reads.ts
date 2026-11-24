import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { listSessionFolders, sessionFolder, sessionsHomeOf } from '@openagt/agent-data'
import { worktreeBranch, worktreeDirEntries, worktreePath } from '@openagt/git-branches'
import type { GitBranchesFacts, GithubFacts, PullRequest, RunAgent, RunFacts, RunFeedEvent, RunOptions, RunStatus, RunSummary, RunsWanted } from '@openagt/hooks'
import { isRunId, parseRunCard, startOfId, type AnyDiaryLine, type RunCard } from '../record.js'
import { findRun, keptRuns, readDiary } from '../record-store.js'
import { logCardFile, logDiaryFile } from '../session-log.js'
import { liveDir } from '../engine/live-card.js'
import { fromDiaryLine } from './run-events.js'
import { partialReader, tailAgentEvents, type TailTarget } from './events-tail.js'

// What this computer's host answers of its runs (`RunHost.list`, `RunHost.events`): read off the
// files agent-driver writes, the live card and diary in a working run's checkout and the run's
// record in the project's data. A read never writes: a run whose process died is closed by the
// sweep (`engine/sweep.ts`), not by whoever reads it.

/** A run's folder while it has one: its checkout of the project, or a session's folder of its own. */
export interface RunFolder {
  id: string
  path: string
  /** The branch it has out now, for a checkout of the project. */
  branch?: string
}

/**
 * A run's card as it stands: its live card's facts over its record's, fact by fact, so a fact only
 * the record learned stays (the pull request a press opened once the run's process was gone). The
 * one merge of the two: a resumed run has a record from its first leg and works again, and the
 * record alone would show it ended.
 */
export function standing(record: RunCard | undefined, live: RunCard | undefined): RunCard | undefined {
  if (!live) return record
  if (!record) return live
  const pr = live.pr ?? record.pr
  return { ...record, ...live, ...(pr ? { pr } : {}), caller: { ...record.caller, ...live.caller } }
}

/**
 * The folders a project's runs work in now: each checkout under its `.branches/`, at the branch it
 * has out while git can read it there, or each session's folder in the sessions home. A checkout
 * git cannot read (its clean-up is removing it) is still its run's folder.
 */
export async function runFolders(dir: string): Promise<RunFolder[]> {
  const home = await sessionsHomeOf(dir)
  if (home !== undefined) return listSessionFolders(home)
  const folders: RunFolder[] = []
  for (const entry of await worktreeDirEntries(dir)) {
    const branch = await worktreeBranch(entry.path).catch(() => undefined)
    folders.push({ id: entry.agentId, path: entry.path, ...(branch !== undefined ? { branch } : {}) })
  }
  return folders
}

/** The run's folder while it is there: see {@link runFolders}. */
export async function folderOf(dir: string, id: string): Promise<RunFolder | undefined> {
  const home = await sessionsHomeOf(dir)
  const path = home !== undefined ? sessionFolder(home, id) : worktreePath(dir, id)
  if (!(await stat(path).then(found => found.isDirectory(), () => false))) return undefined
  const branch = home !== undefined ? undefined : await worktreeBranch(path).catch(() => undefined)
  return { id, path, ...(branch !== undefined ? { branch } : {}) }
}

/**
 * The run's folder while its work is there: a session's folder, or a checkout of the project with a
 * `.git` of its own; without one, git in that folder would read the project's own checkout, and its
 * branch would pass for the run's.
 */
export async function ownFolder(dir: string, id: string): Promise<RunFolder | undefined> {
  const folder = await folderOf(dir, id)
  if (!folder || ((await sessionsHomeOf(dir)) === undefined && !(await stat(join(folder.path, '.git')).then(() => true, () => false)))) return undefined
  return folder
}

/** A run's live card, in its folder while it works there; none when it has none, whatever tool wrote it. */
export async function liveCard(folder: string, id: string): Promise<RunCard | undefined> {
  const raw = await readFile(join(liveDir(folder), logCardFile(id)), 'utf8').catch(() => undefined)
  return raw === undefined ? undefined : parseRunCard(raw)
}

/** What reading a host's runs works with. */
export interface RunReadsDeps {
  /** The host's id, which its summaries name. */
  host: string
  /** This computer's name, as the cards of its runs say it. */
  here: string
  isAlive: (pid: number) => boolean
  /** The coding agents, which say how one of their sessions is picked back up. */
  agents: () => Promise<readonly RunAgent[]>
}

/** A record as a list reads it: with the person it is kept under. */
type Listed = RunCard & { person?: string }

/**
 * A project's runs on this host, newest first, each as it stands: the ones with a folder, their
 * live card over their record, and the recorded ones. A record of a run another host ran (a GitHub
 * Actions runner, a cloud session) is that host's to list.
 */
export async function listedRuns(dir: string, project: string | undefined, wanted: RunsWanted, deps: RunReadsDeps): Promise<RunSummary[]> {
  const folders = await runFolders(dir).catch((): RunFolder[] => [])
  const [records, agents] = await Promise.all([keptRuns(dir, folders.map(folder => folder.id)), deps.agents().catch((): RunAgent[] => [])])
  const byId = new Map<string, { card: Listed; folder?: RunFolder }>()
  for (const card of records) if (!otherHosts(card)) byId.set(card.id, { card })
  for (const folder of folders) {
    const live = await liveCard(folder.path, folder.id)
    if (!live) continue
    const recorded = byId.get(folder.id)?.card
    byId.set(folder.id, { card: { ...standing(recorded, live)!, ...(recorded?.person !== undefined ? { person: recorded.person } : {}) }, folder })
  }
  const ids = wanted.ids ? new Set(wanted.ids) : undefined
  const since = wanted.since !== undefined ? Date.parse(wanted.since) : undefined
  const runs = [...byId.values()].filter(({ card }) => (!ids || ids.has(card.id)) && (since === undefined || Date.parse(card.startedAt) >= since))
  // A run of this computer's that has no record yet is its project's git user's, as its record will be.
  const unkept = (card: Listed): boolean => card.person === undefined && card.caller?.['host'] === deps.here
  const person = runs.some(({ card }) => unkept(card)) ? await gitUserOf(dir) : undefined
  return runs
    .map(({ card, folder }) => summaryOf(unkept(card) && person !== undefined ? { ...card, person } : card, { project, folder, agents, deps }))
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

/** Whether a record is of a run another host ran: its record names that host. */
function otherHosts(card: RunCard): boolean {
  const target = card.caller?.['target']
  return typeof target === 'string' && target !== 'local'
}

/** How long a project's git user is trusted before git is asked again. */
const GIT_USER_KEPT_MS = 60_000
const gitUsers = new Map<string, { person?: string; until: number }>()

/** Whom git commits as in the project, as the runs' records are kept under it: its email, lowered. */
async function gitUserOf(dir: string): Promise<string | undefined> {
  const known = gitUsers.get(dir)
  if (known && known.until > Date.now()) return known.person
  const said = await new Promise<string>(resolve => execFile('git', ['config', 'user.email'], { cwd: dir, timeout: 10_000 }, (err, out) => resolve(err ? '' : String(out).trim().toLowerCase())))
  gitUsers.set(dir, { ...(said ? { person: said } : {}), until: Date.now() + GIT_USER_KEPT_MS })
  return said || undefined
}

/** A field of a card's `caller` that is a string. */
function text(card: RunCard, key: string): string | undefined {
  const value = card.caller?.[key]
  return typeof value === 'string' ? value : undefined
}

/** The pull requests a card's `caller` keeps, as far as they are pull requests. */
function pullRequests(value: unknown): PullRequest[] | undefined {
  if (!Array.isArray(value)) return undefined
  const prs = value.flatMap(pr => (pr && typeof pr === 'object' && typeof pr.number === 'number' && typeof pr.url === 'string' ? [{ number: pr.number as number, url: pr.url as string }] : []))
  return prs.length > 0 ? prs : undefined
}

/** Where a summary is read: the project it is in, the run's folder while it has one, the coding agents, and the host. */
export interface SummaryAt {
  project: string | undefined
  folder?: RunFolder | undefined
  agents: readonly RunAgent[]
  deps: Pick<RunReadsDeps, 'host' | 'here' | 'isAlive'>
}

/**
 * A run's card as a host lists it: the record's own fields, and what its writer kept under
 * `caller` that a page shows (its options, its facts, the computer it ran on, its agent's session).
 */
export function summaryOf(card: Listed, at: SummaryAt): RunSummary {
  const status: RunStatus = card.status === 'running' ? 'working' : card.status
  const computer = text(card, 'host')
  const options = card.caller?.['options']
  // The branch the checkout has out now: the agent renames its branch as it works, and its card learns the name at the end.
  const branch = at.folder?.branch ?? card.branch
  const baseCommit = text(card, 'baseCommit')
  const landed = text(card, 'landed')
  const branches: GitBranchesFacts = { ...(branch !== undefined ? { branch } : {}), ...(baseCommit !== undefined ? { baseCommit } : {}), ...(landed !== undefined ? { landed } : {}) }
  const account = text(card, 'gitAccount')
  const earlierPrs = pullRequests(card.caller?.['earlierPrs'])
  const github: GithubFacts = { ...(account !== undefined ? { account } : {}), ...(card.pr ? { pr: card.pr } : {}), ...(earlierPrs ? { earlierPrs } : {}) }
  const facts: RunFacts = { ...(Object.keys(branches).length > 0 ? { 'git-branches': branches } : {}), ...(Object.keys(github).length > 0 ? { github } : {}) }
  const sessionId = text(card, 'sessionId')
  const workspace = text(card, 'workspace')
  const resume = sessionId !== undefined ? at.agents.find(agent => agent.id === card.driver)?.resumeCommand?.({ id: sessionId, ...(workspace !== undefined ? { cwd: workspace } : {}) }) : undefined
  const pid = card.caller?.['pid']
  const ticket = (card as RunCard & { ticket?: unknown }).ticket
  return {
    id: card.id,
    ...(at.project !== undefined ? { project: at.project } : {}),
    host: at.deps.host,
    status,
    startedAt: card.startedAt,
    ...(card.endedAt !== undefined ? { endedAt: card.endedAt } : {}),
    ...(card.title !== undefined ? { title: card.title } : {}),
    ...(card.caller?.['naming'] === true ? { naming: true as const } : {}),
    prompt: card.intent ?? '',
    ...(card.person !== undefined ? { person: card.person } : {}),
    ...(card.cost !== undefined ? { cost: card.cost } : {}),
    ...(card.contextTokens !== undefined ? { contextTokens: card.contextTokens } : {}),
    ...(card.driver !== undefined ? { agent: { id: card.driver, ...(card.model !== undefined ? { model: card.model } : {}), ...(card.effort !== undefined ? { effort: card.effort } : {}) } } : {}),
    ...(options && typeof options === 'object' && !Array.isArray(options) ? { options: options as RunOptions } : {}),
    ...(Object.keys(facts).length > 0 ? { facts } : {}),
    // A computer's name that is no name is none: a record is a file anyone with the project can write.
    ...(computer !== undefined && /^[A-Za-z0-9._-]{1,253}$/.test(computer) ? { computer } : {}),
    ...(typeof ticket === 'string' ? { ticket } : {}),
    ...(workspace !== undefined ? { workspace } : {}),
    ...(sessionId !== undefined ? { session: { id: sessionId, ...(resume !== undefined ? { resume } : {}) } } : {}),
    // Ended clean while the process its card names is alive here: it is saving the run's record and
    // cleaning up its checkout, and a row that said "done" through that read as finished with nothing coming.
    ...(card.status === 'done' && typeof pid === 'number' && computer === at.deps.here && at.deps.isAlive(pid) ? { saving: true as const } : {}),
    // Says it works, under a process of this computer's that is gone: read as it is, for the sweep to end.
    ...(card.status === 'running' && typeof pid === 'number' && computer === at.deps.here && !at.deps.isAlive(pid) ? { gone: true as const } : {}),
  }
}

/** How long after its start a run with neither a folder nor a record may still be on its way: as long as a run may take to start. */
const STARTING_MS = 30_000

/**
 * Where a run's diary is, for the tail that follows it: a file while the run has its folder, the
 * finished run's lines once it has none, or nowhere yet (`pending`: started a moment ago, or
 * resumed with its checkout on its way back, its record saying it is running). Nothing for an id
 * that is no run's.
 */
export async function diaryOf(dir: string, id: string): Promise<TailTarget<AnyDiaryLine> | undefined> {
  if (!isRunId(id)) return undefined
  const folder = await folderOf(dir, id)
  if (folder) return { file: join(liveDir(folder.path), logDiaryFile(id)) }
  const record = await findRun(dir, id).catch(() => undefined)
  if (!record || record.status === 'running') return { pending: true }
  return { finished: (await readDiary(dir, id).catch(() => undefined)) ?? [] }
}

/**
 * A run's events, as its host streams them: the diary's lines from the start, read as events, the
 * end-of-replay marker once they are in, the message being written as it changes, and every line
 * after, across the diary's move from the run's checkout to its record (`events-tail.ts`). A run
 * with neither a folder nor a record, long after its start, is no run here: nothing comes.
 */
export async function* runEvents(dir: string, id: string, signal: AbortSignal): AsyncGenerator<RunFeedEvent> {
  const first = await diaryOf(dir, id)
  if (first === undefined) return
  if ('pending' in first && !(await findRun(dir, id).catch(() => undefined)) && !(Date.now() - startOfId(id) <= STARTING_MS)) return
  const queue: RunFeedEvent[] = []
  let wake: (() => void) | undefined
  const push = (event: RunFeedEvent): void => {
    queue.push(event)
    wake?.()
  }
  const stop = tailAgentEvents<AnyDiaryLine>(
    () => diaryOf(dir, id),
    line => {
      const event = fromDiaryLine(line)
      if (event) push(event)
    },
    () => push({ kind: 'stream-sync' }),
    partialReader(text => push({ kind: 'partial', text })),
  )
  const aborted = (): void => wake?.()
  signal.addEventListener('abort', aborted, { once: true })
  try {
    while (!signal.aborted) {
      const next = queue.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      await new Promise<void>(resolve => (wake = resolve))
      wake = undefined
    }
  } finally {
    signal.removeEventListener('abort', aborted)
    stop()
  }
}

/** `command` run in `cwd`, the folder made again first when it is gone: where a coding agent finds its session. Quoted, so a space in the path does not split it. */
export function inFolder(cwd: string | undefined, command: string): string {
  if (!cwd) return command
  const quoted = `'${cwd.replaceAll("'", `'\\''`)}'`
  return `mkdir -p ${quoted} && cd ${quoted} && ${command}`
}
