import { lstat, readdir, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_BRANCH, clearSharing, nodeGitRunner, removeFileBranch, SHARE_SETTING, type GitRunner } from '@openagt/agent-data'
import { OPENAGENT_DIR } from './openagent-dir.js'
import { runCleanups } from './built-in.js'
import { errorMessage } from './error-message.js'
import type { CleanupReport } from './dashboard/types.js'

/**
 * What OpenAgent left in a project's folder, removed: what a person asks for with the box in the
 * "Remove project" dialog. Three owners, each removing its own:
 *
 * - every tool that declares a `cleanup` command: asked to run it, and its answer passed on. One
 *   that refuses or fails ends the pass there: the records and the dashboard's directory stay.
 *   The runner refuses while a run is alive, the scheduler while one set to keep running is.
 * - the agents' records: the `agent-data` checkout and local branch, and the person's answer to
 *   "share the records". Left alone when another project on the list is a checkout of the same
 *   repository, since the branch is the repository's and that project still reads it.
 * - the dashboard's own directory, `.openagent/`: every file git does not track.
 *
 * Never the remote, a commit, a branch with work on it or a file git tracks. Nothing here throws:
 * what could not be done is a line in `failed`.
 */
export interface RemoveFilesOptions {
  /** Another project on the list that is a checkout of the same repository, by its folder. */
  recordsUsedBy?: string | undefined
  git?: GitRunner
}

export async function removeProjectFiles(root: string, opts: RemoveFilesOptions = {}): Promise<CleanupReport> {
  const git = opts.git ?? nodeGitRunner()
  const report: CleanupReport = { removed: [], kept: [], failed: [] }

  // The tools first: the runner refuses while a run of this machine is alive, and then nothing
  // of the records or the dashboard's directory may go from under that run.
  const tools = await runCleanups(root)
  report.removed.push(...tools.removed)
  report.kept.push(...tools.kept)
  report.failed.push(...tools.failed)
  if (tools.failed.length > 0) {
    const reason = 'a clean-up before it did not finish'
    report.kept.push({ path: `branch ${DATA_BRANCH}`, reason }, { path: OPENAGENT_DIR, reason })
    return report
  }

  if (opts.recordsUsedBy !== undefined) {
    report.kept.push({ path: `branch ${DATA_BRANCH}`, reason: `another project on the list uses it: ${opts.recordsUsedBy}` })
  } else {
    const records = await removeFileBranch(root, DATA_BRANCH, { git })
    if (!records.ok) report.failed.push(`the agents' records: ${records.error}`)
    else {
      report.removed.push(...records.removed)
      // The records' checkout was another tool's "not mine" a moment ago; now it is gone.
      report.kept = report.kept.filter(kept => !records.removed.includes(kept.path))
      report.kept.push(...records.kept)
      // The answer goes with the records it was about; while anything of them stays, so does it.
      if (records.kept.length === 0 && (await clearSharing(root, git))) report.removed.push(`setting ${SHARE_SETTING}`)
    }
  }

  await removeOwnDirectory(root, git, report)
  return report
}

/** The dashboard's directory: every file in it that git does not track, then each directory left empty. */
async function removeOwnDirectory(root: string, git: GitRunner, report: CleanupReport): Promise<void> {
  const dir = join(root, OPENAGENT_DIR)
  const entry = await lstat(dir).catch(() => undefined)
  if (!entry) return
  // A link is followed nowhere: what it points at may lie outside the project.
  if (!entry.isDirectory()) {
    report.kept.push({ path: OPENAGENT_DIR, reason: 'not made by OpenAgent' })
    return
  }
  let tracked: Set<string>
  try {
    tracked = new Set((await git(['ls-files', '-z', '--', OPENAGENT_DIR], root)).split('\0').filter(Boolean).map(folded))
  } catch (err) {
    // Without git's word on what it tracks, nothing is removed.
    report.failed.push(`${OPENAGENT_DIR}: ${errorMessage(err)}`)
    return
  }
  try {
    const files: string[] = []
    // The whole directory in one line when it went; else the files that did.
    if (await emptyOut(root, OPENAGENT_DIR, tracked, report, files)) report.removed.push(OPENAGENT_DIR)
    else report.removed.push(...files)
  } catch (err) {
    report.failed.push(`${OPENAGENT_DIR}: ${errorMessage(err)}`)
  }
}

/**
 * Remove what git does not track under `rel` (a directory, from the project's root) and then the
 * directory itself when nothing is left in it. Answers whether the directory went. A tracked file
 * is named in the report's `kept`, a removed one in `files`; a link is removed as a link, never
 * followed.
 */
async function emptyOut(root: string, rel: string, tracked: ReadonlySet<string>, report: CleanupReport, files: string[]): Promise<boolean> {
  for (const name of await readdir(join(root, rel))) {
    const path = `${rel}/${name}`
    if ((await lstat(join(root, path))).isDirectory()) await emptyOut(root, path, tracked, report, files)
    else if (tracked.has(folded(path))) report.kept.push({ path, reason: 'git tracks it' })
    else {
      await rm(join(root, path), { force: true })
      files.push(path)
    }
  }
  // rmdir, never a recursive remove: whatever is left in it keeps it.
  return rmdir(join(root, rel)).then(() => true, () => false)
}

/** A path as a file system that ignores case and Unicode form names it: two spellings of one tracked file are the same file here. */
function folded(path: string): string {
  return path.normalize('NFC').toLowerCase()
}
