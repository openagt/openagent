import { useState } from 'react'
import { X } from 'lucide-react'
import { onRepoOwners, sendAddRepoOwner, sendRemoveRepoOwner } from '../rpc/projects.js'
import { useLoaded } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'
import { Input } from './ui/input.js'
import { Section } from './ui/section.js'
import { SettingsItem, SettingsItems, SettingsRowShapes, SettingsSection } from './SettingsRows.js'
import { Slot } from './ui/slot.js'

/** The Settings entry's id. */
export const REPO_OWNERS_ENTRY = 'repo-owners'

/**
 * Settings › Repos on GitHub: the GitHub users and organizations whose repos the project picker
 * lists besides the projects (Rom's design: "GitHub users/orgs, and the OA accounts' repos"), kept
 * in the person's own folder, the same on each computer. The folders searched on this computer are
 * the projects module's, in Settings › Repos.
 */
export function RepoOwnersSettings() {
  const [read, setRead] = useState(0)
  // `undefined` is not read yet; a read that fails is `null`. A read again after a change keeps the list in place.
  const owners = useLoaded<string[] | null | undefined>(() => onRepoOwners().catch(() => null), undefined, [read], 'previous')
  return (
    <Slot of={{ value: owners, state: owners === undefined ? 'unknown' : 'fresh' }} shape={<SettingsRowShapes />}>
      {owners =>
        owners ? (
          <Owners owners={owners} onChanged={() => setRead(k => k + 1)} />
        ) : (
          <p role="alert" className="text-sm text-danger">
            Where the picker looks could not be read.
          </p>
        )
      }
    </Slot>
  )
}

/** The users and organizations named, with the presses that change them. */
function Owners({ owners, onChanged }: { owners: string[]; onChanged: () => void }) {
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

  return (
    <SettingsSection description="Where the project picker finds repos at GitHub, besides your projects. OpenAgent's own GitHub accounts list their repos there too.">
      <div className="flex flex-col gap-8">
        <Section title="GitHub users and organizations">
          <div className="space-y-6">
            <p className="max-w-md text-xs text-faint-foreground">Their repos are listed in the picker, read as the GitHub account runs use; picked, one is cloned. The same on each of your computers.</p>
            {owners.length > 0 && (
              <SettingsItems aria-label="GitHub users and organizations">
                {owners.map(name => (
                  <SettingsItem
                    key={name}
                    title={name.replace(/^github\.com\//, '')}
                    actions={
                      <Button variant="ghost" size="icon-sm" className="-mr-1.5" aria-label={`Remove ${name}`} disabled={busy} onClick={() => removeOwner(name)}>
                        <X className="size-4" aria-hidden />
                      </Button>
                    }
                  />
                ))}
              </SettingsItems>
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
                className="w-60 max-md:h-11 max-md:flex-1"
              />
              <Button type="submit" variant="secondary" disabled={!owner.trim()} loading={busy} className="max-md:h-11">
                Add
              </Button>
            </form>
          </div>
        </Section>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </SettingsSection>
  )
}
