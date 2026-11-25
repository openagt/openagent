import { hostname } from 'node:os'
import { runIdFrom, writeRun, type AnyDiaryLine, type RecordDeps, type RunCard } from '@openagt/agent-driver'
import type { ProjectRef, RunRequest, GitRunner } from '@openagt/hooks'
import { bridgeQuestions } from './bridge-store.js'
import { bridgeStarts, type BridgeStarts } from './bridge-starts.js'
import { githubAccount, repoOf } from './github.js'
import { WEB_HOST, updateWebRun } from './web-runs.js'

/**
 * A run handed to Claude Code on the web (#610, #2394): the cloud session is made on claude.ai, in
 * the person's own account, by the bridge extension, through the page's repository picker, so the
 * session is bound to the repository and can push its work and open its pull request (#1328). The
 * run is recorded running at once, and the hand-off goes on in this process: the project's
 * checkout as it stands is pushed for the session to start at, the start is queued for the
 * extension, and once the session is made, the run's record names it. The run reads as working
 * while its session may be; the plugin's pass ends it (`passes.ts`).
 *
 * What the run is not is a streamed peer of a run on this computer: a cloud session has no
 * read-back of its own, only its address, so following it is the bridge's (its questions, and a
 * mirror of its page) or the person's, on claude.ai or with `claude --teleport`.
 */

/** Said when no extension is there to make the session. */
export const NO_EXTENSION =
  'No Claude web extension has spoken to OpenAgent in the last few minutes: open Chrome with it (Settings › Claude web says how), or let OpenAgent run its own browser for it, then start again.'

/** What a hand-off works with; the real one when absent. */
export interface HandOffDeps {
  /** Whether an extension spoke to the bridge recently enough to make a session. */
  extensionAlive?: () => boolean
  starts?: BridgeStarts
  /** The project's repository on GitHub, as claude.ai's picker names it. */
  repo?: (dir: string) => Promise<string>
  /** One of OpenAgent's GitHub accounts, as git with origin works as it. */
  account?: (dir: string, account: string | undefined) => Promise<{ login: string; git: GitRunner }>
  logs?: RecordDeps
  /** This computer's name, as the run's record says it. */
  host?: string
  now?: () => Date
  /** How often the start is asked about while the extension makes the session. */
  pollMs?: number
  /** How long the extension is given to make it. */
  timeoutMs?: number
}

/** What a web run starts with. */
export interface WebStart {
  prompt: string
  model?: string
  /** One of OpenAgent's GitHub accounts, by its login: the start is pushed as it. The one runs use when absent. */
  account?: string
  title?: RunRequest['title']
}

/** The hand-offs under way in this process, by run: what a Stop gives up. */
const handing = new Map<string, AbortController>()

/** Whether the run's hand-off is under way in this process. */
export function handingOff(id: string): boolean {
  return handing.has(id)
}

/** Give the run's hand-off up: the run ends stopped. False when none is under way here. */
export function giveUp(id: string): boolean {
  const hand = handing.get(id)
  hand?.abort()
  return hand !== undefined
}

/** The branch of origin's a run's start is pushed to: slash-free, as a session cannot start on a slashed ref (#1320). */
export function anchorRefOf(id: string): string {
  return `openagent-web-${id}`
}

/**
 * Start a web run in the project: refused, in words for the person, when the project is not on
 * GitHub, no extension is there to make its session, or OpenAgent has no GitHub account to push
 * its start as. Answered once the run is recorded; the hand-off goes on.
 */
export async function startWebRun(project: ProjectRef, start: WebStart, deps: HandOffDeps = {}): Promise<{ id: string }> {
  const repo = await (deps.repo ?? repoOf)(project.dir)
  if (!(deps.extensionAlive ?? (() => bridgeQuestions().extensionAlive()))()) throw new Error(NO_EXTENSION)
  const account = await (deps.account ?? githubAccount)(project.dir, start.account)
  const now = deps.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const id = runIdFrom(startedAt)
  const card: RunCard = {
    id,
    startedAt,
    status: 'running',
    intent: start.prompt,
    driver: 'claude-code',
    ...(start.model !== undefined ? { model: start.model } : {}),
    caller: { target: WEB_HOST, host: deps.host ?? hostname(), gitAccount: account.login },
  }
  await writeRun(project.dir, card, [{ kind: 'start', prompt: start.prompt, at: startedAt }], deps.logs ?? {})
  const stop = new AbortController()
  handing.set(id, stop)
  // A record that cannot be written as the hand-off goes leaves the run running with no session:
  // the pass ends it, once the hand-off is under way nowhere.
  void handOff(project.dir, card, { repo, git: account.git, start }, stop.signal, deps)
    .catch(() => {})
    .finally(() => handing.delete(id))
  return { id }
}

