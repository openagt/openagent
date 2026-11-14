import { useState } from 'react'
import { X } from 'lucide-react'
import { onRepoSources, sendAddRepoOwner, sendRemoveRepoFolder, sendRemoveRepoOwner, type RepoSources } from '../rpc/projects.js'
import { useLoaded } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'
import { Input } from './ui/input.js'
import { List, Row } from './ui/list.js'
import { Section } from './ui/section.js'
import { Separator } from './ui/separator.js'
import { PathStrip } from './PathStrip.js'
import { SettingsRowShapes, SettingsSection } from './SettingsRows.js'
import { Slot } from './ui/slot.js'

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
  // `undefined` is not read yet; a read that fails is `null`. A read again after a change keeps the lists in place.
  const sources = useLoaded<RepoSources | null | undefined>(() => onRepoSources().catch(() => null), undefined, [read], 'previous')
  return (
    <Slot of={{ value: sources, state: sources === undefined ? 'unknown' : 'fresh' }} shape={<SettingsRowShapes />}>
      {sources =>
        sources ? (
          <Sources sources={sources} onChanged={() => setRead(k => k + 1)} />
        ) : (
          <p role="alert" className="text-sm text-danger">
            Where the picker looks could not be read.
          </p>
        )
      }
    </Slot>
  )
}

/** The users and organizations named, and the folders added, with the presses that change them. */
function Sources({ sources, onChanged }: { sources: RepoSources; onChanged: () => void }) {
  const [owner, setOwner] = useState('')
  const { busy, error, reset, run } = useAction()
  const again = (outcome: { ok: boolean }) => {
    if (outcome.ok) onChanged()
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
      <div className="flex flex-col gap-6">
        <Section title="GitHub users and organizations">
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Their repos are listed in the picker, read as the GitHub account runs use; picked, one is cloned. The same on each of your computers.</p>
            {sources.owners.length > 0 && (
              <List boxed aria-label="GitHub users and organizations">
                {sources.owners.map(name => (
                  <Row
                    key={name}
                    title={name.replace(/^github\.com\//, '')}
                    actions={
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} disabled={busy} onClick={() => removeOwner(name)}>
                        <X className="size-4" aria-hidden />
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
                className="w-60 max-md:flex-1"
              />
              <Button type="submit" variant="secondary" disabled={!owner.trim()} loading={busy}>
                Add
              </Button>
            </form>
          </div>
        </Section>
        <Separator className="bg-hairline" />
        <Section title="Folders searched on this computer">
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Your home folder, and the folders added with &ldquo;Search another folder&hellip;&rdquo; in the picker.</p>
            {sources.folders.length > 0 ? (
              <List boxed aria-label="Folders searched">
                {sources.folders.map(folder => (
                  <Row
                    key={folder}
                    title={<PathStrip path={folder} />}
                    actions={
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${folder}`} disabled={busy} onClick={() => removeFolder(folder)}>
                        <X className="size-4" aria-hidden />
                      </Button>
                    }
                  />
                ))}
              </List>
            ) : (
              <p className="text-sm text-muted-foreground">No folder added yet: only your home folder is searched.</p>
            )}
          </div>
        </Section>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </SettingsSection>
  )
}
