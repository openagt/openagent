import type { Driver, DriverEvent, DriverPromptOptions, DriverSession, DriverStartOptions, DriverTurn, DriverUsage } from './types.js'
import { makeEmit, promptSent, startEvent } from './session-support.js'
import { finishTurn } from './inbox.js'
import { attachLog, type SessionLog } from './session-log.js'
import { ConversationGoneError } from './gone.js'

/** One scripted turn the {@link FakeDriver} replays. */
export interface FakeTurn {
  /** The final assistant text. */
  text: string
  /** Tool names to emit as `action` events before the result (visual only). */
  actions?: string[]
  /** Token + cost accounting to report for this turn (#322). Omitted = no usage. */
  usage?: DriverUsage
}

/** Options for {@link FakeDriver}. */
export interface FakeDriverOptions {
  /**
   * Scripted turns, consumed in order across all `prompt` calls of a session.
   * Once exhausted the last one repeats, so a short script never starves a
   * longer run. Ignored when {@link respond} is set.
   */
  turns?: FakeTurn[]
  /** Answer dynamically from the prompt. Takes precedence over {@link turns}. */
  respond?: (prompt: string, index: number) => FakeTurn | string
  /** Files each session is pre-seeded with, exposed via {@link DriverSession.readCode}. */
  files?: Record<string, string>
  /** Session id to report (default `"fake-session"`). */
  sessionId?: string
  /** The model each turn says it runs on, as a real coding agent names it once started; none said when absent. */
  model?: string
  /** Conversations this agent no longer has: a `resume` prompt continuing one throws {@link ConversationGoneError}. */
  gone?: readonly string[]
}

function asTurn(value: FakeTurn | string): FakeTurn {
  return typeof value === 'string' ? { text: value } : value
}

/**
 * An in-memory {@link Driver} for tests and offline runs: it never spawns a
 * process, replays scripted turns deterministically, and emits the same
 * {@link DriverEvent} shape a real driver does, so a whole product can run
 * with no CLI installed and no model called.
 */
export class FakeDriver implements Driver {
  readonly id = 'fake'
  constructor(private readonly opts: FakeDriverOptions = {}) {}

  // Narrowed to the concrete session so callers can read `prompts` for assertions.
  start(opts: DriverStartOptions): Promise<FakeDriverSession> {
    return Promise.resolve(new FakeDriverSession(this.opts, opts))
  }
}

/** A single {@link FakeDriver} session. Records every prompt for assertions. */
export class FakeDriverSession implements DriverSession {
  readonly id: string
  readonly cwd: string
  /** Every prompt this session received, in order. */
  readonly prompts: string[] = []
  readonly log?: SessionLog
  private readonly startOpts: DriverStartOptions
  private index = 0

  constructor(
    private readonly config: FakeDriverOptions,
    startOpts: DriverStartOptions,
  ) {
    const attached = attachLog(startOpts)
    this.startOpts = attached.opts
    if (attached.log) this.log = attached.log
    this.id = config.sessionId ?? 'fake-session'
    this.cwd = startOpts.cwd
  }

  prompt(text: string, opts: DriverPromptOptions = {}): Promise<DriverTurn> {
    if (this.startOpts.signal?.aborted || opts.signal?.aborted) {
      return Promise.reject(new Error('fake prompt aborted'))
    }
    const resumed = opts.resume ? this.startOpts.resumeSessionId : undefined
    if (resumed !== undefined && this.index === 0 && this.config.gone?.includes(resumed)) return Promise.reject(new ConversationGoneError('fake', resumed))
    const i = this.index++
    const sent = promptSent(text, opts)
    this.prompts.push(sent)
    const turn = this.resolveTurn(sent, i)

    this.emit(startEvent(text, opts))
    if (this.config.model !== undefined) this.emit({ type: 'model', model: this.config.model })
    for (const label of turn.actions ?? []) this.emit({ type: 'action', label })
    if (turn.text) this.emit({ type: 'text', text: turn.text })
    this.emit({ type: 'result', text: turn.text, sessionId: this.id, ...(turn.usage ? { usage: turn.usage } : {}) })

    return finishTurn(this, { text: turn.text, sessionId: this.id, ...(turn.usage ? { usage: turn.usage } : {}) }, opts, e => this.emit(e))
  }

  readCode(path: string): Promise<string> {
    const contents = this.config.files?.[path]
    if (contents === undefined) return Promise.reject(new Error(`fake driver has no file ${path}`))
    return Promise.resolve(contents)
  }

  dispose(): Promise<void> {
    return Promise.resolve()
  }

  private resolveTurn(text: string, i: number): FakeTurn {
    if (this.config.respond) return asTurn(this.config.respond(text, i))
    const turns = this.config.turns ?? []
    if (turns.length === 0) return { text: '' }
    return turns[Math.min(i, turns.length - 1)]!
  }

  private emit(event: DriverEvent): void {
    makeEmit(this.startOpts.onEvent, 'fake driver')(event)
  }
}
