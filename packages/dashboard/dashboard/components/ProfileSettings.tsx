import { useState } from 'react'
import { sendRemovePersonPicture, sendSavePersonName, sendSyncPersonFromGitHub } from '../rpc/person.js'
import { personChanged, usePerson } from '../lib/use-person.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'
import { Input } from './ui/input.js'
import { Avatar } from './PersonMenu.js'
import { SettingsRow, SettingsSection } from './SettingsRows.js'

/** The Settings entry's id. */
export const PROFILE_ENTRY = 'profile'

/**
 * Settings › Profile (Rom's design: the person's name and picture are OpenAgent's own, not a git
 * host's): the name the sidebar's foot shows and the servers they join are told, and their
 * picture. Kept in their own folder, so each computer of theirs shows the same. "Sync from
 * GitHub" copies a GitHub profile's name and picture once, read with no login.
 */
export function ProfileSettings() {
  const { person, reload } = usePerson()
  // What the person typed; until they type, what is saved.
  const [typedName, setName] = useState<string | undefined>()
  const [typedGithub, setGithub] = useState<string | undefined>()
  const saving = useAction()
  const syncing = useAction()
  const removing = useAction()
  // What the last Sync did, said once it is done: a press that changed nothing still answers.
  const [synced, setSynced] = useState<string | undefined>()
  // The name just saved, said until it is typed into again.
  const [savedName, setSavedName] = useState(false)
  if (!person) return null
  const name = typedName ?? person.name
  const github = typedGithub ?? person.github ?? ''

  const done = async (outcome: { ok: boolean }) => {
    if (!outcome.ok) return
    setName(undefined)
    setGithub(undefined)
    await reload()
    personChanged()
  }
  const save = () =>
    void saving.run(() => sendSavePersonName(name), 'Could not save your name.').then(async outcome => {
      await done(outcome)
      setSavedName(outcome.ok)
    })
  const sync = () => {
    setSynced(undefined)
    void syncing.run(() => sendSyncPersonFromGitHub(github), 'Could not read that GitHub profile.').then(async outcome => {
      await done(outcome)
      if (outcome.ok) setSynced(outcome.value.changed ? `Name and picture copied from @${outcome.value.login}.` : `Already up to date with @${outcome.value.login}.`)
    })
  }
  const remove = () => void removing.run(() => sendRemovePersonPicture(), 'Could not remove the picture.').then(done)
  const changedName = name.trim() !== '' && (name.trim() !== person.name || !person.own)

  return (
    <SettingsSection description="Your name and picture in OpenAgent, the same on each of your computers.">
      <div className="py-3 first:pt-0">
        <form
          className="flex items-start justify-between gap-4"
          onSubmit={event => {
            event.preventDefault()
            if (changedName) save()
          }}
        >
          <div className="min-w-0">
            <label htmlFor="profile-name" className="text-sm">
              Name
            </label>
            <p className="text-xs text-muted-foreground">{person.own ? 'At the foot of the sidebar, and what the servers you join call you.' : 'Your git name for now. Save it, or type another, to keep one of your own.'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Input
              id="profile-name"
              value={name}
              disabled={saving.busy}
              onChange={event => {
                setName(event.target.value)
                saving.reset()
                setSavedName(false)
              }}
              className="h-8 w-48"
            />
            <Button type="submit" disabled={saving.busy || !changedName} className="min-w-16">
              {saving.busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
        {saving.error && <p className="mt-2 text-xs text-danger">{saving.error}</p>}
        {savedName && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            Saved.
          </p>
        )}
      </div>
      <SettingsRow
        label="Picture"
        description={person.avatar ? (person.github ? `From @${person.github} on GitHub.` : 'Yours.') : 'None: your initials.'}
        control={
          <div className="flex items-center gap-2">
            <Avatar person={person} size="h-8 w-8 text-xs" />
            {person.avatar && (
              <Button variant="outline" disabled={removing.busy} onClick={remove}>
                Remove
              </Button>
            )}
          </div>
        }
      />
      {removing.error && <p className="pb-3 text-xs text-danger">{removing.error}</p>}
      <div className="py-3 last:pb-0">
        <form
          className="flex items-start justify-between gap-4"
          onSubmit={event => {
            event.preventDefault()
            if (github.trim()) sync()
          }}
        >
          <div className="min-w-0">
            <label htmlFor="profile-github" className="text-sm">
              Sync from GitHub
            </label>
            <p className="text-xs text-muted-foreground">Copies a GitHub profile&rsquo;s name and picture, once. Read with no login; GitHub is not asked again after.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Input
              id="profile-github"
              placeholder="your GitHub login"
              value={github}
              disabled={syncing.busy}
              onChange={event => {
                setGithub(event.target.value)
                syncing.reset()
                setSynced(undefined)
              }}
              className="h-8 w-48"
            />
            <Button type="submit" variant="outline" disabled={syncing.busy || !github.trim()} className="min-w-16">
              {syncing.busy ? 'Syncing…' : 'Sync'}
            </Button>
          </div>
        </form>
        {syncing.error && <p className="mt-2 text-xs text-danger">{syncing.error}</p>}
        {synced && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {synced}
          </p>
        )}
      </div>
    </SettingsSection>
  )
}
