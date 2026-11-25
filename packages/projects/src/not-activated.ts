import { stat } from 'node:fs/promises'
import type { AttentionItem, ProjectRef } from '@openagt/hooks'
import { gitignorePath } from './openagent-gitignore.js'

/**
 * A listed project whose folder is no longer made ready for OpenAgent: it lacks the
 * `.openagent/.gitignore` that adding it writes (`install.ts`, whose own check reads the same file,
 * #1600), so a `.openagent/` directory something else made never reads as ready while nothing keeps
 * OpenAgent's files out of git. Adding the folder again makes it ready. Said under the project's
 * name in a muted line, as a note: nothing stops its runs.
 */
export async function notActivated(project: ProjectRef, exists: (path: string) => Promise<boolean> = isFile): Promise<AttentionItem[]> {
  if (await exists(gitignorePath(project.dir)).catch(() => false)) return []
  return [{ kind: 'note', scope: 'project', id: 'not-activated', words: 'Not activated' }]
}

/** Whether `path` is there and is a file. */
function isFile(path: string): Promise<boolean> {
  return stat(path).then(entry => entry.isFile(), () => false)
}