/** The hand-off of run `card`: its start pushed, its session asked of the extension, and the run recorded as that went. */
async function handOff(dir: string, card: RunCard, to: { repo: string; git: GitRunner; start: WebStart }, signal: AbortSignal, deps: HandOffDeps): Promise<void> {
  const now = deps.now ?? (() => new Date())
  const logs = deps.logs ?? {}
  const starts = deps.starts ?? bridgeStarts()
  // One write of the record at a time: the run's name may come in while the hand-off writes it.
  let writes: Promise<unknown> = Promise.resolve()
  const write = (change: (current: RunCard) => RunCard, more: readonly AnyDiaryLine[] = []): Promise<unknown> => {
    const next = writes.then(() => updateWebRun(dir, card.id, change, more, logs))
    writes = next.catch(() => {})
    return next
  }
  // The run's name, written as it comes in.
  if (to.start.title) {
    void to.start.title.then(
      title => (title !== undefined ? write(current => ({ ...current, title })) : undefined),
      () => {},
    )
  }
  let pushed: { anchor: string; anchorRef: string } | undefined
  try {
    // The session starts at a ref of origin's, so the picker's branch list must offer the run's
    // start (#1320). What is pushed is not HEAD itself but an empty commit on it, the run's own
    // (#1601): the session's branch is told apart from every other by descending from it.
    const anchorRef = anchorRefOf(card.id)
    let anchor: string
    try {
      anchor = (await to.git(['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', `OpenAgent: the start of web run ${card.id}`], dir)).trim()
      await to.git(['push', 'origin', `${anchor}:refs/heads/${anchorRef}`], dir)
    } catch (err) {
      throw new Error(`Its start could not be pushed to origin as ${anchorRef} (${message(err)}): the cloud session starts at that branch.`)
    }
    pushed = { anchor, anchorRef }
    if (signal.aborted) throw new Error('stopped')
    const queued = starts.request({ repo: to.repo, branch: anchorRef, prompt: to.start.prompt, ...(to.start.model !== undefined ? { model: to.start.model } : {}) })
    if (typeof queued === 'string') throw new Error(`The extension was not asked for the session: ${queued}.`)
    let session: { id: string; url: string }
    try {
      session = await made(starts, queued.id, signal, deps)
    } finally {
      starts.clear(queued.id)
    }
    await write(current => ({ ...current, caller: { ...current.caller, sessionId: session.id, sessionLink: session.url, ...pushed } }), [{ kind: 'result', text: handedOff(session), at: now().toISOString() }])
  } catch (err) {
    const status = signal.aborted ? 'stopped' : 'failed'
    const at = now().toISOString()
    const ended: AnyDiaryLine = { kind: 'ended', status, detail: signal.aborted ? 'Stopped before its cloud session was made.' : message(err), at }
    await write(current => ({ ...current, status, endedAt: at, caller: { ...current.caller, ...pushed } }), [ended])
  }
}

/** Said of a hand-off that ended with OpenAgent, before its session was made. */
export const UNMADE = 'OpenAgent stopped before its cloud session was made.'

/**
 * End a run whose hand-off is under way nowhere, its session never made: it ended with an earlier
 * run of OpenAgent on this computer. `stopped` when a person stopped it, else `failed`.
 */
export async function endUnmade(dir: string, id: string, status: 'stopped' | 'failed', logs: RecordDeps = {}, now: () => Date = () => new Date()): Promise<void> {
  const at = now().toISOString()
  await updateWebRun(dir, id, card => ({ ...card, status, endedAt: at }), [{ kind: 'ended', status, detail: UNMADE, at }], logs)
}

/** The session the extension made for start `id`: refused with the extension's own word when it could not, or when the wait is over. */
async function made(starts: BridgeStarts, id: string, signal: AbortSignal, deps: HandOffDeps): Promise<{ id: string; url: string }> {
  const pollMs = deps.pollMs ?? 1000
  const until = Date.now() + (deps.timeoutMs ?? 180_000)
  for (;;) {
    if (signal.aborted) throw new Error('stopped')
    const start = starts.get(id)
    if (!start) throw new Error('The request for its session was lost.')
    if (start.state === 'created' && start.sessionId && start.url) return { id: start.sessionId, url: start.url }
    if (start.state === 'failed') throw new Error(`The extension could not make its session${start.note ? `: ${start.note}` : ''}.`)
    if (Date.now() >= until) throw new Error(start.state === 'queued' ? 'No extension took the start in time: is its browser still open?' : 'The extension did not make the session in time.')
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, pollMs)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    })
  }
}

/** What the run's chat says once its session is made: where the work goes on, and how to bring it here. */
function handedOff(session: { id: string; url: string }): string {
  return ['Handed off to Claude Code on the web: the session works on claude.ai, and opens its own pull request.', '', `The session: ${session.url}`, `To go on with it here: claude --teleport ${session.id}`].join('\n')
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
