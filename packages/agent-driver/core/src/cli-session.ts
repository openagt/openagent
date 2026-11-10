import { createInterface } from 'node:readline'
import { killTree, registerChild, unregisterChild } from './child-registry.js'
import { randomUUID } from 'node:crypto'
import type { DriverEvent, DriverTurn } from './types.js'
import { promptSent, startEvent } from './session-support.js'
import { takeInbox, type InboxLine, type PromptLine } from './inbox.js'

// The agent-agnostic core for running one wrapped coding-agent CLI: spawn it in its own
// process group, stream its output through a parser, and gate the turn on its exit. Each
// concrete driver (claude-code, codex) supplies the argv and an AgentCliParser for its own
// output dialect; everything about the *process* lives here, so a second driver reuses it
// rather than reaching into the first driver's file for it.

/** Grace between SIGTERM and the SIGKILL that forces a hung agent tree down. */
const TERMINATE_GRACE_MS = 5000

/** How long an agent asked to stop has to end its turn before its process is ended instead. */
const STOP_GRACE_MS = 10_000

/** How often the inbox is read while a turn runs: a message reaches the agent within this. */
const INBOX_EVERY_MS = 250

/** The slice of `child_process.spawn` a driver needs. Injectable for tests. */
export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; detached?: boolean },
) => SpawnedProcess

/** The slice of a spawned process a driver reads. */
export interface SpawnedProcess {
  /** OS pid; present for a real child, absent for in-memory test fakes. */
  pid?: number | undefined
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  stdin: NodeJS.WritableStream | null
  on(event: 'close', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  kill(signal?: NodeJS.Signals): unknown
}

/**
 * The slice of a driver's output parser {@link runCliSession} drives: fed one line
 * at a time, asked for the turn at the end. Each wrapped agent speaks its own
 * dialect (`StreamJsonParser` for Claude Code, `CodexAppServerParser` for
 * Codex), but the process handling around it is identical.
 */
export interface AgentCliParser {
  /** Fold one line of the agent's output in, and surface anything worth emitting. */
  push(line: string): DriverEvent[]
  /** The turn the lines added up to. */
  result(): DriverTurn
  /**
   * Why the turn failed, when the agent's output shows it did: the reason the agent gave, a truer
   * one than whatever it printed to stderr, or `''` when its output stopped before the turn ended
   * without saying why. A failure fails the turn even when the process exits 0.
   */
  failure?(): string | undefined
  /**
   * For a CLI that is talked to rather than handed its prompt (a JSON-RPC server on stdio): called
   * once, as soon as the process is spawned, with a way to write a line to its stdin and to close
   * it. Without it, the prompt is written whole and stdin closed at once.
   */
  converse?(io: CliIo): void
  /**
   * Hand the agent a message while its turn runs, for it to read between two of its steps: `words`
   * is what it is sent, `text` the person's own part of it, `id` its name. The parser emits a
   * `steered` event with the text and the id once the agent read it. False when the turn takes none
   * now: it has not begun, or it is over.
   */
  steer?(message: { id: string; text: string; words: string }): boolean
  /** Take back a message {@link steer} handed over that the agent has not read yet. */
  withdraw?(id: string): void
  /** Let the messages handed over reach the agent now: what it is running goes on in the background. */
  hurry?(): void
  /**
   * Ask the agent to end its turn where it is; its turn's result then says `stopped`. False when
   * it cannot be asked, and its process is ended instead.
   */
  stop?(): boolean
}

/** Writing to the agent CLI's stdin, for a parser that converses with it. */
export interface CliIo {
  /** Write one line (the newline is added). */
  write(line: string): void
  /** Close stdin: the CLI's cue that nothing more is coming. */
  end(): void
}

/** How to run one agent-CLI invocation. */
export interface RunCliSessionOptions {
  bin: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  prompt: string
  /** The sentence the caller adds after the prompt; the `start` event names it apart. */
  added?: string
  /** The text the caller hands over with the prompt; the `start` event names it apart. */
  attached?: string
  /** What goes to the CLI's stdin, for a CLI that reads the prompt wrapped. Default the prompt with the attached text and the added sentence after it. Unused when the parser converses. */
  stdin?: string
  spawn: SpawnLike
  emit: (event: DriverEvent) => void
  signals: AbortSignal[]
  /** The agent's own output dialect. */
  parser: AgentCliParser
  /** The driver's id, for error messages, e.g. `"claude-code"`. */
  driver: string
  /** Ends the turn on purpose ({@link AgentCliParser.stop}), where {@link signals} kill it. */
  stop?: AbortSignal
  /**
   * The inbox (`inbox.ts`), read while the turn runs: each message goes to the agent at once
   * ({@link AgentCliParser.steer}) as the words {@link steered} makes of it; one for later, or one
   * the agent could not take, is on the turn's `held`.
   */
  inbox?: string
  /** What a message read from the inbox is sent as. Default its text. */
  steered?: (line: Extract<InboxLine, { kind: 'message' }>) => Promise<string>
}

/**
 * A turn that failed: the coding agent's process exited with an error, or exited cleanly after its
 * output said the turn failed (code 0). The message says it all, `<driver> exited (<code>): <reason>`,
 * or `<driver> failed: <reason>` for code 0, for a caller that only prints it; the parts are kept
 * apart for a caller that already showed the reason, from the `error` event sent just before, and
 * wants to say only that the agent exited.
 */
export class AgentExitError extends Error {
  override readonly name = 'AgentExitError'
  constructor(
    /** The driver's id, e.g. `"codex"`. */
    readonly driver: string,
    /** The exit code, `null` when the process was ended by a signal, 0 when it exited cleanly on a failed turn. */
    readonly code: number | null,
    /** What the agent said went wrong: the same text as the `error` event. */
    readonly reason: string,
  ) {
    super(`${code === 0 ? `${driver} failed` : `${driver} exited (${code ?? 'null'})`}: ${reason}`)
  }

