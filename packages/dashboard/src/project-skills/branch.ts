import { lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { SKILL_NAMES } from './catalogue.js'
import { commitPaths, type CommitOutcome } from './commit.js'
import { LINKS_DIR, TEXTS_DIR } from './project.js'

/**
 * A project's skills as git has them (#2023): which are on a branch, and which stand written or
 * deleted in the folder with no commit yet. An agent's checkout starts from a branch, so a skill
 * written into the folder reaches agents only once it is on that branch; until then a dashboard
 * says it is waiting, and offers the commit.
 */

/** Which skills are on a branch: asked by name. */
export interface OnBranch {
  has(name: string): boolean
}

/** Everything counts as there: the answer where the branch cannot be read, so that nothing is held back on a guess. */
const UNKNOWN: OnBranch = { has: () => true }

/**
 * The skills on `ref`, in either folder: a text there, or a link named as the skill (where it
 * leads is the project's own business). Read with one listing of the two folders. Where the
 * listing fails, or a skills folder is itself a link to somewhere the listing does not show, the
 * answer is that every skill is there: a skill is said to be waiting only when that is known.
 */
export async function skillsOn(root: string, ref: string, git: GitRunner = nodeGitRunner()): Promise<OnBranch> {
  // No commit behind the ref: a repository that has none yet, a branch that is not there. Nothing is on it.
  if (!(await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root).then(() => true, () => false))) return { has: () => false }
  const listed = await git(['ls-tree', '-r', '-z', ref, '--', TEXTS_DIR, LINKS_DIR], root).catch(() => undefined)
  if (listed === undefined) return UNKNOWN
  const on = new Set<string>()
  let linkedFolders = 0
  for (const entry of listed.split('\0').filter(Boolean)) {
    const [meta, path] = entry.split('\t') as [string, string]
    const link = meta.startsWith('120000 ')
    const [first, second, name, file, more] = path.split('/')
    const dir = `${first}/${second}`
    if (dir !== TEXTS_DIR && dir !== LINKS_DIR) continue
    if (name === undefined) linkedFolders += link ? 1 : 0
    else if (file === undefined ? link : file === 'SKILL.md' && more === undefined) on.add(name)
  }
  // Claude Code's folder linked to the other one is the usual shape, and that one is listed. Any other linked folder is not.
  if (linkedFolders > 0 && !(linkedFolders === 1 && (await linksTo(root, ref, LINKS_DIR, TEXTS_DIR, git)))) return UNKNOWN
  return on
}

/** Whether `ref` holds `from` as a link that leads to the folder `to`. */
async function linksTo(root: string, ref: string, from: string, to: string, git: GitRunner): Promise<boolean> {
  const target = await git(['cat-file', 'blob', `${ref}:${from}`], root).catch(() => undefined)
  return target !== undefined && join(dirname(from), target.trim()).replace(/\/$/, '') === to
}

/** Whether a path from the project's root goes through a link on the way: git takes a link as one path, and refuses one that goes through it. */
async function throughLink(root: string, path: string): Promise<boolean> {
  for (let dir = dirname(path); dir !== '.'; dir = dirname(dir)) {
    if (await lstat(join(root, dir)).then(entry => entry.isSymbolicLink(), () => false)) return true
  }
  return false
}

/** The paths git may hold for `names`, from the project's root: each text, each link, and a text in a folder of Claude Code's own where there is no link. */
export async function skillPaths(root: string, names: readonly string[]): Promise<string[]> {
  const paths: string[] = []
  for (const name of names) {
    const link = await lstat(join(root, LINKS_DIR, name)).catch(() => undefined)
    for (const path of [`${TEXTS_DIR}/${name}/SKILL.md`, link?.isDirectory() ? `${LINKS_DIR}/${name}/SKILL.md` : `${LINKS_DIR}/${name}`]) {
      if (!(await throughLink(root, path))) paths.push(path)
    }
  }
  return paths
}

/** The skills whose files stand written, changed or deleted in the folder with no commit yet, in the list's order. */
export async function uncommittedSkills(root: string, git: GitRunner = nodeGitRunner()): Promise<string[]> {
  // Read without taking git's lock on the index: this is polled, and must never stand in the way of the person's own git.
  const status = await git(['--no-optional-locks', 'status', '--porcelain', '-z', '-uall', '--', ...(await skillPaths(root, SKILL_NAMES))], root).catch(() => '')
  // Each entry is "XY <path>", and a skill's every path names it third: `.agents/skills/<name>/…`, `.claude/skills/<name>`.
  const named = new Set(status.split('\0').filter(Boolean).map(entry => entry.slice(3).split('/')[2]))
  return SKILL_NAMES.filter(name => named.has(name))
}

/**
 * One commit of skill files that stand uncommitted, and nothing else. With `names`, the files of
 * those skills alone: what a dashboard commits after a change. Without, every uncommitted file of
 * the list's skills. Never a push.
 */
export async function commitSkills(root: string, names: readonly string[] = SKILL_NAMES, git: GitRunner = nodeGitRunner()): Promise<CommitOutcome> {
  return commitPaths(root, await skillPaths(root, names), 'Update OpenAgent skills\n', git)
}
