import { spawn } from 'node:child_process'
import type { RunOutcome } from '@openagt/hooks'

/**
 * The person's command, run when a run needs them: when it ends waiting on a question, and when it
 * ends done with a pull request it did not have when this leg of it started; never on any other
 * end. It is a shell line of the person's: this package names no service it posts to.
 *
 * It runs in the project's folder (a session with no project: the person's home folder) with the
 * run's facts in its environment (`MESSAGE`, one line for a person; `RUN_ID`, `STATUS`, `QUESTION`,
 * `PR_URL`), after the run's record is written. What it prints and how it exits never change the
 * run: a failure is said on the run's log.
 */

/** How long the command may take before it is ended. */
export const COMMAND_TIMEOUT_MS = 60_000

/** A run's end, as the news is read from it: how it ended, and its pull request. */
export interface RunEnd {
  outcome: RunOutcome
  pr?: { url: string }
  /** The pull request the run had when this leg of it started. */
  prBefore?: { url: string }
}

/** Why a run's end is worth a person's attention. */
export type News = { status: 'waiting'; question: string; pr?: { url: string } } | { status: 'done'; pr: { url: string } }

/**
 * Whether a run's end is one the command runs for: it ended waiting, or it ended done with a pull
 * request it did not have when this leg started. A failed or stopped run is left to whoever is
 * looking at the runs.
 */
export function newsOf({ outcome, pr, prBefore }: RunEnd): News | undefined {
  const newPr = pr && pr.url !== prBefore?.url ? { pr: { url: pr.url } } : {}
  if (outcome.status === 'waiting') return { status: 'waiting', question: outcome.question, ...newPr }
  if (outcome.status === 'done' && newPr.pr) return { status: 'done', pr: newPr.pr }
  return undefined
}

/** The prompt as a message names it: its first line, cut short. */
function promptLabel(prompt: string): string {
  const first = prompt.trim().split('\n')[0] ?? ''
  return first.length > 80 ? `${first.slice(0, 79)}…` : first
}

/** The one line for a person: the project, the run's prompt, and what it needs or did. */
export function messageOf(project: string, prompt: string, news: News): string {
  const head = `${project}: "${promptLabel(prompt)}"`
  if (news.status === 'waiting') return `${head} is waiting for you: ${news.question.replace(/\s+/g, ' ').trim()}${news.pr ? ` (pull request: ${news.pr.url})` : ''}`
  return `${head} opened a pull request: ${news.pr.url}`
}

/** The run the command is run for, and what it is news of. */
export interface Notified {
  id: string
  /** The project's name, as the message names it. */
  project: string
  prompt: string
  news: News
}

/**
 * Run the person's command `line` in `cwd` for a run's news, and wait for it, bounded: the run's
 * process should not exit while the command posts. Throws why it failed, ran too long or could not
 * start, in words for the run's log.
 */
export async function runCommandFor(line: string, cwd: string, run: Notified, timeoutMs = COMMAND_TIMEOUT_MS): Promise<void> {
  const { news } = run
  const env = {
    ...process.env,
    MESSAGE: messageOf(run.project, run.prompt, news),
    RUN_ID: run.id,
    STATUS: news.status,
    QUESTION: news.status === 'waiting' ? news.question : '',
    PR_URL: news.pr?.url ?? '',
  }
  // Its own process group, so the time limit ends whatever the command started (`npx` and its node),
  // and the wait is for the command's exit, not for a pipe a leftover child still holds. Once the
  // shell has exited, what it left running in the background is its own.
  await new Promise<void>((resolve, reject) => {
    // Only the last line is said: the tail is kept, bounded.
    let stderr = ''
    let timedOut = false
    const child = spawn('sh', ['-c', line], { cwd, env, stdio: ['ignore', 'ignore', 'pipe'], detached: true })
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }, timeoutMs)
    child.stderr.on('data', chunk => (stderr = (stderr + chunk).slice(-4096)))
    child.on('error', err => {
      clearTimeout(timer)
      reject(new Error(`it could not start: ${err.message}`))
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      child.stderr.destroy()
      if (timedOut) reject(new Error(`it took longer than ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`} and was ended`))
      else if (signal) reject(new Error(`it was ended by ${signal}`))
      else if (code !== 0) reject(new Error(`it exited ${code}${stderr.trim() ? `: ${stderr.trim().split('\n').slice(-1)[0]}` : ''}`))
      else resolve()
    })
  })
}
