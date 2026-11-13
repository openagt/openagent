import { useState } from 'react'
import { X } from 'lucide-react'
import { onRepoSources, sendAddRepoOwner, sendRemoveRepoFolder, sendRemoveRepoOwner, type RepoSources } from '../rpc/projects.js'
import { useLoaded } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'
import { Input } from './ui/input.js'
import { List, Row } from './ui/list.js'
import { SettingsSection } from './SettingsRows.js'

/** The Settings entry's id. */
export const REPO_SOURCES_ENTRY = 'repos'

/**
 * Settings › Repos: where the project picker finds repos besides the projects (Rom's design:
 * "repos crawled from the filesystem, plus added directories, GitHub users/orgs, and the OA
 * accounts' repos"). The users and organizations named here are kept in the person's own folder,
 * the same on each computer; the folders added are this computer's.
 */
export function RepoSourcesSettings() {
  const [read, setRead] = useState(0)
  const sources = useLoaded<RepoSources | null>(() => onRepoSources().catch(() => null), null, [read])
  const [owner, setOwner] = useState('')
  const { busy, error, reset, run } = useAction()
  if (!sources) return null
  const again = (outcome: { ok: boolean }) => {
    if (outcome.ok) setRead(k => k + 1)
    return outcome
  }

  const add = () =>
    void run(() => sendAddRepoOwner(owner), 'Could not add it.').then(outcome => {
      if (again(outcome).ok) setOwner('')
    })
  const removeOwner = (name: string) => void run(() => sendRemoveRepoOwner(name), 'Could not remove it.').then(again)
  const removeFolder = (folder: string) => void run(() => sendRemoveRepoFolder(folder), 'Could not remove it.').then(again)

  return (
    <SettingsSection description="Where the project picker finds repos, besides your projects. OpenAgent's own GitHub accounts list their repos there too.">
      <div className="space-y-2 py-3 first:pt-0">
        <p className="text-sm">GitHub users and organizations</p>
        <p className="text-xs text-muted-foreground">Their repos are listed in the picker, read as the GitHub account runs use; picked, one is cloned. The same on each of your computers.</p>
        {sources.owners.length > 0 && (
          <List aria-label="GitHub users and organizations">
            {sources.owners.map(name => (
              <Row
                key={name}
                title={name.replace(/^github\.com\//, '')}
                actions={
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} disabled={busy} onClick={() => removeOwner(name)}>
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                }
              />
            ))}
          </List>
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={event => {
            event.preventDefault()
            if (owner.trim()) add()
          }}
        >
          <Input
            name="github-owner"
            aria-label="GitHub user or organization"
            placeholder="user or organization"
            value={owner}
            disabled={busy}
            onChange={event => {
              setOwner(event.target.value)
              reset()
            }}
            className="h-8 max-w-xs"
          />
          <Button type="submit" variant="outline" disabled={busy || !owner.trim()}>
            Add
          </Button>
        </form>
      </div>
      <div className="space-y-2 py-3 last:pb-0">
        <p className="text-sm">Folders searched on this computer</p>
        <p className="text-xs text-muted-foreground">Your home folder, and the folders added with &ldquo;Search another folder&hellip;&rdquo; in the picker.</p>
        {sources.folders.length > 0 && (
          <List aria-label="Folders searched">
            {sources.folders.map(folder => (
              <Row
                key={folder}
                title={folder}
                actions={
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${folder}`} disabled={busy} onClick={() => removeFolder(folder)}>
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                }
              />
            ))}
          </List>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </SettingsSection>
  )
}
