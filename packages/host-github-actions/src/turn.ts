import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { findRun, logCardFile, logDiaryFile, parseDiary, parseRunCard, readDiary, type AnyDiaryLine, type DriverEvent, type LogCard, type RecordDeps, type RunCard, type SessionLog } from '@openagt/agent-driver'
import { acquireRunLock, isPidAlive, markerCard, recordRun, releaseRunLock, writeMarker } from '@openagt/agent-runner'
import { accountToken, homeUrlFor, nodeGhRunner } from '@openagt/skill-github'
import { ActionsSession, type ActionsOptions } from './actions.js'

/**
 * One turn of a run on GitHub Actions, in a process of its own (#2394): the run's first, or one
 * that goes on with what the person said to it once it ended. It holds the run's lock while it
 * lives, so the sweep of this computer's runs leaves the run to it; writes the run's record
 * running; dispatches the turn to the project's workflow and waits for it, the Actions run's
 * address on the record as soon as GitHub has it; and records the run as the turn ended, its diary
 * the transcript read back. A run there never ends waiting on a question: a question needs the
 * agent's own tool asked over its stdin, or the ask plugin's block read by its run step, and a
 * runner has neither. What it asks in words, the person answers with a message.
 */

/** The host's id: what a run's options and its record name it by (`RunHost.id`). */
export const ACTIONS_HOST = 'actions'

/** The workflow a project's repository runs a run's turns with: the one this package brings (`workflow.yml`), under this name. */
export const WORKFLOW = 'openagent-agent.yml'

/** One turn of a run, as the host hands it to the run's process. */
export interface TurnRequest {
  /** The run's id. */
  id: string
  /** What the turn sends: the run's first prompt, or what the person said to it once it ended. */
  prompt: string
  /** The turn goes on with the run, ended: its branch, its conversation, its record. */
  resume?: true
  /** The model the run was started on; the workflow's default when absent. */
  model?: string
  /** One of OpenAgent's GitHub accounts, by its login: the run is dispatched and read as it. The one runs use when absent. */
  account?: string
}

/** What a turn works with; the real one when absent. */
export interface TurnDeps {
  /** The project's repository on GitHub, and a token that reaches it as the account. */
  github?: (dir: string, account: string | undefined) => Promise<GitHubAccess>
  /** The client's options beside those: its fetch and its clock, in a test. */
  actions?: Partial<ActionsOptions>
  /** This computer's name, as the run's record says it. */
  host?: string
  pid?: number
  now?: () => Date
  logs?: RecordDeps
  /** Fires on the person's Stop: the Actions run is cancelled, and the run ends stopped. */
  stop?: AbortSignal
  /** The run's name, as whoever started it asked for it: on the record from the first write after it comes. */
  title?: Promise<string | undefined>
}

/** Where a project's repository is on GitHub, and how it is reached. */
export interface GitHubAccess {
  owner: string
  repo: string
  token: string
  /** The account the token is. */
  login: string
}

