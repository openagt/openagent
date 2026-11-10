import { appendFile, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { nodeGitRunner, type GitRunner } from './git.js'

/** The filesystem the exclude write needs; `node:fs/promises` in production. */
export interface ExcludeFs {
  read(path: string): Promise<string>
  /** Recursive mkdir. */
  mkdir(path: string): Promise<void>
  append(path: string, contents: string): Promise<void>
  /** Replace the file in one step: a reader sees the old contents or the new, never half. */
  write(path: string, contents: string): Promise<void>
}

function nodeExcludeFs(): ExcludeFs {
  return {
    read: path => readFile(path, 'utf8'),
    mkdir: async path => {
      await mkdir(path, { recursive: true })
    },
    append: (path, contents) => appendFile(path, contents),
    write: async (path, contents) => {
      const temp = `${path}.${process.pid}.tmp`
      await writeFile(temp, contents)
      await rename(temp, path)
    },
  }
}

/**
 * Append one ignore rule to the repository's `info/exclude` — the ignore file that is git's, not
 * the project's, so no tracked file changes and no user ever sees a diff. The rule goes in the
 * *common* git dir because git resolves excludes from there; a per-worktree copy looks right and
 * is silently never read. One rule there covers every worktree of the repo. Idempotent. Throws on
 * a non-repo or unwritable git dir — callers decide whether that is fatal (so far, never).
 */
export async function excludeFromGit(
  repo: string,
  rule: string,
  fs: ExcludeFs = nodeExcludeFs(),
  git: GitRunner = nodeGitRunner(),
): Promise<void> {
  const common = (await git(['rev-parse', '--git-common-dir'], repo)).trim()
  if (!common) return
  const infoDir = join(isAbsolute(common) ? common : join(repo, common), 'info')
  const path = join(infoDir, 'exclude')
  const current = await fs.read(path).catch(() => '')
  if (current.split('\n').some(line => line.trim() === rule)) return
  await fs.mkdir(infoDir)
  await fs.append(path, (current && !current.endsWith('\n') ? '\n' : '') + rule + '\n')
}

/**
 * Take one ignore rule back out of the repository's `info/exclude`: the undo of
 * {@link excludeFromGit}, for a tool that removes what the rule hid. Only a line that is exactly
 * the rule goes; every other line, a person's own included, stays as it was. A rule that is not
 * there, and a repository with no exclude file, change nothing. Answers whether a line went.
 */
export async function unexcludeFromGit(
  repo: string,
  rule: string,
  fs: ExcludeFs = nodeExcludeFs(),
  git: GitRunner = nodeGitRunner(),
): Promise<boolean> {
  const common = (await git(['rev-parse', '--git-common-dir'], repo)).trim()
  if (!common) return false
  const path = join(isAbsolute(common) ? common : join(repo, common), 'info', 'exclude')
  const current = await fs.read(path).catch(() => undefined)
  if (current === undefined) return false
  const lines = current.split('\n')
  const left = lines.filter(line => line.trim() !== rule)
  if (left.length === lines.length) return false
  await fs.write(path, left.join('\n'))
  return true
}

/**
 * Every checkout of the repository `repo` belongs to, by its root: the main one and each linked
 * worktree, an agent's included. They all read the one exclude file, so a tool asks this before
 * it takes a rule out: a rule goes only when no checkout holds what it hides.
 */
export async function repositoryCheckouts(repo: string, git: GitRunner = nodeGitRunner()): Promise<string[]> {
  const list = await git(['worktree', 'list', '--porcelain'], repo)
  return list.split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice('worktree '.length))
}

/**
 * Take the rule hiding a tool's directory, `/<dir>`, back out once the tool removed the directory:
 * only when no checkout of the repository still has one, since they all read the rule. Best-effort:
 * a repository whose checkouts cannot be listed, or whose exclude file cannot be written, keeps it.
 */
export async function unexcludeOnceGone(repo: string, dir: string, git: GitRunner = nodeGitRunner()): Promise<void> {
  const checkouts = await repositoryCheckouts(repo, git).catch(() => undefined)
  if (checkouts === undefined) return
  for (const checkout of checkouts) if (await lstat(join(checkout, dir)).then(() => true, () => false)) return
  await unexcludeFromGit(repo, `/${dir}`, undefined, git).catch(() => {})
}
