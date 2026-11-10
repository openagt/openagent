import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { excludeFromGit } from '@openagt/agent-data'
import { RUNNER_DIR, RUNS_DIR } from './names.js'

/**
 * One process per run at a time (#1774). A run's process holds its run's lock from before it
 * touches the record until it has let the checkout go. A second process for the same run waits
 * until the holder is gone: a resume that comes while the run still records and reclaims, or two
 * resumes started together by two messages. The sweep leaves a run alone while its lock is held.
 *
 * The lock is a file under the tool's directory holding the pid of its holder. A pid that is not
 * alive holds nothing, so a process that died leaves no lock that matters. Per machine, like the
 * pid in it. Two waiters taking over a dead holder's lock in the same instant can both believe
 * they hold it; a holder that dies is already the sweep's case.
 */

/** Whether `pid` is a live process on this host. A pid on another host is unknowable here. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as { code?: string }).code === 'EPERM'
  }
}

/** How often a waiting process looks at the lock again. */
const POLL_MS = 500

export function runLockPath(repo: string, id: string): string {
  return join(repo, RUNNER_DIR, RUNS_DIR, `${id}.lock`)
}

/** Where a spawned run's stderr lands, so a run that dies before writing anything leaves a trace. */
export function runStderrPath(repo: string, id: string): string {
  return join(repo, RUNNER_DIR, RUNS_DIR, `${id}.stderr`)
}

async function readHolder(repo: string, id: string): Promise<number | undefined> {
  const raw = await readFile(runLockPath(repo, id), 'utf8').catch(() => undefined)
  const pid = Number(raw?.trim())
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

/** The live pid holding the run's lock, or `undefined` when none does. */
export async function lockHolder(repo: string, id: string, isAlive: (pid: number) => boolean): Promise<number | undefined> {
  const pid = await readHolder(repo, id)
  return pid !== undefined && isAlive(pid) ? pid : undefined
}

/** Take the run's lock for `pid`, waiting while another live process holds it. A lock already naming `pid` is its own. */
export async function acquireRunLock(
  repo: string,
  id: string,
  opts: { pid: number; isAlive: (pid: number) => boolean; pollMs?: number },
): Promise<void> {
  const path = runLockPath(repo, id)
  await mkdir(dirname(path), { recursive: true })
  // Hidden from git: the tool's directory must not dirty the tree.
  await excludeFromGit(repo, `/${RUNNER_DIR}`).catch(() => {})
  for (;;) {
    try {
      await writeFile(path, `${opts.pid}\n`, { flag: 'wx' })
      return
    } catch (err) {
      if ((err as { code?: string }).code !== 'EEXIST') throw err
    }
    const holder = await readHolder(repo, id)
    if (holder === opts.pid) return
    if (holder === undefined || !opts.isAlive(holder)) {
      await rm(path, { force: true })
      continue
    }
    await new Promise(resolve => setTimeout(resolve, opts.pollMs ?? POLL_MS))
  }
}

/**
 * Do `work` holding the run's lock for `holder.pid`, waiting first while another live process
 * holds it, and let the lock go once `work` has settled, however it settled. Let go any earlier,
 * a process of the run would still be at work with no lock, and the sweep would take the run.
 */
export async function withRunLock<T>(repo: string, id: string, holder: { pid: number; isAlive: (pid: number) => boolean }, work: () => Promise<T>): Promise<T> {
  await acquireRunLock(repo, id, holder)
  try {
    return await work()
  } finally {
    await releaseRunLock(repo, id, holder.pid).catch(() => {})
  }
}

/** Hand the lock `from` holds to the process `to`: a detached run's parent to the run's own process. */
export async function handOverRunLock(repo: string, id: string, from: number, to: number): Promise<void> {
  if ((await readHolder(repo, id)) === from) await writeFile(runLockPath(repo, id), `${to}\n`)
}

/** Let the lock go, when `pid` holds it. */
export async function releaseRunLock(repo: string, id: string, pid: number): Promise<void> {
  if ((await readHolder(repo, id)) === pid) await rm(runLockPath(repo, id), { force: true })
}
