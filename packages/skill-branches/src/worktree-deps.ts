import { lstat, mkdir, readdir, stat, symlink } from 'node:fs/promises'
import { join, relative } from 'node:path'

/**
 * Give a fresh worktree a dependency tree (#736). `node_modules` is gitignored, so
 * `git worktree add` hands the agent an empty one and every command in it fails.
 *
 * Three ways to fix that: copy the tree (correct, but gigabytes per agent), install
 * into each worktree (correct, but real latency on every start), or link the
 * parent checkout's trees in (instant, no extra disk, one store shared by N runs).
 * We link — but each *entry* of a dependency directory, into a real directory of
 * the worktree's own, never the directory itself (#1262). A directory link made the
 * parent's tree the worktree's modules directory in the package manager's eyes:
 * an agent that changed a dependency and ran `pnpm install` had pnpm resolve
 * through the link and rewrite — or, under `CI=true`, purge outright — the parent
 * checkout's real `node_modules`, and every later agent died at boot. With a real
 * directory holding links, an install in the worktree writes into the worktree.
 *
 * The package manager's own state (`.pnpm`, `.modules.yaml`, and the like — every
 * dot-entry but `.bin`) is deliberately not linked: it is what tells the package
 * manager "this tree is mine, installed here", and the worktree's is not. The
 * packages still resolve without it — a package entry in a pnpm tree is a relative
 * link into `.pnpm`, and a link to that link resolves where the target lives, in
 * the parent checkout. `.bin` is linked because an agent runs the project's tools.
 * A scope directory is mirrored one level down the same way, a real directory
 * holding a link per package, so a new scoped package lands in the worktree too.
 */

/** The dependency directory mirrored into a worktree. */
const NODE_MODULES = 'node_modules'

/** How deep below the repo root a `node_modules` is looked for (root = 0). Covers a
 *  pnpm/npm workspace's `packages/<pkg>/node_modules` without walking the world. */
const MAX_DEPTH = 2

/** Directory names never descended into while scanning for dependency trees. */
const SKIP = new Set([NODE_MODULES, '.git', 'dist', 'build', 'coverage'])

/** The one dot-entry of a dependency directory that is linked: the project's executables. */
const BIN = '.bin'

/** The package manager's private state in a dependency directory: never linked (see above). */
const isPrivate = (name: string): boolean => name.startsWith('.') && name !== BIN

/**
 * A scope (`@acme`) holds packages rather than being one. Linked whole, an install of a new
 * `@acme/pkg` in the worktree would go through the link into the parent's tree, so a scope is a
 * real directory of the worktree's own too, holding a link per package.
 */
const isScope = (name: string): boolean => name.startsWith('@')

/** The filesystem this module needs. Injectable so the scan is testable. */
export interface LinkFs {
  /** Entry names in a directory. A missing/unreadable dir yields `[]`. */
  readdir(path: string): Promise<string[]>
  /** True when `path` is a directory (following symlinks). Any error reads as `false`. */
  isDirectory(path: string): Promise<boolean>
  /** True when anything exists at `path`, symlinks included (no link following). */
  entryExists(path: string): Promise<boolean>
  /** Recursive. */
  mkdir(path: string): Promise<void>
  /** Create a directory symlink at `path` pointing to `target`. */
  symlinkDir(target: string, path: string): Promise<void>
}

/** The `node:fs/promises` implementation of {@link LinkFs}. */
export function nodeLinkFs(): LinkFs {
  return {
    readdir: path => readdir(path).catch(() => []),
    isDirectory: path => stat(path).then(s => s.isDirectory(), () => false),
    entryExists: path => lstat(path).then(() => true, () => false),
    mkdir: path => mkdir(path, { recursive: true }).then(() => {}),
    // 'junction' is the only directory-link type Windows grants without elevation;
    // it is ignored on POSIX.
    symlinkDir: (target, path) => symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir'),
  }
}

/**
 * Every `node_modules` directory in `repo`, as repo-relative paths, down to
 * {@link MAX_DEPTH}. Sorted, so the linking order (and any log of it) is stable.
 */
export async function findDependencyDirs(repo: string, fs: LinkFs = nodeLinkFs()): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (await fs.isDirectory(join(dir, NODE_MODULES))) found.push(relative(repo, join(dir, NODE_MODULES)))
    if (depth >= MAX_DEPTH) return
    for (const name of await fs.readdir(dir)) {
      if (name.startsWith('.') || SKIP.has(name)) continue
      const child = join(dir, name)
      if (await fs.isDirectory(child)) await walk(child, depth + 1)
    }
  }
  await walk(repo, 0)
  return found.sort()
}

/**
 * Mirror `repo`'s dependency trees into `worktree` at the same relative paths: a real
 * directory per tree, holding a link per entry (the package manager's private state
 * left out, see above). Returns the trees mirrored. Best-effort throughout: a worktree
 * with no deps is a worse run, not a failed one, so a link that cannot be made is
 * skipped rather than thrown. A tree already present is left alone (the agent may
 * have installed already).
 */
export async function linkDependencies(repo: string, worktree: string, fs: LinkFs = nodeLinkFs()): Promise<string[]> {
  const linked: string[] = []
  for (const rel of await findDependencyDirs(repo, fs)) {
    const source = join(repo, rel)
    const dir = join(worktree, rel)
    try {
      if (await fs.entryExists(dir)) continue
      await fs.mkdir(dir)
      for (const name of await fs.readdir(source)) {
        if (isPrivate(name)) continue
        if (isScope(name) && (await fs.isDirectory(join(source, name)))) {
          await fs.mkdir(join(dir, name))
          for (const pkg of await fs.readdir(join(source, name))) await fs.symlinkDir(join(source, name, pkg), join(dir, name, pkg)).catch(() => {})
        } else await fs.symlinkDir(join(source, name), join(dir, name)).catch(() => {})
      }
      linked.push(rel)
    } catch {
      // Raced, or a filesystem that refuses the directory: the agent still starts.
    }
  }
  return linked
}
