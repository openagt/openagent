import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import { errorMessage } from '@openagt/agent-data'
import { configFile, readConfig } from './config.js'

/**
 * The line a person wrote to run when a run needs them: `ended:` in the project's
 * `.agent-runner/config.yml`, on this machine only, hidden from git with the rest of the
 * directory. It runs when a run ends waiting on a question, and when a run ends done with a pull
 * request its branch did not have before; never on any other end. The line is a shell line of
 * the person's: this tool names no service it posts to.
 *
 * It runs in the project's root with the run's facts in its environment (`MESSAGE`, one line for
 * a person; `RUN_ID`, `STATUS`, `QUESTION`, `PR_URL`), after the run's record is written. What it
 * prints and how it exits never change the run: a failure is one line on this process's stderr.
 */

/** How long the line may take before it is ended. */
export const ENDED_TIMEOUT_MS = 60_000

/** A run's end as the line is run for it: which run, what it was asked, and how it ended. */
interface RunEnd {
  id: string
  prompt: string
  status: string
  question?: string
  pr?: { url: string }
  /** The pull request the run had when this session started. */
  prBefore?: { url: string }
}

interface EndedDeps {
  log: (line: string) => void
  timeoutMs?: number
}

/** Why a run's end is worth a person's attention, or nothing when it is not. */
export type EndedNews = { status: 'waiting'; question: string; pr?: { url: string } } | { status: 'done'; pr: { url: string } }

/**
 * Whether a run's end is one the line runs for: it ended waiting, or it ended done with a pull
 * request it did not have when this session started. A failed or stopped run is left to whoever
 * is looking at the runs.
 */
export function endedNews(end: Pick<RunEnd, 'status' | 'question' | 'pr' | 'prBefore'>): EndedNews | undefined {
  const newPr = end.pr && end.pr.url !== end.prBefore?.url ? { pr: { url: end.pr.url } } : {}
  if (end.status === 'waiting') return { status: 'waiting', question: end.question ?? 'a question', ...newPr }
  if (end.status === 'done' && newPr.pr) return { status: 'done', pr: newPr.pr }
  return undefined
}

/** The prompt as a message names it: its first line, cut short. */
function promptLabel(prompt: string): string {
  const first = prompt.trim().split('\n')[0] ?? ''
  return first.length > 80 ? `${first.slice(0, 79)}…` : first
}

/** The one line for a person: the project, the run's prompt, and what it needs or did. */
export function endedMessage(project: string, prompt: string, news: EndedNews): string {
  const head = `${project}: "${promptLabel(prompt)}"`
  if (news.status === 'waiting') return `${head} is waiting for you: ${news.question.replace(/\s+/g, ' ').trim()}${news.pr ? ` (pull request: ${news.pr.url})` : ''}`
  return `${head} opened a pull request: ${news.pr.url}`
}

/** The `ended:` line of this machine, or none. A file that cannot be read is said on `log`. */
export async function readEndedLine(repo: string, log: (line: string) => void): Promise<string | undefined> {
  const value = (await readConfig(repo, log))['ended']
  if (value !== undefined && value !== null && typeof value !== 'string') log(`[agent-runner] ${configFile(repo)}: \`ended\` is not a string`)
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Run the `ended:` line for a run's end when it is news, and wait for it (bounded): the run's
 * process should not exit while the line posts. Nothing when there is no line or no news. Never
 * throws: whatever goes wrong is one line on `log`, and the run ends as it ended.
 */
export async function runEndedLine(repo: string, end: RunEnd, deps: EndedDeps): Promise<void> {
  try {
    await runLine(repo, end, deps)
  } catch (err) {
    deps.log(`[agent-runner] the ended line could not run: ${errorMessage(err)}`)
  }
}

async function runLine(repo: string, end: RunEnd, deps: EndedDeps): Promise<void> {
  const news = endedNews(end)
  if (!news) return
  const line = await readEndedLine(repo, deps.log)
  if (!line) return
  const env = {
    ...process.env,
    MESSAGE: endedMessage(basename(repo), end.prompt, news),
    RUN_ID: end.id,
    STATUS: news.status,
    QUESTION: news.status === 'waiting' ? news.question : '',
    PR_URL: news.pr?.url ?? '',
  }
  // Its own process group, so the time limit ends whatever the line started (`npx` and its node),
  // and the wait is for the line's exit, not for a pipe a leftover child still holds. Once the
  // shell has exited, what it left running in the background is its own.
  const limit = deps.timeoutMs ?? ENDED_TIMEOUT_MS
  await new Promise<void>(resolve => {
    // Only the last line is said: the tail is kept, bounded.
    let stderr = ''
    let timedOut = false
    const child = spawn('sh', ['-c', line], { cwd: repo, env, stdio: ['ignore', 'ignore', 'pipe'], detached: true })
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }, limit)
    child.stderr.on('data', chunk => (stderr = (stderr + chunk).slice(-4096)))
    child.on('error', err => {
      clearTimeout(timer)
      deps.log(`[agent-runner] the ended line could not start: ${err.message}`)
      resolve()
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      child.stderr.destroy()
      if (timedOut) deps.log(`[agent-runner] the ended line took longer than ${limit >= 1000 ? `${Math.round(limit / 1000)}s` : `${limit}ms`} and was ended`)
      else if (signal) deps.log(`[agent-runner] the ended line was ended by ${signal}`)
      else if (code !== 0) deps.log(`[agent-runner] the ended line exited ${code}${stderr.trim() ? `: ${stderr.trim().split('\n').slice(-1)[0]}` : ''}`)
      resolve()
    })
  })
}
