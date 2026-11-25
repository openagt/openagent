import { nodeGitRunner } from './git.js'
import type { GitRunner } from '@openagt/hooks'

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
