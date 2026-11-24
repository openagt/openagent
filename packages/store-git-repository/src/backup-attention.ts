import type { AttentionArgs, AttentionItem } from '@openagt/hooks'
import { SYNC_ENTRY } from './entry.js'
import { personalGap, type BackupGap } from './gaps.js'

/** What a gap says after its words: where it goes, and what waits. */
export function gapDetail(gap: BackupGap): string {
  return `To ${gap.address}${gap.waiting ? ` · ${gap.waiting} ${gap.waiting === 1 ? 'change' : 'changes'} waiting` : ''}`
}

/**
 * The person's own folder, synced with a repository at a git host with no account of OpenAgent's
 * named to send it as, needs the person, about this computer: its changes wait here. Settings ›
 * Your agent data fixes it, its notice naming an account.
 */
export async function backupAttention({ project }: AttentionArgs): Promise<AttentionItem[]> {
  if (project) return []
  const gap = await personalGap().catch(() => undefined)
  if (!gap) return []
  return [{ kind: 'setup', scope: 'computer', id: 'not-backed-up', words: 'Your agent data is not backed up', detail: gapDetail(gap), fix: { label: 'Back up your agent data…', settings: SYNC_ENTRY } }]
}
