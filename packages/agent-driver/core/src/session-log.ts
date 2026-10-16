import { appendFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DriverEvent } from './types.js'

/**
 * The session's log: two files at a directory the caller gives, written as the agent works, in
 * the shape of a run record. `<id>.json` is the card, what the run is and how it stands;
 * `<id>.jsonl` is the diary, one JSON line per thing that happened. A dashboard reads them
 * while the agent runs; a runner copies them onto its records when the run ends, unchanged.
 * The shape is data, stated here, so that a runner and a dashboard agree on it without either
 * importing the other.
 *
 * The card: `id`, `startedAt`, `status` (`running` until ended, then `done`, `stopped`, `failed` or `waiting`), `endedAt`, `intent`, `driver`,
 * `model` (the one the caller asked for, until the agent names the one it runs: its full id), `branch`, `pr`, `cost` (dollars, summed from the turns that priced themselves), and
 * `caller`, one key for whatever the caller wants kept (its own mark, the pid, the session id).
 *
 * The diary: `said` (a text chunk), `result` (a turn's final text), `cost` (a turn's price,
 * `usd`), `question` (the question a turn ended on), `ended` (the status and a detail), and every
 * other event as a line of its own kind (`start`, `session`, `action`, `output`, `subagent`,
 * `thought`, `rate-limit`, `error`, `notice`). Every line the log writes carries `at`, the time it was written (ISO 8601), so a
 * reader shows when each thing happened, whenever it reads the diary. The agent's environment
 * names the diary ({@link DIARY_ENV}), so a command it runs may append whole lines of its own
 * kinds there too, with an `at` of their own to be shown with a time.
 *
 * A third file, `<id>.live`, holds the message the agent is writing, as far as it has got, as
 * plain text: rewritten as the pieces arrive, and removed once the message is whole in the diary.
 * It is there only while a message is being written. A runner copies the card and the diary, never
 * this file, so the pieces live only as long as the run's own directory.
 */

/** How the run ended: finished, stopped, failed, or waiting on an answer to the question its last turn asked. */
export type LogEndStatus = 'done' | 'stopped' | 'failed' | 'waiting'

/** What the card holds; every field but `id` is optional and the caller's to give or patch. */
export interface LogCard {
  id: string
  startedAt?: string
  intent?: string
  /** The run's short name, two to five words, as a list shows it; absent until something names it. */
  title?: string
  driver?: string
  model?: string
  branch?: string
  pr?: { number: number; url: string }
  /** How much of the model's context the conversation filled at the last turn ({@link DriverUsage.contextTokens}). */
  contextTokens?: number
  caller?: Record<string, unknown>
}

/** Where the log goes, and the card it starts with. */
export interface SessionLogOptions {
  dir: string
  card: LogCard
  /**
   * The files are there already, from an earlier session of the same run: the diary is kept and
   * appended to, and the card is rewritten `running`. Without it the diary starts empty.
   */
  continue?: boolean
}

/** A card as written. */
export interface WrittenCard extends LogCard {
  startedAt: string
  status: 'running' | LogEndStatus
  endedAt?: string
  cost?: number
}

/** The variable that names the diary in the agent's environment, when the session keeps one. */
export const DIARY_ENV = 'AGENT_DIARY'

/** The agent's environment: the given one, plus where the diary is when the session keeps a log. */
export function agentEnv(env: NodeJS.ProcessEnv, log: SessionLog | undefined): NodeJS.ProcessEnv {
  return log ? { ...env, [DIARY_ENV]: log.diaryPath } : env
}

/** The card's file name for a run id, and the diary's. */
export function logCardFile(id: string): string {
  return `${id}.json`
}
export function logDiaryFile(id: string): string {
  return `${id}.jsonl`
}
/** The live file's name: the message being written. */
export function logLiveFile(id: string): string {
  return `${id}.live`
}

/** The session's log, kept current as events arrive. Writes stay ordered; a failed write never breaks the run. */
export class SessionLog {
  card: WrittenCard
  private tail: Promise<void> = Promise.resolve()
  private opened = false
  /** The newest partial text not yet written, when a write of it is queued. */
  private partial: string | undefined
  /** Whether the live file holds text that a whole message has not replaced yet. */
  private liveWritten = false

  constructor(
    private readonly dir: string,
    card: LogCard,
    private readonly continued = false,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.card = { ...card, startedAt: card.startedAt ?? this.clock(), status: 'running' }
  }

  /** The card's path. */
  get cardPath(): string {
    return join(this.dir, logCardFile(this.card.id))
  }

  /** The diary's path. */
  get diaryPath(): string {
    return join(this.dir, logDiaryFile(this.card.id))
  }

  /** The live file's path. */
  get livePath(): string {
    return join(this.dir, logLiveFile(this.card.id))
  }

  /** Make the directory and write the card and, unless continuing an earlier session's log, an empty diary. Called by the driver when the session starts. */
  open(): Promise<void> {
    this.opened = true
    return this.queue(async () => {
      await mkdir(this.dir, { recursive: true })
      if (!this.continued) await writeFile(this.diaryPath, '')
      await this.writeCard()
    })
  }

