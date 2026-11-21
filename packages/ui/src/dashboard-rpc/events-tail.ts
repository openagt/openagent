import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { logLiveFile } from '@openagt/agent-driver'
import { JsonlTailer, followFile } from '../jsonl-tail.js'

/** How often the poll backstop re-reads the log when `fs.watch` says nothing. */
const POLL_MS = 1000

/**
 * Tail a JSONL log: read what is already in it, then follow appends. Each complete line is
 * parsed and handed to `onEvent`; malformed lines are skipped. Returns a stop function that
 * removes the watcher and the poll.
 *
 * The reading is {@link JsonlTailer} and the following is {@link followFile}. This used to be
 * its own copy of both, which is how it ended up missing the tailer's same-length-rewrite
 * detection (#567).
 *
 * `onReplayed` is told once the first pull — the replay of everything already logged — has
 * been delivered (#1383). That boundary is what lets a reconnecting client buffer the replay
 * and swap its feed atomically instead of blanking while history re-streams. The follower
 * only starts after it, so no appended line can slip in ahead of the marker. Best-effort on
 * a failed first read: the marker still fires (the poll retries the read), because a client
 * waiting on it forever would freeze its feed.
 *
 * Kept transport-agnostic (a plain `onEvent` callback, not a stream) so the file
 * side can be driven on its own; `events.ts` wires it to the SSE endpoint.
 */
export function tailEvents<T = unknown>(path: string, onEvent: (event: T) => void, onReplayed?: () => void): () => void {
  const tailer = new JsonlTailer<T>(path, onEvent)
  let stopped = false
  let stopFollow: (() => void) | undefined
  const follow = (): void => {
    if (stopped) return
    onReplayed?.()
    stopFollow = followFile(dirname(path), () => tailer.pull(), { pollMs: POLL_MS })
  }
  void tailer.pull().then(follow, follow)
  return () => {
    stopped = true
    stopFollow?.()
  }
}

/**
 * Reads the message a run is writing, from the live file beside its diary, for
 * {@link tailAgentEvents}' `afterPull`: the file changes in the diary's directory, so the diary's
 * watch reads it too. `send` gets the text when it changed, and `''` once the file is gone.
 */
export function partialReader(send: (text: string) => void): (diary: string) => Promise<void> {
  let sent = ''
  return async diary => {
    const text = await readFile(join(dirname(diary), logLiveFile(basename(diary, '.jsonl'))), 'utf8').catch(() => '')
    if (text === sent) return
    sent = text
    send(text)
  }
}

/** Where a relocating tail reads now: a file it follows, a finished run's lines, whole, or nowhere yet (`pending`: ask again shortly). */
export type TailTarget<T> = { file: string } | { finished: T[] } | { pending: true }

/** Whether the file at `path` holds at least one byte; a file that cannot be read holds nothing. */
function holdsSomething(path: string): boolean {
  try {
    return statSync(path).size > 0
  } catch {
    return false
  }
}

/**
 * Tail a run's diary across its relocations: the same read-then-follow as {@link tailEvents},
 * but where the diary is is asked again whenever the tailed file is not there.
 *
 * A run's diary does not sit still. While the run works it is a file in the run's checkout; when
 * the run ends its tool records it and reclaims the checkout, and from then on the diary is the
 * finished run's, read whole from the project's runs provider. A fixed-path tail whose file was
 * retired went silent *without the final lines* whenever the last `fs.watch` signal was lost —
 * the 1s poll then found the file gone and had nothing to read, so the feed never learned the run
 * ended. This tail treats a missing file as the question it is: it asks `resolve` where the diary
 * is now (`resolveAgentDiary` answers the finished run once the checkout is gone, #1472). A new
 * file retargets the same tailer and follows it. A finished run's lines are the same lines the
 * file had, in the same order, so the ones past the count already delivered are sent and the tail
 * ends: a finished diary does not grow. The same file, or no answer, means the diary has not
 * moved, and the tail keeps waiting where it is. A diary that is nowhere yet (`pending`: the run
 * was started a moment ago and its tool has not made the checkout, or it is being continued and
 * its checkout is on its way back) is asked for again on the same cadence until it has a home,
 * and only then followed; the replay boundary is reported once what that home holds has been
 * delivered, not before: a feed that reconnects swaps what it shows for the replay at the
 * boundary, and a boundary reported with nothing delivered emptied a chat that was full, for as
 * long as the diary took to have a home. Asking even when the file was never seen matters for a
 * short run (#1774): started, ended and reclaimed between two polls, its diary was only ever
 * visible as a finished run.
 *
 * `onReplayed` keeps {@link tailEvents}' once-per-subscription contract: a relocation is not a
 * new replay boundary, so it never fires twice.
 *
 * `afterPull` is told the diary's path after each read of it: the files beside the diary change
 * with it, and a caller reads them there, on the same watch.
 */
