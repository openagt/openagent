import { watch, type FSWatcher } from 'node:fs'
import { open } from 'node:fs/promises'

/**
 * Tails an append-only JSONL log, calling `onLine` for each complete line as it
 * is written. Reads only the bytes appended since the last {@link pull},
 * buffering a torn trailing line until its newline arrives. A file that shrinks
 * (a fresh agent truncated the log) resets to the start so the new content is
 * picked up. The generic base behind the daemon's event tail and the agent's
 * control tail (#344) — one tailer, two directions.
 */
export class JsonlTailer<T> {
  private offset = 0
  private partial = ''
  private lastMtimeMs = 0
  private adoptMtime = false

  constructor(
    private path: string,
    private readonly onLine: (value: T) => void,
    /** Told when the log is found rewritten, before its lines are read again from the top. */
    private readonly onReset?: () => void,
  ) {}

  /**
   * Point the tailer at the log's new home, keeping the read offset. For a log that is
   * *relocated with its content intact* — a run's diary is copied verbatim onto the data branch
   * when the run ends and its checkout is reclaimed — the bytes already consumed are a prefix of
   * the new file, so the next {@link pull} delivers exactly the lines the move would otherwise
   * have swallowed, without replaying what was already delivered.
   *
   * The first pull after a retarget adopts the new home's mtime instead of running the
   * same-length-rewrite check: the copy is younger than the original by construction, and a
   * fully-consumed log would otherwise read as "rewritten to the same length" and replay
   * every line it already delivered.
   */
  retarget(path: string): void {
    this.path = path
    this.adoptMtime = true
  }

  /** Read and dispatch any lines appended since the previous call. */
  async pull(): Promise<void> {
    let fd
    try {
      fd = await open(this.path, 'r')
    } catch {
      return // not created yet (nothing has written)
    }
    try {
      const { size, mtimeMs } = await fd.stat()
      // A fresh agent truncates the log in place (same inode). Detect it two ways: the
      // file shrank below what we consumed, or it was rewritten to the same length
      // (size unchanged but mtime advanced). Either way, re-read from the top.
      // Suspended for the first read after a retarget, whose newer mtime is the copy's, not a rewrite's.
      const rewritten = !this.adoptMtime && size === this.offset && this.offset > 0 && mtimeMs > this.lastMtimeMs
      if (size < this.offset || rewritten) {
        this.offset = 0
        this.partial = ''
        this.onReset?.()
      }
      this.lastMtimeMs = mtimeMs
      this.adoptMtime = false
      if (size === this.offset) return
      const buf = Buffer.alloc(size - this.offset)
      await fd.read(buf, 0, buf.length, this.offset)
      this.offset = size
      this.partial += buf.toString('utf8')
      const lines = this.partial.split('\n')
      this.partial = lines.pop() ?? '' // trailing fragment with no newline yet
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          this.onLine(JSON.parse(trimmed) as T)
        } catch {
          // a torn/half-written line — skip it; the log never rewrites history
        }
      }
    } finally {
      await fd.close()
    }
  }
}

/** Options for {@link followFile}. */
export interface FollowFileOptions {
  /** How often the backstop poll runs. */
  pollMs: number
  /**
   * Let the process exit with the tail still running (steering must never hold it open).
   * Covers both handles this opens — the poll timer *and* the `fs.watch` — since either one
   * on its own is enough to keep the event loop alive.
   */
  unref?: boolean
}

/**
 * Drive a {@link JsonlTailer} as the file grows: an `fs.watch` on `dir` for latency, plus a
 * poll backstop because `fs.watch` is unreliable across platforms. Pulls are serialized (a
 * pull already in flight swallows the next trigger) and stop for good once the returned
 * function is called. Shared by the agent's control tail and the dashboard's event tail, which
 * hand-rolled this separately and drifted apart.
 *
 * Nothing here may throw at the process: a failed pull and a watcher error are both survivable,
 * and the poll alone is a complete tail (#996).
 */
export function followFile(dir: string, pull: () => Promise<void>, opts: FollowFileOptions): () => void {
  let pulling = false
  let stopped = false
  const pump = async (): Promise<void> => {
    if (pulling || stopped) return
    pulling = true
    try {
      await pull()
    } catch {
      // #996: every caller discards this promise, so a rejected read (EIO on a network mount,
      // EISDIR, a log grown past kMaxLength) would be an unhandled rejection and kill the
      // process. Swallowed rather than logged: the next tick retries, and a fault that persists
      // would otherwise print once per poll forever.
    } finally {
      pulling = false
    }
  }

  let watcher: FSWatcher | undefined
  try {
    watcher = watch(dir, () => void pump())
    // #996: an 'error' with no listener throws out of the emitter, which is the same process
    // death. The watcher is spent once it errors (node closes the handle first), so drop it and
    // let the poll below carry the tail on its own.
    watcher.on('error', () => {
      watcher?.close()
      watcher = undefined
    })
    // Unref the watcher, not just the poll below: an `fs.watch` handle refs the event loop on
    // its own, so unrefing only the timer left `unref: true` a half-measure that still pinned the
    // process open. That is what wedged an agent whose config check failed before its watcher had an
    // owner to close it — the CLI returned, and the process then sat there forever with the agent
    // recorded as `running`.
    if (opts.unref) watcher?.unref()
  } catch {
    // dir may not be watchable everywhere; the poll backstop still covers it
  }
  const poll = setInterval(() => void pump(), opts.pollMs)
  if (opts.unref) poll.unref()
  void pump() // seed with whatever is already written

  return () => {
    stopped = true
    clearInterval(poll)
    watcher?.close()
    watcher = undefined
  }
}
