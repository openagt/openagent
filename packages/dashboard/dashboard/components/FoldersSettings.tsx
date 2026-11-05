import { useState } from 'react'
import { onFolders, sendStopSyncingPersonalFolder, sendSyncPersonalFolder, type FoldersView } from '../rpc/folders.js'
import { usePolled } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'
import { Input } from './ui/input.js'
import { SettingsRow, SettingsSection } from './SettingsRows.js'

/** The Settings entry's id. */
export const FOLDERS_ENTRY = 'folders'

/** Read again this often while the page is open: a sync of another computer's lands in the folder on its own. */
const EVERY_MS = 10_000

/**
 * Settings › Folders: where the agents' records are kept. The person's own folder, which may sync
 * with a repository of theirs so each of their computers has the same records, and the projects
 * shared on their own repository's branch instead.
 */
export function FoldersSettings() {
  const { value: folders, reload } = usePolled<FoldersView | null>(onFolders, null, EVERY_MS, [])
  const [asking, setAsking] = useState(false)
  const [address, setAddress] = useState('')
  const { busy, error, reset, run } = useAction()
  if (!folders) return null
  const { personal, shared } = folders

  const sync = () =>
    void run(() => sendSyncPersonalFolder(address), 'Could not sync with that repository.').then(async outcome => {
      if (!outcome.ok) return
      setAsking(false)
      setAddress('')
      await reload()
    })
  const stop = () =>
    void run(() => sendStopSyncingPersonalFolder(), 'Could not stop syncing.').then(async outcome => {
      if (outcome.ok) await reload()
    })

  const holds = personal.projects.length > 0 ? ` · ${personal.projects.join(', ')}` : ''
  const where = personal.remote
    ? `Synced with ${personal.remote}.${personal.unsent > 0 ? ` ${personal.unsent} ${personal.unsent === 1 ? 'change' : 'changes'} not sent yet.` : ''}`
    : 'Only on this computer.'

  return (
    <SettingsSection description="Where your agents' records are kept: what each agent was asked and answered, the tickets and the queue.">
      <div className="py-3 first:pt-0 last:pb-0">
        <SettingsRow
          label="Your folder"
          description={`${personal.path}${holds}. ${where}`}
          control={
            personal.remote ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={stop}>
                Stop syncing
              </Button>
            ) : (
              !asking && (
                <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
                  Sync with a repository
                </Button>
              )
            )
          }
        />
        {asking && !personal.remote && (
          <form
            className="mt-3 space-y-2"
            onSubmit={event => {
              event.preventDefault()
              sync()
            }}
          >
            <p className="text-xs text-muted-foreground">
              Make an empty private repository, then paste its address. Each of your computers that syncs with the same one has the same
              records.
            </p>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Repository address"
                placeholder="github.com/you/agent"
                value={address}
                autoFocus
                disabled={busy}
                onChange={event => {
                  setAddress(event.target.value)
                  reset()
                }}
                className="h-8"
              />
              <Button type="submit" size="sm" disabled={busy || address.trim() === ''}>
                {busy ? 'Syncing…' : 'Sync'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setAsking(false)
                  setAddress('')
                  reset()
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>
      {shared.length > 0 && (
        <SettingsRow
          label="Shared on their own repository"
          description={`${shared.join(', ')} · on the branch agent-data. Change it in the project's menu.`}
          control={null}
        />
      )}
    </SettingsSection>
  )
}