  /** The failure without the reason: `<driver> exited (<code>)`, or `<driver> failed`. */
  get exit(): string {
    return this.code === 0 ? `${this.driver} failed` : `${this.driver} exited (${this.code ?? 'null'})`
  }
}

/**
 * Spawn one agent-CLI invocation and resolve with its final turn.
 *
 * Everything here is about the *process*, not the driver: its own process group
 * so an interrupt kills the whole tree rather than orphaning it, a SIGTERM/
 * SIGKILL grace window, abort wiring, and a non-zero exit failing the turn even
 * when text was streamed first. Only {@link RunCliSessionOptions.parser} knows
 * which CLI is on the other end — a second driver gets all of this for free
 * rather than a second copy of it.
 */
export function runCliSession(opts: RunCliSessionOptions): Promise<DriverTurn> {
  return new Promise<DriverTurn>((resolvePromise, rejectPromise) => {
    for (const s of opts.signals) {
      if (s.aborted) {
        rejectPromise(new Error(`${opts.driver} prompt aborted`))
        return
      }
    }

    opts.emit(startEvent(opts.prompt, opts))
    // `detached` makes the child its own process-group leader so we can kill the
    // whole agent subtree (claude + node workers + tool calls) at once, not just
    // the top process — otherwise an interrupt orphans the tree (the leak).
    const child = opts.spawn(opts.bin, opts.args, { cwd: opts.cwd, env: opts.env, detached: true })
    const pid = child.pid
    if (pid != null) registerChild(pid)
    const parser = opts.parser
    const agent = opts.driver
    let settled = false
    let hardKillTimer: ReturnType<typeof setTimeout> | undefined
    // Raw bytes, decoded once at close: a per-chunk `String(chunk)` corrupts a multibyte
    // UTF-8 codepoint split across two chunks, and this text becomes the turn's error detail.
    const stderrChunks: Buffer[] = []

    // Kill the agent's whole process group: SIGTERM to let it flush, then a
    // SIGKILL after a grace window in case it ignores the term (mid tool-call).
    const terminate = () => {
      if (pid != null) killTree(pid, 'SIGTERM')
      else child.kill('SIGTERM')
      hardKillTimer = setTimeout(() => {
        if (pid != null) killTree(pid, 'SIGKILL')
        else child.kill('SIGKILL')
      }, TERMINATE_GRACE_MS)
      hardKillTimer.unref?.()
    }

    // Runs exactly once the process is done with (closed, errored, or killed):
    // stop tracking it and cancel any pending hard-kill.
    const cleanup = () => {
      if (pid != null) unregisterChild(pid)
      if (hardKillTimer) clearTimeout(hardKillTimer)
    }

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      for (const { signal, handler } of aborts) signal.removeEventListener('abort', handler)
      opts.stop?.removeEventListener('abort', onStop)
      if (stopTimer) clearTimeout(stopTimer)
      void reading?.over()
      fn()
    }

    const aborts = opts.signals.map(signal => {
      const handler = () => {
        if (settled) return
        terminate()
        finish(() => rejectPromise(new Error(`${agent} prompt aborted`)))
      }
      signal.addEventListener('abort', handler)
      return { signal, handler }
    })

    // Stop: the agent is asked to end its turn, and its process is ended only when it cannot be
    // asked or does not end it in time.
    let stopTimer: ReturnType<typeof setTimeout> | undefined
    const onStop = () => {
      if (settled) return
      if (parser.stop?.()) {
        stopTimer = setTimeout(terminate, STOP_GRACE_MS)
        stopTimer.unref?.()
        return
      }
      terminate()
      finish(() => rejectPromise(new Error(`${agent} prompt aborted`)))
    }
    opts.stop?.addEventListener('abort', onStop, { once: true })

    const reading = opts.inbox !== undefined && parser.steer ? readInbox(opts.inbox, parser, opts.steered) : undefined

    child.on('error', err => {
      cleanup()
      finish(() => rejectPromise(err))
    })

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', line => {
        for (const event of parser.push(line)) {
          if (event.type === 'steered' && event.id !== undefined) reading?.landed(event.id)
          opts.emit(event)
        }
      })
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer | string) => stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    }

    const closed = (code: number | null, held: PromptLine[]): void => {
      if (settled) return
      const turn: DriverTurn = { ...parser.result(), ...(held.length > 0 ? { held } : {}) }
      const failure = parser.failure?.()
      // A non-zero exit is a failed turn even when the agent streamed some text
      // first: the loop gates on the outcome, so a crash mid-build must not pass
      // as a result; so is a clean exit after output that says the turn failed.
      // Surface the failure the agent reported, else stderr, else (for a crash) the partial text, as context.
      // A turn the driver stopped, on the agent's own question or on the person's Stop, is over:
      // the CLI says its stopped turn failed, and exits so, but nothing went wrong.
      if ((code !== 0 || failure !== undefined) && turn.question === undefined && turn.stopped === undefined) {
        const detail = failure || Buffer.concat(stderrChunks).toString('utf8').trim() || (code === 0 ? 'the turn did not finish' : turn.text.trim() || `exit code ${code ?? 'null'}`)
        opts.emit({ type: 'error', message: detail })
        finish(() => rejectPromise(new AgentExitError(agent, code, detail)))
        return
      }
      opts.emit({
        type: 'result',
        text: turn.text,
        ...(turn.sessionId ? { sessionId: turn.sessionId } : {}),
        ...(turn.usage ? { usage: turn.usage } : {}),
      })
      finish(() => resolvePromise(turn))
    }


    child.on('close', code => {
      cleanup()
      // An abort (or a spawn error) already settled and reported the turn; the process
      // still closes afterward, but its late exit must not emit a second telemetry event.
      if (settled) return
      // A read of the inbox under way finishes first: what it took is held, never dropped.
      if (reading) void reading.over().then(held => closed(code, held))
      else closed(code, [])
    })

    // Feed the prompt over stdin so long prompts never hit arg-length limits.
    const stdin = child.stdin
    if (stdin) {
      // A CLI that exits before reading stdin (bad flag, instant crash) surfaces an async
      // EPIPE on the stream; with no listener that is an uncaught exception in the calling process
      // (#943). The close handler already reports the failed turn, so the error carries
      // nothing the caller needs.
      stdin.on('error', () => {})
      if (parser.converse) {
        let ended = false
        parser.converse({
          write: line => {
            if (!ended) stdin.write(line + '\n')
          },
          end: () => {
            if (ended) return
            ended = true
            stdin.end()
          },
        })
      } else {
        stdin.write(opts.stdin ?? promptSent(opts.prompt, opts))
        stdin.end()
      }
    }
  })
}

