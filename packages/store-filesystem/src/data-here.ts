import type { AttentionItem, ProjectRef } from '@openagt/hooks'
import { branchReach, type BranchReach } from './file-branch.js'

/**
 * Why a project's data stays on this computer, said under the project's name where nothing is
 * wrong with it (a `note`): its repository has no origin, or the person keeps its records here.
 * Nothing for a project whose data goes to its origin, or one whose reach cannot be read.
 */
export async function dataHere(project: ProjectRef, reach: (dir: string) => Promise<BranchReach> = dir => branchReach(dir)): Promise<AttentionItem[]> {
  const at = await reach(project.dir).catch((): BranchReach => 'origin')
  if (at === 'origin') return []
  return [{ kind: 'note', scope: 'project', id: 'data-here', words: at === 'no-remote' ? 'Local only, no remote' : 'Records kept on this machine' }]
}
