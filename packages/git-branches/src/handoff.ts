import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeGitRunner, sessionFolder, sessionsHome, type GitRunner } from '@openagt/agent-data'
import type { RunFound } from '@openagt/hooks'
import { readBranchStates } from './branch-state.js'
import { copyStart } from './session-folder.js'

// What a finished session produced (#799), as its branch holds it: the commits, the files, where
// the branch stands, the files its checkout left uncommitted. What the bar above the message box
// says of the work and the next steps it offers (Commit, Publish branch, Merge) are read from it.
//
// The read is branch-addressed, not checkout-addressed: the common end state has no checkout left,
// so the branch is the subject and the project's repository only where it is read from, and a
// finished session reads the same whether or not its checkout still exists. Its pull request is the
// git host's question, never asked here.
//
// A session's copies of repos (its Context) are read the same way, each in its own folder in the
// session's folder: the copy's branch, measured from the commit the copy was made at.

/** One commit a session put on its branch. */
export interface HandoffCommit {
  sha: string
  /** Short sha, for display. */
  short: string
  subject: string
}

/** One file the session changed, against the branch point. */
export interface HandoffFile {
  path: string
  insertions: number
  deletions: number
  /** True for a binary file, where line counts are meaningless. */
  binary: boolean
}

/** What a finished session's branch holds, and where it stands. */
export interface Handoff {
  /** The branch the work is on. */
  branch: string
  /** The name the agent gave its work; absent while the run has not named it. */
  name?: string
  /** The branch still exists in the repository (a deleted or never-created one does not). */
  exists: boolean
  /** The branch is gone because the run changed nothing, not because work went. */
  unchanged?: boolean
  /**
   * The run's work was landed: merged into the project's default branch on this machine. Its own
   * branch went with that, and what is read here is what it held, by the last commit its record kept.
   */
  landed?: boolean
  /** What the branch is measured against: the default branch, or the commit the run's own work begins at, when one was found. */
  base?: string
  commits: HandoffCommit[]
  files: HandoffFile[]
  insertions: number
  deletions: number
  /**
   * The session produced nothing to hand off: no commit the base does not have, or commits that
   * net to no change. Said out loud, rather than shown as an empty branch.
   */
  empty: boolean
  /** The repository has a remote to push to at all. */
  hasRemote: boolean
  /** The branch is on the remote and the remote is at the same commit. */
  pushed: boolean
  /** The branch is already merged into the base. */
  merged: boolean
  /**
   * The files the session changed and never committed, read from its own checkout (#1173): not on
   * the branch yet, so not in `commits`. Absent when no checkout is on the branch any more.
   */
  pendingFiles?: string[]
  /** A session's copy of a repo with no remote: the folder it was copied from, where its work goes back to, and whether that folder has the branch already. */
  copiedFrom?: { path: string; hasBranch: boolean }
}

/** Where a session's work is read: the repository, and the run as it stands there. */
export interface WorkAt {
  /** The repository the branch is read in: the project's, or a copy's. */
  cwd: string
  /** The branch the work is on, else the last commit of work that was landed. */
  branch?: string
  /** The commit the work begins at, where the default branch cannot tell it. */
  from?: string
  landed?: string
  /** The run changed nothing, so a branch it no longer has held nothing. */
  changedNothing: boolean
}

/** A copy's name: one folder's own name, never a path, and none of the folder's dot-entries (the run's live record is one). */
export function isCopyName(name: unknown): name is string {
  return typeof name === 'string' && /^[^./\\][^/\\]*$/.test(name)
}

/** The names of a session's copies of repos, by name: every folder in its folder that is a repository's top. None for a session with no folder. */
export async function sessionCopies(agentId: string, home: string = sessionsHome()): Promise<string[]> {
  const folder = sessionFolder(home, agentId)
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
  const names = entries.filter(entry => entry.isDirectory() && isCopyName(entry.name)).map(entry => entry.name)
  const repos = await Promise.all(names.map(async name => ((await isRepository(join(folder, name))) ? name : undefined)))
  return repos.filter((name): name is string => name !== undefined).sort()
}

async function isRepository(dir: string): Promise<boolean> {
  return stat(join(dir, '.git')).then(() => true, () => false)
}

/**
 * Where the session's work is, in the project at `root` (`run` as its host found it), or in its copy
 * `repo`: the copy's folder, on the branch the copy is on now (its agent renames it), measured from
 * the commit the copy was made at. What the run's record says is the project's own. Nothing for a
 * name that is no copy of this session's, or a copy on no branch.
 */
export async function workAt(root: string, agentId: string, run: RunFound | undefined, repo: string | undefined, deps: { home?: string; git?: GitRunner } = {}): Promise<WorkAt | undefined> {
  if (repo === undefined) {
    const record = run?.record
    return {
      cwd: root,
      ...(record?.branch !== undefined ? { branch: record.branch } : {}),
      ...(record?.baseCommit !== undefined ? { from: record.baseCommit } : {}),
      ...(record?.landed !== undefined ? { landed: record.landed } : {}),
      changedNothing: run?.changedNothing === true,
    }
  }
  if (!isCopyName(repo)) return undefined
  const cwd = join(sessionFolder(deps.home ?? sessionsHome(), agentId), repo)
  if (!(await isRepository(cwd))) return undefined
  const git = deps.git ?? nodeGitRunner()
  const [branch, start] = await Promise.all([git(['branch', '--show-current'], cwd).then(out => out.trim(), () => ''), copyStart(cwd, git)])
  if (!branch) return undefined
  return { cwd, branch, ...(start !== undefined ? { from: start } : {}), changedNothing: false }
}

/**
 * What the session left behind there: its branch's git facts, measured from where its own work
 * began. A run that was landed has no branch left: what it held is read by the last commit its
 * record kept, and the answer says landed. A branch gone because the run changed nothing is said as
 * that, not as lost work. Undefined for a run with neither a branch nor a landed commit.
 */
export async function readHandoff(at: WorkAt, git: GitRunner = nodeGitRunner()): Promise<Handoff | undefined> {
  const ref = at.branch ?? at.landed
  if (ref === undefined) return undefined
  const [state] = await readBranchStates(at.cwd, [ref], git, at.from)
  if (!state) return undefined
  const commits = state.commits.map(commit => ({ sha: commit.sha, short: commit.sha.slice(0, 7), subject: commit.subject }))
  const files = state.files.map(file => ({ path: file.path, insertions: file.insertions, deletions: file.deletions, binary: file.binary }))
  const handoff: Handoff = {
    branch: ref,
    ...(state.name ? { name: state.name } : {}),
    exists: state.exists,
    ...(state.base ? { base: state.base } : {}),
    commits,
    files,
    insertions: files.reduce((sum, f) => sum + f.insertions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    // A session that changed nothing is a real outcome, not an error: it gets said, not shown as
    // an empty branch with presses that would push nothing. Commits that net to no change leave
    // nothing to hand off either.
    empty: commits.length === 0 || files.length === 0,
    hasRemote: state.hasRemote,
    pushed: state.pushed,
    merged: state.merged,
    ...(state.pendingFiles ? { pendingFiles: state.pendingFiles } : {}),
    ...(state.copiedFrom ? { copiedFrom: state.copiedFrom } : {}),
  }
  if (at.landed !== undefined) return { ...handoff, landed: true }
  if (!handoff.exists && at.changedNothing) return { ...handoff, unchanged: true }
  return handoff
}
