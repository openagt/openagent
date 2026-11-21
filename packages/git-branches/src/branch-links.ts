import { lstat, mkdir, readdir, readlink, symlink, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { nodeGitRunner, type GitRunner, BRANCHES_DIR } from '@openagt/agent-data'
import { isAgentBranch } from './branch-names.js'
import { worktreeDirEntries, worktreeBranch, type WorktreeDirEntry } from './worktree.js'

// The branches view (#1580): every checkout under `.branches/` is a directory named as the branch
// it was created on (`agent-<id>`), and this pass keeps the *current* names reachable beside them —
// a symlink named as the branch a checkout is on now, whenever that differs from the dir's own
// name (the agent names its session early). So `cd .branches/<name>` reaches any session's
// checkout by its name, and a rename costs a link, never moving a checkout under a live agent
// (the #1589 review's call).
//
// Reconciled after each checkout is made and after each change through the command line: derive
// the wanted links from the checkouts on disk, add what is missing, drop only our own stale links.

/** The filesystem the reconcile needs; `node:fs/promises` in production. */
export interface LinksFs {
  /** Names under `dir`; a missing dir yields `[]`. */
  readdir(dir: string): Promise<string[]>
  /** Recursive mkdir. */
  mkdir(dir: string): Promise<void>
  /** Create a symlink at `path` pointing to `target`. */
  symlink(target: string, path: string): Promise<void>
  /** A symlink's target, or `undefined` when `path` is missing or not a symlink. */
  readlink(path: string): Promise<string | undefined>
  /** Remove one file or symlink. */
  unlink(path: string): Promise<void>
  /** Whether anything (file, dir, or dangling link) sits at `path`. */
  lexists(path: string): Promise<boolean>
}

/** A {@link LinksFs} over `node:fs/promises`. */
const nodeLinksFs: LinksFs = {
  readdir: dir => readdir(dir).catch(() => []),
  mkdir: dir => mkdir(dir, { recursive: true }).then(() => {}),
  symlink: (target, path) => symlink(target, path),
  readlink: path => readlink(path).catch(() => undefined),
  unlink: path => unlink(path),
  lexists: path => lstat(path).then(() => true, () => false),
}

/** Injectable seams for {@link reconcileBranchLinks}. */
export interface BranchLinksDeps {
  git?: GitRunner
  fs?: LinksFs
  /** The checkouts on disk (default {@link worktreeDirEntries}). */
  worktrees?: (cwd: string) => Promise<WorktreeDirEntry[]>
  /** The branch a worktree is on, or none when the path is not a worktree root (default {@link worktreeBranch}). */
  branchOf?: (path: string) => Promise<string | undefined>
}

/**
 * Bring one project's `.branches/` links in line with its worktrees: one link per worktree, named
 * as the branch the worktree is on right now. Renames are covered by the same rule — the old name
 * stops being wanted and is dropped, the new one is created.
 *
 * Touches only what is provably ours: a link is created, replaced, or removed only when it points
 * (or would point) at a sibling checkout; anything else at those paths — a user's own file, dir,
 * or symlink — is left alone. Never throws.
 */
export async function reconcileBranchLinks(cwd: string, deps: BranchLinksDeps = {}): Promise<void> {
  const git = deps.git ?? nodeGitRunner()
  const fs = deps.fs ?? nodeLinksFs
  const worktrees = deps.worktrees ?? worktreeDirEntries
  // A `.branches/` directory that is not a worktree root reads as no branch (#1654): otherwise
  // it reads as the enclosing repo's, and a link named after the user's own branch appears.
  const branchOf = deps.branchOf ?? ((path: string) => worktreeBranch(path, git))

  const linksDir = join(cwd, BRANCHES_DIR)
  /** Link name -> relative target, derived from what is actually checked out. */
  const wanted = new Map<string, string>()
  for (const entry of await worktrees(cwd).catch((): WorktreeDirEntry[] => [])) {
    const branch = await branchOf(entry.path).catch(() => undefined)
    // A detached worktree has no name to link; a slashed name cannot be a
    // link name at all — both simply get no link.
    if (!branch || branch.includes('/')) continue
    // The link is a sibling of the checkout. A dir already carrying the branch's name needs none.
    const target = basename(entry.path)
    if (branch === target) continue
    wanted.set(branch, target)
  }

  // Drop our stale links: entries that are symlinks to a sibling checkout but no longer wanted,
  // or wanted with a different target (a reused branch name now belongs to a newer worktree).
  for (const name of await fs.readdir(linksDir)) {
    const path = join(linksDir, name)
    const target = await fs.readlink(path)
    if (target === undefined || !isAgentBranch(target)) continue // not ours to touch
    if (wanted.get(name) === target) continue
    await fs.unlink(path).catch(() => {})
  }

  for (const [name, target] of wanted) {
    const path = join(linksDir, name)
    if (await fs.lexists(path)) continue // ours-and-current, or someone else's — either way, stay
    await fs.mkdir(linksDir)
    await fs.symlink(target, path).catch(() => {})
  }
}
