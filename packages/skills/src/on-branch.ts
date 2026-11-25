import { dirname, join } from 'node:path'
import { nodeGitRunner, originDefaultBranch } from '@openagt/git-branches'
import type { GitRunner } from '@openagt/hooks'

/**
 * Which of a project's skills a run gets: a run's checkout starts from a branch, so a skill in the
 * project's folder reaches its runs only once it is on that branch. Until then OpenAgent says it is
 * waiting, and the message box does not offer its command.
 */

/** The shared folder, where Codex reads a skill's text; and Claude Code's, often a link to it. */
const TEXTS_DIR = '.agents/skills'
const LINKS_DIR = '.claude/skills'

/** The branch runs start from: `ref` is what git is asked, `name` what a person reads. */
export interface StartBranch {
  ref: string
  name: string
}

/**
 * The branch runs start from in the project at `root`: origin's default branch as this clone has
 * it, else the branch the folder is on (a project with no remote starts a run from its last local
 * commit). Read locally, never fetched. None where the folder is on no branch, or is no repository.
 */
export async function startBranch(root: string, git: GitRunner = nodeGitRunner()): Promise<StartBranch | undefined> {
  const main = await originDefaultBranch(root, git).catch(() => undefined)
  if (main !== undefined) return { ref: main, name: main.slice('origin/'.length) }
  const local = await git(['rev-parse', '--abbrev-ref', 'HEAD'], root).then(out => out.trim(), () => undefined)
  return local !== undefined && local !== '' && local !== 'HEAD' ? { ref: 'HEAD', name: local } : undefined
}

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