/** The project's repository on GitHub and the account's token: refused, in words for the person, when it is on no GitHub or the account cannot be used. */
export async function githubAccess(dir: string, account: string | undefined): Promise<GitHubAccess> {
  const home = await homeUrlFor(dir)
  const slug = home?.replace(/^https:\/\/github\.com\//, '').split('/')
  if (!slug || slug.length !== 2) throw new Error('This project is not on GitHub: GitHub Actions runs a project whose repository is there.')
  const { login, token } = await accountToken(dir, account, nodeGhRunner())
  return { owner: slug[0]!, repo: slug[1]!, token, login }
}

/** Run one turn of run `request.id` of the project at `dir`, and record how it went: its card as recorded. */
export async function runTurn(dir: string, request: TurnRequest, deps: TurnDeps = {}): Promise<RunCard> {
  const pid = deps.pid ?? process.pid
  const host = deps.host ?? hostname()
  const now = deps.now ?? (() => new Date())
  const logs = deps.logs ?? {}
  await acquireRunLock(dir, request.id, { pid, isAlive: isPidAlive })
  const logDir = await mkdtemp(join(tmpdir(), 'host-github-actions-'))
  try {
    const { card, diary } = await opening(dir, request, { host, pid, now, logs })
    // The run's name, once it is in: on every write of the record from then on.
    let named: { title: string } | undefined
    void deps.title?.then(
      title => {
        if (title !== undefined) named = { title }
      },
      () => {},
    )
    // The Actions run's address goes on the record as soon as GitHub has it: the run's page links to it while the turn runs, and after.
    let address: { actionsRun: string } | undefined
    let noted: Promise<unknown> = Promise.resolve()
    const onEvent = (event: DriverEvent): void => {
      const url = event.type === 'action' ? /^run (https?:\/\/\S+)$/.exec(event.label)?.[1] : undefined
      if (url === undefined) return
      address = { actionsRun: url }
      noted = recordRun(dir, withCaller({ ...card, ...named }, address), diary, logs)
    }
    if (diary.length > 0) await writeFile(join(logDir, logDiaryFile(request.id)), diary.map(line => JSON.stringify(line)).join('\n') + '\n')
    let log: SessionLog | undefined
    try {
      const access = await (deps.github ?? githubAccess)(dir, request.account ?? accountOf(card))
      const session = new ActionsSession(
        { owner: access.owner, repo: access.repo, token: access.token, workflow: WORKFLOW, ...(card.branch !== undefined ? { branch: card.branch } : {}), ...deps.actions },
        {
          cwd: dir,
          ...(card.model !== undefined ? { model: card.model } : {}),
          ...(typeof card.caller?.['sessionId'] === 'string' ? { resumeSessionId: card.caller['sessionId'] } : {}),
          ...(deps.stop ? { stop: deps.stop } : {}),
          log: { dir: logDir, card: logCardOf(withCaller(card, { gitAccount: access.login })), continue: diary.length > 0 },
          onEvent,
        },
      )
      log = session.log
      const turn = await session.prompt(request.prompt, { resume: request.resume === true })
      if (session.branch !== undefined) await log?.patch({ branch: session.branch })
      await log?.end(turn.stopped ? 'stopped' : 'done')
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      if (log) await log.end('failed', detail)
      else return await record(dir, withCaller({ ...card, ...named, status: 'failed', endedAt: now().toISOString() }, address ?? {}), [...diary, { kind: 'ended', status: 'failed', detail, at: now().toISOString() }], noted, logs)
    }
    await log?.settled()
    const written = parseRunCard(await readFile(join(logDir, logCardFile(request.id)), 'utf8').catch(() => ''))
    const lines = parseDiary(await readFile(join(logDir, logDiaryFile(request.id)), 'utf8').catch(() => ''))
    if (!written) throw new Error(`The log of run ${request.id} could not be read back.`)
    return await record(dir, { ...written, ...named, caller: { ...card.caller, ...written.caller, ...address } }, lines, noted, logs)
  } finally {
    await rm(logDir, { recursive: true, force: true })
    await releaseRunLock(dir, request.id, pid)
  }
}

/** The run's card and diary as the turn opens: a first turn's marker, or an ended run's record opened again. */
async function opening(dir: string, request: TurnRequest, at: { host: string; pid: number; now: () => Date; logs: RecordDeps }): Promise<{ card: RunCard; diary: AnyDiaryLine[] }> {
  if (request.resume !== true) {
    const marker = markerCard({ id: request.id, startedAt: at.now().toISOString(), prompt: request.prompt, driver: 'claude-code', ...(request.model !== undefined ? { model: request.model } : {}), mark: { host: at.host, pid: at.pid } })
    const card = withCaller(marker, { target: ACTIONS_HOST, pid: at.pid, ...(request.account !== undefined ? { gitAccount: request.account } : {}) })
    await writeMarker(dir, card, at.logs)
    return { card, diary: [] }
  }
  const recorded = await findRun(dir, request.id, at.logs)
  if (!recorded || recorded.caller?.['target'] !== ACTIONS_HOST) throw new Error(`No run ${request.id} of this project ran on GitHub Actions.`)
  if (recorded.status === 'running') throw new Error('It is still working on GitHub Actions.')
  const diary = (await readDiary(dir, request.id, at.logs)) ?? []
  const { endedAt: _ended, ...open } = recorded
  // Its process now is this one, on this computer, which may not be the one its last turn ran on.
  const card = withCaller({ ...open, status: 'running' }, { host: at.host, pid: at.pid, runner: { host: at.host, pid: at.pid } })
  await recordRun(dir, card, diary, at.logs)
  return { card, diary }
}

/** The card with more said under `caller`. */
function withCaller(card: RunCard, more: Record<string, unknown>): RunCard {
  return { ...card, caller: { ...card.caller, ...more } }
}

/** The account the run worked as, last time it ran: a later turn goes on as it. */
function accountOf(card: RunCard): string | undefined {
  const account = card.caller?.['gitAccount']
  return typeof account === 'string' ? account : undefined
}

/** The record's card as the turn's log starts it. */
function logCardOf(card: RunCard): LogCard {
  return {
    id: card.id,
    startedAt: card.startedAt,
    ...(card.intent !== undefined ? { intent: card.intent } : {}),
    ...(card.title !== undefined ? { title: card.title } : {}),
    ...(card.driver !== undefined ? { driver: card.driver } : {}),
    ...(card.model !== undefined ? { model: card.model } : {}),
    ...(card.branch !== undefined ? { branch: card.branch } : {}),
    ...(card.pr !== undefined ? { pr: card.pr } : {}),
    ...(card.caller !== undefined ? { caller: card.caller } : {}),
  }
}

/** Record the run as the turn ended, once the address written while it ran is in: the last write is the run's end. */
async function record(dir: string, card: RunCard, diary: readonly AnyDiaryLine[], noted: Promise<unknown>, logs: RecordDeps): Promise<RunCard> {
  await noted
  await recordRun(dir, card, diary, logs)
  return card
}
