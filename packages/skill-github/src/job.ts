import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * What this package starts that goes on after the command answered: a shell of its own, which
 * outlives the command and says through three files what it said, which process it is, and how it
 * ended. A later command, a page's next poll, reads how it goes from them.
 */

/** What this package starts that goes on after it answered: the install, and a login waiting for the browser's yes. */
export type Job = 'install' | 'login'

/** Where a job keeps what it said, which process it is, and how it ended. */
export interface JobFiles {
  log: string
  pid: string
  exit: string
}

export function jobFiles(job: Job, env: NodeJS.ProcessEnv = process.env): JobFiles {
  const dir = join(env['TMPDIR'] ?? tmpdir(), `openagent-github-${process.getuid?.() ?? 'user'}`)
  return { log: join(dir, `${job}.log`), pid: join(dir, `${job}.pid`), exit: join(dir, `${job}.exit`) }
}

/** How a job is: going on, or ended, with its last lines when it failed; nothing when none was started. */
export type JobState = { running: true; said: string } | { running: false; failed?: string; said: string }

export function jobState(files: JobFiles): JobState | undefined {
  const read = (path: string): string | undefined => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  }
  const said = read(files.log)
  if (said === undefined) return undefined
  const exit = read(files.exit)?.trim()
  if (exit === undefined || exit === '') {
    const pid = Number(read(files.pid)?.trim())
    let alive = false
    try {
      if (pid) alive = process.kill(pid, 0)
    } catch {
      alive = false
    }
    // A process gone with no end written was ended from outside: it failed.
    return alive ? { running: true, said } : { running: false, failed: lastLines(said) || 'it was stopped', said }
  }
  return exit === '0' ? { running: false, said } : { running: false, failed: lastLines(said) || `it ended with ${exit}`, said }
}

/** The last few lines a job said: what a failure is told with. */
export function lastLines(said: string): string {
  return said.trim().split('\n').slice(-3).join('\n')
}

/**
 * Start `script` in a shell of its own, which goes on after this process ends, writing what it
 * says to the job's log itself (a pipe would end with this process) and how it ended after.
 * `args` are its `$1`, `$2`….
 */
export async function startJob(files: JobFiles, script: string, args: readonly string[] = []): Promise<void> {
  mkdirSync(dirname(files.log), { recursive: true })
  writeFileSync(files.log, '')
  rmSync(files.exit, { force: true })
  const child = spawn('sh', ['-c', `log=$1; ended=$2; shift 2; exec >>"$log" 2>&1; (${script}); echo $? >"$ended"`, 'sh', files.log, files.exit, ...args], { detached: true, stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
  writeFileSync(files.pid, String(child.pid))
}

/** Stop a job's shell, and all it started. */
export function stopJob(files: JobFiles): void {
  try {
    process.kill(-Number(readFileSync(files.pid, 'utf8').trim()), 'SIGTERM')
  } catch {
    // Gone already.
  }
}
