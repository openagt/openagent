/**
 * This process, as the package's commands use it: whether another one runs, what it was handed on
 * standard input, and work that runs until it is told to stop.
 */

/** Whether a process with this id is running. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** All of the process's standard input, as text. */
export async function ownStdin(): Promise<string> {
  let said = ''
  for await (const chunk of process.stdin.setEncoding('utf8')) said += chunk
  return said
}

/**
 * Run `work` until it ends, or until it is told to stop: by `signal` when one is given (a test's),
 * else by SIGINT or SIGTERM, and `withParent`, also by the end of the process that started this one,
 * which may die without a word. Whatever ended it, nothing of it is left to keep the process alive.
 */
export async function untilStopped(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<void>, { withParent = false } = {}): Promise<void> {
  const controller = new AbortController()
  const stop = (): void => controller.abort()
  let watch: NodeJS.Timeout | undefined
  if (signal) signal.addEventListener('abort', stop, { once: true })
  else {
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    if (withParent) {
      const parent = process.ppid
      watch = setInterval(() => {
        if (process.ppid !== parent) stop()
      }, 2_000)
    }
  }
  try {
    if (signal?.aborted) stop()
    await work(controller.signal)
  } finally {
    clearInterval(watch)
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}
