import { useEffect } from 'react'
import { onBackup, type BackupView } from '../rpc/backup.js'
import { usePolled } from './use-async.js'

// What is not backed up, read by the foot of the sidebar (an item in the person's menu) and by
// Settings › Your agent data (the notice that fixes it): one press there changes what both show.

/** Read again this often: an account may be added on the Permissions page, or another computer may name one. */
const EVERY_MS = 60_000

const changed = new Set<() => void>()

/** Tell every reader to read again: an account was named. */
export function backupChanged(): void {
  for (const reload of changed) reload()
}

export function useBackup(): { view: BackupView | null; reload: () => Promise<void> } {
  const { value: view, reload } = usePolled<BackupView | null>(() => onBackup().catch(() => null), null, EVERY_MS, [], { remember: 'backup' })
  useEffect(() => {
    const again = (): void => void reload()
    changed.add(again)
    return () => void changed.delete(again)
  }, [reload])
  return { view, reload }
}