/**
 * The inbox read while a turn runs: every few hundred milliseconds what waits there is taken, and
 * each message handed to the agent unless it is for later; a line that takes one back, or hurries
 * the ones handed over, goes to the agent too. What was taken and never reached the agent is held,
 * in the order it came, for the prompts after the turn.
 */
function readInbox(path: string, parser: AgentCliParser, steered: RunCliSessionOptions['steered']) {
  const taken: PromptLine[] = []
  const landed = new Set<string>()
  const cancelled = new Set<string>()
  let reading = Promise.resolve()
  let over = false
  const read = async (): Promise<void> => {
    for (const line of await takeInbox(path)) {
      if (line.kind === 'cancel') {
        cancelled.add(line.id)
        parser.withdraw?.(line.id)
        continue
      }
      if (line.kind === 'now') {
        parser.hurry?.()
        continue
      }
      // Named, so the agent's reading it can be told apart from its other messages.
      const named = line.kind === 'message' && line.id === undefined ? { ...line, id: randomUUID() } : line
      taken.push(named)
      if (named.kind !== 'message' || named.later || over) continue
      const words = steered ? await steered(named) : named.text
      if (!over && !cancelled.has(named.id!)) parser.steer!({ id: named.id!, text: named.text, words })
    }
  }
  const timer = setInterval(() => {
    reading = reading.then(read).catch(() => {})
  }, INBOX_EVERY_MS)
  timer.unref?.()
  return {
    landed: (id: string) => landed.add(id),
    /** Stop reading; resolves, once a read under way is done, with what is held. */
    over: async (): Promise<PromptLine[]> => {
      over = true
      clearInterval(timer)
      await reading
      return taken.filter(line => line.kind === 'answer' || line.id === undefined || (!landed.has(line.id) && !cancelled.has(line.id)))
    },
  }
}
