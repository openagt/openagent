import { useState } from 'react'
import { X } from 'lucide-react'
import { Button, Input, NO_PROJECT, Section, SettingsItem, SettingsItems, SettingsRowShapes, SettingsSection, Slot, useAction, useLoaded, useModuleHost } from '@openagt/ui/module'
import { server } from './calls.js'

// Settings › GitHub: the users and organizations on GitHub whose repositories the project picker
// lists beside the ones on this computer and OpenAgent's accounts' own (`composer.where`). They are
// kept in the person's own folder, the same on each computer.

export function RepoOwnersSettings() {
  const host = useModuleHost()
  const [read, setRead] = useState(0)
  // `undefined` is not read yet; a read that fails is `null`. A read again after a change keeps the list in place.
  const owners = useLoaded<string[] | null | undefined>(() => server(host).owners(NO_PROJECT, {}).catch(() => null), undefined, [read], 'previous')
  return (
    <Slot of={{ value: owners, state: owners === undefined ? 'unknown' : 'fresh' }} shape={<SettingsRowShapes />}>
      {owners =>
        owners ? (
          <Owners owners={owners} onChanged={() => setRead(k => k + 1)} />
        ) : (
          <p role="alert" className="text-sm text-danger">
            The users and organizations could not be read.
          </p>
        )
      }
    </Slot>
  )
}

/** The users and organizations named, with the presses that change them. */
function Owners({ owners, onChanged }: { owners: string[]; onChanged: () => void }) {
  const host = useModuleHost()
  const [owner, setOwner] = useState('')
  const { busy, error, reset, run } = useAction()
  const again = (outcome: { ok: boolean }) => {
    if (outcome.ok) onChanged()
    return outcome
  }
  const add = () =>
    void run(() => server(host).addRepoOwner(NO_PROJECT, { owner }), 'Could not add it.').then(outcome => {
      if (again(outcome).ok) setOwner('')
    })
  const remove = (name: string) => void run(() => server(host).removeRepoOwner(NO_PROJECT, { owner: name }), 'Could not remove it.').then(again)
  return (
    <SettingsSection description="Where the project picker finds repos on GitHub, besides your projects. OpenAgent's own GitHub accounts list their repos there too.">
      <Section title="GitHub users and organizations">
        <div className="space-y-6">
          <p className="max-w-md text-xs text-faint-foreground">Their repos are listed in the picker, read as the GitHub account runs use; picked, one is cloned. The same on each of your computers.</p>
          {owners.length > 0 && (
            <SettingsItems aria-label="GitHub users and organizations">
              {owners.map(name => (
                <SettingsItem
                  key={name}
                  title={name}
                  actions={
                    <Button variant="ghost" size="icon-sm" className="-mr-1.5" aria-label={`Remove ${name}`} disabled={busy} onClick={() => remove(name)}>
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
      {error && <p className="text-xs text-danger">{error}</p>}
    </SettingsSection>
  )
}
