import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeGitRunner, type GitRunner } from './git.js'
import { OPENAGENT_DIR } from './names.js'
import { openagentGitignore, gitignorePath } from './openagent-gitignore.js'

/**
 * Make a folder a project of OpenAgent's (#391): create the `.openagent/` marker and its ignore
 * file. Nothing is committed on a branch that has a commit. What a dashboard's "Add project" does
 * to a folder. Pure core over a
 * {@link GitRunner} and the three file operations it needs.
 */

/** The file operations an install needs; `node:fs/promises` in production. */
export interface InstallFs {
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  write(path: string, contents: string): Promise<void>
}

/** The `node:fs/promises` implementation of {@link InstallFs}. */
export function nodeInstallFs(): InstallFs {
  return {
    exists: path => access(path).then(() => true, () => false),
    async mkdir(path) {
      await mkdir(path, { recursive: true })
    },
    write: (path, contents) => writeFile(path, contents),
  }
}

/** The message of the empty commit an install gives a repository that has none. */
export const FIRST_COMMIT_MESSAGE = '[OpenAgent] first commit'

/** Git's tree with no file in it. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** The outcome of {@link installProject}. Failures are values, never throws. */
export type InstallResult =
  | { ok: true; alreadyActivated?: boolean; initialized?: boolean }
  | { ok: false; error: string }

/** Injectable seams for {@link installProject}. */
export interface InstallDeps {
  git?: GitRunner
  fs?: InstallFs
}

/**
 * Activate the repo at `cwd`: create `.openagent/` with its ignore file, which hides the whole
 * directory from git, itself included, so the person's repository shows no change. A repo whose
 * ignore file is already there is a no-op (`alreadyActivated`) — the ignore file is the
 * activation marker. Forgiving: any git/fs failure surfaces as `{ ok: false, error }`.
 */
export async function installProject(cwd: string, deps: InstallDeps = {}): Promise<InstallResult> {
  const git = deps.git ?? nodeGitRunner()
  const fs = deps.fs ?? nodeInstallFs()

  if (await fs.exists(gitignorePath(cwd))) return { ok: true, alreadyActivated: true }

  try {
    // Auto-initialize a repo when the folder isn't one yet: OpenAgent treats
    // git as the source of truth, so `git init` it for the user rather than erroring.
    const insideRepo = await git(['rev-parse', '--is-inside-work-tree'], cwd)
      .then(out => out.trim() === 'true')
      .catch(() => false)
    if (!insideRepo) await git(['init'], cwd)

    // A repository with no commit cannot give an agent's branch a start. Its first commit is
    // made empty, straight from the empty tree: the index is not read, so a file the person has
    // staged stays staged and none of theirs is committed. Before the marker below, so a commit
    // that fails leaves a folder the next add tries again.
    const hasCommit = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], cwd).then(() => true, () => false)
    if (!hasCommit) {
      const first = (await git(['commit-tree', EMPTY_TREE, '-m', FIRST_COMMIT_MESSAGE], cwd)).trim()
      await git(['update-ref', 'HEAD', first], cwd)
    }

    await fs.mkdir(join(cwd, OPENAGENT_DIR))
    // Keep what lives under `.openagent/` (a run's live files, the hooks file) out of git
    // (#313). The early return above established the file is absent.
    await fs.write(gitignorePath(cwd), openagentGitignore())
    return insideRepo ? { ok: true } : { ok: true, initialized: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
