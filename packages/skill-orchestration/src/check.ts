import { execFile } from 'node:child_process'

/**
 * Running a check: the `Check:` line of a task, and the plan's own, which `land` runs in the main
 * agent's checkout once the work is merged there. A check is a line a person wrote in the plan, so
 * it is run the way the scheduler runs the one in a command's skill: through `sh`, in the checkout,
 * bounded in time, with nothing to type to it.
 */

/** What a check said: everything it printed, and how it exited. */
export interface Ran {
  /** The exit code; 0 when the check passed. */
  code: number
  /** What it printed, its standard output then its standard error. */
  output: string
}

/** How long a check may run: a project's build and tests, not a quick question. */
export const CHECK_TIMEOUT_MS = 10 * 60_000

/** How much a check may print before the rest is dropped, and how much of it a refusal carries. */
export const CHECK_MAX_BUFFER = 4 * 1024 * 1024
export const CHECK_MAX_OUTPUT = 8_000

/**
 * What a refusal carries of a check's output: its last {@link CHECK_MAX_OUTPUT} characters, since a
 * command stops at what went wrong and the reason is at the end. `cut` says something was dropped,
 * so the agent knows to run the check itself for the rest.
 */
export function cutOutput(output: string): { output: string; cut?: true } {
  const text = output.trimEnd()
  if (text.length <= CHECK_MAX_OUTPUT) return { output: text }
  return { output: text.slice(-CHECK_MAX_OUTPUT), cut: true }
}

/** Run one check in `cwd`: standard output and standard error together, and the exit code. */
export function runCommand(command: string, cwd: string): Promise<Ran> {
  return new Promise<Ran>(resolve => {
    const child = execFile('sh', ['-c', command], { cwd, timeout: CHECK_TIMEOUT_MS, maxBuffer: CHECK_MAX_BUFFER, encoding: 'utf8' }, (err, stdout, stderr) => {
      const printed = [String(stdout), String(stderr)].filter(part => part.trim() !== '').join('\n')
      // A check killed for running out of its time printed nothing about why it failed: say it.
      const why = err?.killed ? `the check was stopped after ${CHECK_TIMEOUT_MS / 1000} seconds` : err && printed.trim() === '' ? err.message : ''
      const code = err === null ? 0 : typeof err.code === 'number' ? err.code : 1
      resolve({ code, output: [printed, why].filter(Boolean).join('\n') })
    })
    // Nobody types to a check: one that reads its input finds it at its end at once.
    child.stdin?.end()
  })
}
