import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The plan/backlog document categories the dashboard surfaces in its sidebar
 * (#319, part of the MVP UI #309), so the human can read them beside the agent.
 *
 * These are written per session as `PLAN_<SESSION>.agent.md` (the plan for now) and
 * `TODO_<SESSION>.agent.md` (the backlog), where SESSION is a git-branch slug — by
 * OpenAgent's own system prompt back when it ran the agent (#323/#326), and by
 * whatever a project's own skills tell an agent to write now. The flat fallback is `PLAN.md`
 * at the root; the `TODO` category has no flat file: the agent queue is not a document of the
 * checkout but a project package's data, and the dashboard shows it on that package's own page
 * and the Overview's AI Queue card (#1774), not here. Scoped and flat-root names are matched
 * against a flat readdir of the root, never taken from user input, so there is no path
 * traversal to guard against.
 */
export const DOC_CATEGORIES = [
  { flat: 'PLAN.md', scoped: /^PLAN_[a-z0-9-]+\.agent\.md$/ },
  { scoped: /^TODO_[a-z0-9-]+\.agent\.md$/ },
] as const

/** One surfaced document: its filename and current contents. */
export interface WorkspaceDoc {
  name: string
  content: string
}

/** Cap a single doc so a runaway file can't bloat the docs payload. */
const MAX_DOC_BYTES = 200_000

/**
 * The workspace-root filenames to surface, in sidebar order: per category the flat
 * file (if present) then its session-scoped files (sorted). Every name is a bare
 * readdir entry matched against a fixed pattern, so none can traverse. Returns
 * empty when the workspace is missing or unreadable.
 */
/**
 * Read the surfaced plan/todo docs, in sidebar order: per category the flat file (if the
 * category has one and it is present) then its session-scoped files (sorted), every one a
 * workspace-root file. Missing or blank files are skipped; a file over the size cap is
 * truncated. Never throws — a read error just omits that doc.
 */
export async function readDocs(cwd: string): Promise<WorkspaceDoc[]> {
  let entries: string[]
  try {
    entries = await readdir(cwd)
  } catch {
    return []
  }
  const present = new Set(entries)
  const docs: WorkspaceDoc[] = []
  const push = (name: string, content: string | undefined): void => {
    if (!content?.trim()) return
    docs.push({ name, content: content.length > MAX_DOC_BYTES ? content.slice(0, MAX_DOC_BYTES) + '\n\n… (truncated)' : content })
  }
  for (const cat of DOC_CATEGORIES) {
    if ('flat' in cat && present.has(cat.flat)) push(cat.flat, await readFile(join(cwd, cat.flat), 'utf8').catch(() => undefined))
    for (const name of entries.filter(e => cat.scoped.test(e)).sort()) {
      push(name, await readFile(join(cwd, name), 'utf8').catch(() => undefined))
    }
  }
  return docs
}