export function tailAgentEvents<T = unknown>(
  resolve: (opts?: { cached?: boolean }) => Promise<TailTarget<T> | undefined>,
  onEvent: (event: T) => void,
  onReplayed?: () => void,
  afterPull?: (diary: string) => Promise<void>,
): () => void {
  let stopped = false
  let stopFollow: (() => void) | undefined
  let path: string | undefined
  let tailer: JsonlTailer<T> | undefined
  let relocating = false
  let waiting: NodeJS.Timeout | undefined
  let delivered = 0
  /** The replay boundary still to report: the followed file was not there when it was first read. */
  let owed: (() => void) | undefined
  const deliver = (event: T): void => {
    delivered++
    onEvent(event)
  }
  /** The finished run's lines the feed has not had yet; then wait for the run to be resumed. */
  const finish = (lines: T[]): void => {
    stopFollow?.()
    stopFollow = undefined
    for (const line of lines.slice(delivered)) deliver(line)
    // A boundary owed for a file that never came: the finished run's lines are the replay.
    const boundary = owed
    owed = undefined
    boundary?.()
    awaitDiary(true)
  }

  const follow = (): void => {
    if (stopped || path === undefined) return
    stopFollow = followFile(dirname(path), pullOrRelocate, { pollMs: POLL_MS })
  }

  const relocate = async (): Promise<void> => {
    const next = await resolve()
    // No answer, nowhere yet, or the same file: not moved (or not visible yet) — keep polling the current home.
    if (stopped || !tailer || next === undefined || 'pending' in next) return
    if ('finished' in next) return finish(next.finished)
    if (next.file === path) return
    stopFollow?.()
    path = next.file
    tailer.retarget(next.file)
    await tailer.pull()
    follow()
  }

  const pullOrRelocate = async (): Promise<void> => {
    if (stopped || !tailer || path === undefined) return
    if (existsSync(path)) {
      // A file that is there and still holds nothing is a diary about to be written: the owed
      // boundary waits for the pull that had lines to deliver, or it would say an empty replay.
      const written = owed !== undefined && holdsSomething(path)
      await tailer.pull()
      if (written) {
        const boundary = owed
        owed = undefined
        boundary?.()
      }
      await afterPull?.(path)
      return
    }
    if (relocating) return
    relocating = true
    try {
      await relocate()
    } finally {
      relocating = false
    }
  }

  /**
   * Follow `file` from its start: what is there is the replay, and appends follow. A resumed run's
   * diary starts with the lines the feed already had, so as many lines as were delivered are skipped.
   * The same holds when the file is rewritten in place: a run continued in the checkout it kept
   * has its diary written again, whole, before the new lines, and the tailer reads a rewritten
   * file from its top. It is one run's diary either way, so what was delivered is skipped again.
   */
  const begin = (file: string, onReplayedOnce: () => void): void => {
    path = file
    let skip = delivered
    tailer = new JsonlTailer<T>(
      file,
      line => {
        if (skip > 0) skip--
        else deliver(line)
      },
      () => {
        skip = delivered
      },
    )
    // The boundary is reported once the file has been read. A checkout is there a moment before
    // the diary is written into it, and the diary is there a moment before its first lines:
    // reported then, the boundary would say an empty replay. So it is reported only when the
    // file held something before the read, and owed until a later read finds it written.
    const written = holdsSomething(file)
    const replayed = (): void => {
      if (stopped) return
      if (written) onReplayedOnce()
      else owed = onReplayedOnce
      follow()
    }
    void tailer.pull().then(replayed, replayed)
  }

  /**
   * The diary is nowhere yet, or is a finished run's: ask again after a poll, until it has a home.
   * A finished run is asked about for as long as the feed is open, since it may be resumed: its diary
   * is then a file in a checkout again, or, for a resumed run that already ended again, more
   * finished lines. `replayed` is the boundary still owed, when the diary had no home at first:
   * it is reported once the home's lines are delivered.
   */
  const awaitDiary = (finished: boolean, replayed: () => void = () => {}): void => {
    if (stopped) return
    waiting = setTimeout(() => {
      waiting = undefined
      // A finished run is asked about from the shared, cached reads: the question may stay open for hours.
      void resolve({ cached: finished }).then(
        next => {
          if (stopped) return
          if (next === undefined || 'pending' in next) return awaitDiary(finished, replayed)
          if ('finished' in next) {
            finish(next.finished)
            replayed()
            return
          }
          begin(next.file, replayed)
        },
        () => awaitDiary(finished, replayed),
      )
    }, POLL_MS)
    waiting.unref?.()
  }

  void resolve().then(
    initial => {
      if (stopped) return
      // No journal to speak of (unknown project): honor the replay contract and stay silent.
      if (initial === undefined) {
        onReplayed?.()
        return
      }
      if ('finished' in initial) {
        finish(initial.finished)
        onReplayed?.()
        return
      }
      if ('pending' in initial) {
        awaitDiary(false, () => onReplayed?.())
        return
      }
      begin(initial.file, () => onReplayed?.())
    },
    () => onReplayed?.(),
  )

  return () => {
    stopped = true
    if (waiting) clearTimeout(waiting)
    stopFollow?.()
  }
}
