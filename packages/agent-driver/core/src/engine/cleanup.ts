import { lstat, readdir, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeGitRunner, repositoryCheckouts, unexcludeFromGit, type GitRunner } from '@openagt/agent-data'
import { RUNNER_CONFIG, RUNNER_DIR, RUNS_DIR } from './names.js'
import { isPidAlive, lockHolder } from './run-lock.js'

/**
 * `cleanup`: what this tool left in a project, removed, for a person who takes the project out of
 * a dashboard and asks for the tool's files to go too. The tool removes its own and nothing else:
 * a dashboard asks for it by the `cleanup` kind the package declares under `openagent` in its
 * package.json, and holds no list of this tool's files.
 *
 * What goes is the runs' locks and stderr files, one by one, and then the directories they left
 * empty. The settings file is the person's own writing and stays, and so does anything else
 * found there, each named with the reason. A file git tracks is never removed. The rule that
 * hides the directory from git goes only when this pass removed the directory and no other
 * checkout of the repository holds one: every checkout reads the same exclude file. While a
 * run's process is alive nothing is removed at all: its lock is what keeps a second process off
 * the run.
 */

/** One thing left where it was, by its path from the project's root, and why. */
export interface Kept {
  path: string
  reason: string
}

export type CleanupOutcome =
  | { ok: true; removed: string[]; kept: Kept[] }
  /** Runs whose process is alive on this machine: stop them first. */
  | { ok: false; reason: 'running'; runs: string[] }

export interface CleanupDeps {
  isAlive?: (pid: number) => boolean
  git?: GitRunner
}

const NOT_OURS = 'not made by agent-runner'

export async function cleanup(repo: string, deps: CleanupDeps = {}): Promise<CleanupOutcome> {
  const isAlive = deps.isAlive ?? isPidAlive
  const git = deps.git ?? nodeGitRunner()
  const dir = join(repo, RUNNER_DIR)
  const runs = join(dir, RUNS_DIR)
  const runsPath = `${RUNNER_DIR}/${RUNS_DIR}`
  const removed: string[] = []
  const kept: Kept[] = []

  // A link is followed nowhere: what it points at may lie outside the project.
  const kind = await kindOf(dir)
  if (kind === 'none') return { ok: true, removed, kept }
  if (kind !== 'directory') return { ok: true, removed, kept: [{ path: RUNNER_DIR, reason: NOT_OURS }] }

  const running: string[] = []
  for (const name of await names(runs)) {
    if (!name.endsWith('.lock')) continue
    const id = name.slice(0, -'.lock'.length)
    if ((await lockHolder(repo, id, isAlive)) !== undefined) running.push(id)
  }
  if (running.length > 0) return { ok: false, reason: 'running', runs: running }

  const runsKind = await kindOf(runs)
  if (runsKind === 'directory') {
    const tracked = new Set((await git(['ls-files', '-z', '--', runsPath], repo)).split('\0').filter(Boolean))
    for (const name of await names(runs)) {
      const path = `${runsPath}/${name}`
      if (tracked.has(path)) kept.push({ path, reason: 'git tracks it' })
      else if ((name.endsWith('.lock') || name.endsWith('.stderr')) && (await kindOf(join(runs, name))) === 'file') await rm(join(runs, name), { force: true })
      else kept.push({ path, reason: NOT_OURS })
    }
    // rmdir, never a recursive remove: whatever is left in it keeps it.
    if (await rmdir(runs).then(() => true, () => false)) removed.push(runsPath)
    else if (!kept.some(entry => entry.path.startsWith(`${runsPath}/`))) kept.push({ path: runsPath, reason: 'not empty' })
  } else if (runsKind !== 'none') kept.push({ path: runsPath, reason: NOT_OURS })

  for (const name of await names(dir)) {
    if (name !== RUNS_DIR) kept.push({ path: `${RUNNER_DIR}/${name}`, reason: name === RUNNER_CONFIG ? 'your settings for agent-runner' : NOT_OURS })
  }
  if (kept.length > 0) return { ok: true, removed, kept }
  if (!(await rmdir(dir).then(() => true, () => false))) return { ok: true, removed, kept: [{ path: RUNNER_DIR, reason: 'not empty' }] }
  removed.push(RUNNER_DIR)
  // The rule is the repository's, read by every checkout of it: it stays while one still has the directory.
  const checkouts = await repositoryCheckouts(repo, git).catch(() => undefined)
  if (checkouts && !(await anyHolds(checkouts, RUNNER_DIR))) await unexcludeFromGit(repo, `/${RUNNER_DIR}`, undefined, git).catch(() => {})
  return { ok: true, removed, kept }
}

/** The names in `dir`; a directory that is not there holds none. */
async function names(dir: string): Promise<string[]> {
  return readdir(dir).catch((): string[] => [])
}

/** What sits at `path`, a link read as a link and never followed. */
async function kindOf(path: string): Promise<'none' | 'directory' | 'file' | 'other'> {
  const entry = await lstat(path).catch(() => undefined)
  if (!entry) return 'none'
  return entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
}

async function anyHolds(checkouts: readonly string[], name: string): Promise<boolean> {
  for (const checkout of checkouts) if ((await kindOf(join(checkout, name))) !== 'none') return true
  return false
}
