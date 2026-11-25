import { useEffect } from 'react'
import { usePolled, useModuleHost } from '@openagt/ui/module'
import type { HostAccounts } from '@openagt/hooks'
import { server, type BackupGap } from './calls.js'

// What is not backed up, read by Settings › Your agent data's notice, which fixes it: one press
// there changes what every reader shows. The foot of the sidebar says it through the module's
// `app.attention` item.

export interface BackupView {
  gaps: BackupGap[]
  /** OpenAgent's accounts at each host: what the data may be backed up as. */
  hosts: HostAccounts[]
}

/** Read again this often: an account may be added on the Permissions page, or another computer may name one. */
const EVERY_MS = 60_000

const changed = new Set<() => void>()

/** Tell every reader to read again: an account was named. */
export function backupChanged(): void {
  for (const reload of changed) reload()
}

export function useBackup(): { view: BackupView | null; reload: () => Promise<void> } {
  const host = useModuleHost()
  const { value: view, reload } = usePolled<BackupView | null>(() => server(host).backup({}), null, EVERY_MS, [host], { remember: 'backup' })
  useEffect(() => {
    const again = (): void => void reload()
    changed.add(again)
    return () => void changed.delete(again)
  }, [reload])
  return { view, reload }
}