  /**
   * Fold one event in: a diary line, and the card's cost or session id when the event carries one.
   * The model is a fact about the run, not something that happened in it: it goes on the card only.
   */
  record(event: DriverEvent): Promise<void> {
    if (event.type === 'model') {
      this.card.model = event.model
      return this.queue(() => this.writeCard())
    }
    if (event.type === 'partial') return this.writePartial(event.text)
    // The whole message replaces its pieces: a write of them still queued is dropped.
    if (event.type === 'text') this.partial = undefined
    const line = { ...diaryLine(event), at: this.clock() }
    if (event.type === 'result' && event.usage?.costUsd !== undefined) this.card.cost = (this.card.cost ?? 0) + event.usage.costUsd
    // How full the conversation is now, not a total: the newest turn's reading replaces the one before.
    if (event.type === 'result' && event.usage?.contextTokens !== undefined) this.card.contextTokens = event.usage.contextTokens
    if ((event.type === 'session' || event.type === 'result') && event.sessionId) {
      this.card.caller = { ...this.card.caller, sessionId: event.sessionId }
    }
    return this.queue(async () => {
      await appendFile(this.diaryPath, JSON.stringify(line) + '\n')
      if (event.type === 'result' && line.kind === 'result' && event.usage?.costUsd !== undefined) {
        await appendFile(this.diaryPath, JSON.stringify({ kind: 'cost', usd: event.usage.costUsd, at: line.at }) + '\n')
      }
      if (event.type === 'text') await this.clearLive()
      await this.writeCard()
    })
  }

  /**
   * The live file, to the newest partial text. Pieces come faster than files are written, so a
   * write already queued takes the newest text when its turn comes, and no second write is queued.
   */
  private writePartial(text: string): Promise<void> {
    const queued = this.partial !== undefined
    this.partial = text
    if (queued) return this.tail
    return this.queue(async () => {
      const newest = this.partial
      this.partial = undefined
      if (newest === undefined) return
      this.liveWritten = true
      // Written aside and moved over the old one: a watcher reading the file between a write's
      // emptying it and its filling it read nothing, and the page lost the message for a frame.
      await writeFile(`${this.livePath}.next`, newest)
      await rename(`${this.livePath}.next`, this.livePath)
    })
  }

  private async clearLive(): Promise<void> {
    if (!this.liveWritten) return
    this.liveWritten = false
    await rm(this.livePath, { force: true })
  }

  /** Add or change card fields the caller learns later: the branch, the pull request, its own mark. */
  patch(fields: Partial<Omit<LogCard, 'id'>>): Promise<void> {
    const { caller, ...rest } = fields
    this.card = { ...this.card, ...rest, ...(caller ? { caller: { ...this.card.caller, ...caller } } : {}) }
    return this.queue(() => this.writeCard())
  }

  /**
   * The run's short name: on the card, so every list of runs reads it, and a diary line too, so
   * the conversation shows where the name came from. Nothing else names a run, so the first one
   * given stays.
   */
  title(text: string): Promise<void> {
    if (this.card.title !== undefined) return this.tail
    this.card = { ...this.card, title: text }
    const at = this.clock()
    return this.queue(async () => {
      await appendFile(this.diaryPath, JSON.stringify({ kind: 'title', text, at }) + '\n')
      await this.writeCard()
    })
  }

  /** Close the log: the `ended` line and the card's status and end time. */
  end(status: LogEndStatus, detail?: string): Promise<void> {
    const at = this.clock()
    this.card = { ...this.card, status, endedAt: at }
    // A run stopped mid-message leaves its pieces unfinished: they go, like the message.
    this.partial = undefined
    return this.queue(async () => {
      await this.clearLive()
      await appendFile(this.diaryPath, JSON.stringify({ kind: 'ended', status, ...(detail !== undefined ? { detail } : {}), at }) + '\n')
      await this.writeCard()
    })
  }

  /**
   * Open an ended log again, for more turns of the same session: the card back to `running`, its
   * end time gone. The diary keeps its `ended` line; the turns that follow are appended after it,
   * as a resumed run's are.
   */
  reopen(): Promise<void> {
    const { endedAt: _endedAt, ...card } = this.card
    this.card = { ...card, status: 'running' }
    return this.queue(() => this.writeCard())
  }

  /** Resolves once every write so far has landed. */
  settled(): Promise<void> {
    return this.tail
  }

  private queue(task: () => Promise<void>): Promise<void> {
    if (!this.opened) return Promise.resolve()
    this.tail = this.tail.then(task).catch(() => {})
    return this.tail
  }

  private writeCard(): Promise<void> {
    return writeFile(this.cardPath, JSON.stringify(this.card, null, 2) + '\n')
  }
}

/** One event as a diary line. */
export function diaryLine(event: DriverEvent): { kind: string } & Record<string, unknown> {
  switch (event.type) {
    case 'text':
      return { kind: 'said', text: event.text }
    case 'result': {
      const { type: _type, usage: _usage, ...rest } = event
      return { kind: 'result', ...rest }
    }
    case 'question':
      return { kind: 'question', ...event.question }
    default: {
      const { type, ...rest } = event
      return { kind: type, ...rest }
    }
  }
}

/**
 * Attach a log to a session's start options when the caller asked for one: every event is
 * recorded before it reaches the caller's listener. Returns the options to build the session
 * with, and the log, or `undefined` when none was asked for.
 */
export function attachLog<O extends { onEvent?: (event: DriverEvent) => void; log?: SessionLogOptions }>(opts: O): { opts: O; log?: SessionLog } {
  if (!opts.log) return { opts }
  const log = new SessionLog(opts.log.dir, opts.log.card, opts.log.continue === true)
  void log.open()
  const onEvent = opts.onEvent
  return {
    log,
    opts: {
      ...opts,
      onEvent: (event: DriverEvent) => {
        void log.record(event)
        onEvent?.(event)
      },
    },
  }
}
