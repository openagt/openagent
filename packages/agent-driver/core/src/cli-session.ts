import { createInterface } from 'node:readline'
import { killTree, registerChild, unregisterChild } from './child-registry.js'
import type { DriverEvent, DriverTurn } from './types.js'
import { promptSent, startEvent } from './session-support.js'

// The agent-agnostic core for running one wrapped coding-agent CLI: spawn it in its own
// process group, stream its output through a parser, and gate the turn on its exit. Each
// concrete driver (claude-code, codex) supplies the argv and an AgentCliParser for its own
// output dialect; everything about the *process* lives here, so a second driver reuses it
// rather than reaching into the first driver's file for it.

/** Grace between SIGTERM and the SIGKILL that forces a hung agent tree down. */
const TERMINATE_GRACE_MS = 5000

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
 * dialect ({@link StreamJsonParser} for Claude Code, `CodexJsonParser` for
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

    child.on('error', err => {
      cleanup()
      finish(() => rejectPromise(err))
    })

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', line => {
        for (const event of parser.push(line)) opts.emit(event)
      })
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer | string) => stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    }

    child.on('close', code => {
      cleanup()
      // An abort (or a spawn error) already settled and reported the turn; the process
      // still closes afterward, but its late exit must not emit a second telemetry event.
      if (settled) return
      const turn = parser.result()
      const failure = parser.failure?.()
      // A non-zero exit is a failed turn even when the agent streamed some text
      // first: the loop gates on the outcome, so a crash mid-build must not pass
      // as a result; so is a clean exit after output that says the turn failed.
      // Surface the failure the agent reported, else stderr, else (for a crash) the partial text, as context.
      // A turn the driver stopped on the agent's own question asked it and is over: the CLI says
      // its stopped turn failed, and exits so, but nothing went wrong.
      if ((code !== 0 || failure !== undefined) && turn.question === undefined) {
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
