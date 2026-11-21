import { gitignorePath, nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { nodeFs } from './node-fs.js'

/**
 * Project-level repo helpers (#380): the activation marker check and a
 * `git ls-files` crawl. Read-only
 * building blocks for the sidebars (#314); activation/install (writing the
 * marker) is a separate, deferred concern.
 */

/** Minimal fs seam so activation is unit-testable without touching disk. */
export interface ProjectFs {
  /** True when `path` exists AND is a file. */
  exists(path: string): Promise<boolean>
}

/** A {@link ProjectFs} backed by `node:fs/promises`. See {@link nodeFs}. */
function nodeProjectFs(): ProjectFs {
  const { exists } = nodeFs()
  return { exists }
}

/**
 * A repo is "activated"/installed for OpenAgent when it has the
 * `.openagent/.gitignore` install writes — the same marker install's own
 * no-op check reads (#1600), so a `.openagent/` directory something else
 * created can never read as activated while the repo still lacks the ignore
 * file that keeps OpenAgent state out of git. Read-only check; writing
 * the marker is a separate, deferred concern.
 */
export async function isActivated(cwd: string, fs: ProjectFs = nodeProjectFs()): Promise<boolean> {
  return fs.exists(gitignorePath(cwd))
}

/**
 * List every file git sees in the repo at `cwd`: tracked + untracked, honoring
 * .gitignore. Uses `git ls-files -z --cached --others --exclude-standard` (the
 * same approach Vike uses). Returns repo-relative paths, deduped and sorted.
 * Forgiving: a non-repo / missing git / any failure yields `[]`, never throws.
 */
export async function crawlRepoFiles(cwd: string, agent: GitRunner = nodeGitRunner()): Promise<string[]> {
  try {
    const out = await agent(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd)
    const files = new Set<string>()
    for (const entry of out.split('\0')) {
      const trimmed = entry.trim()
      if (trimmed) files.add(trimmed)
    }
    return [...files].sort()
  } catch {
    return []
  }
}
