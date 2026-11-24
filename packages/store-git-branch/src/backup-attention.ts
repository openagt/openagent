import type { AppContext, AttentionArgs, AttentionItem } from '@openagt/hooks'
import { gapDetail, projectGap, SYNC_ENTRY } from '@openagt/store-git-repository'

/**
 * A shared project's data at a git host with no account of OpenAgent's named to send it as needs
 * the person, about this computer: its changes wait here. Asked with no project, of every project
 * whose data is shared (the ones the module is on in). Settings › Your agent data fixes it, its
 * notice naming an account.
 */
export async function backupAttention({ project }: AttentionArgs, app: AppContext): Promise<AttentionItem[]> {
  if (project) return []
  const items: AttentionItem[] = []
  for (const shared of await app.projects()) {
    const gap = await projectGap(shared).catch(() => undefined)
    if (!gap) continue
    items.push({
      kind: 'setup',
      scope: 'computer',
      id: `not-backed-up:${shared.id}`,
      words: `${shared.name}’s shared data is not backed up`,
      detail: gapDetail(gap),
      fix: { label: `Back up ${shared.name}’s shared data…`, settings: SYNC_ENTRY },
    })
  }
  return items
}
