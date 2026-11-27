import { useState } from 'react'
import { Avatar, Button, cn, Input, personChanged, SettingsRow, SettingsSection, useAction, useModuleHost, usePerson } from '@openagt/ui/module'
import { copyFromGitHub, removePicture, saveName } from './calls.js'

/**
 * Settings › Profile (Rom's design: the person's name and picture are OpenAgent's own, not a git
 * host's): the name the sidebar's foot shows, and their picture. Saved with the person, so each computer of theirs shows the same. "Sync from GitHub"
 * copies a GitHub profile's name and picture once, read with no login. What it shows is the
 * person as the shell reads them, the computer's name for them until they set their own.
 */
export function ProfileSettings() {
  const host = useModuleHost()
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
  // On a machine shared by a team: who signed in, as GitHub says, refreshed at each sign-in. Nothing to type here.
  if (person.team)
    return (
      <SettingsSection description="Your name and picture on this shared machine: your GitHub account’s, as of your sign-in.">
        <SettingsRow label="Name" description={person.login ? `Signed in with GitHub as @${person.login}.` : 'From your GitHub sign-in.'} control={<span className="text-sm">{person.name}</span>} />
        <SettingsRow label="Picture" description="From GitHub. It changes there, and here at your next sign-in." control={<Avatar person={person} size="h-8 w-8 text-xs" />} />
      </SettingsSection>
    )
  const name = typedName ?? person.name
  const github = typedGithub ?? person.login ?? ''

  const done = async (outcome: { ok: boolean }) => {
    if (!outcome.ok) return
    setName(undefined)
    setGithub(undefined)
    await reload()
    personChanged()
  }
  const save = () =>
    void saving.run(() => saveName(host, name), 'Could not save your name.').then(async outcome => {
      await done(outcome)
      setSavedName(outcome.ok)
    })
  const sync = () => {
    setSynced(undefined)
    void syncing.run(() => copyFromGitHub(host, github), 'Could not read that GitHub profile.').then(async outcome => {
      await done(outcome)
      if (outcome.ok) setSynced(outcome.value.changed ? `Name and picture copied from @${outcome.value.login}.` : `Already up to date with @${outcome.value.login}.`)
    })
  }
  const remove = () => void removing.run(() => removePicture(host), 'Could not remove the picture.').then(done)
  const changedName = name.trim() !== '' && (name.trim() !== person.name || !person.own)
  const nothingToSave = saving.busy || !changedName

  return (
    <SettingsSection description="Your name and picture in OpenAgent, the same on each of your computers.">
      <form
        onSubmit={event => {
          event.preventDefault()
          if (!nothingToSave) save()
        }}
      >
        <SettingsRow
          label="Name"
          labelFor="profile-name"
          description={person.own ? 'At the foot of the sidebar, and what the servers you join call you.' : 'Your git name for now. Save it, or type another, to keep one of your own.'}
          control={
            <div className="flex items-center gap-2">
              <Input
                id="profile-name"
                value={name}
                disabled={saving.busy}
                onChange={event => {
                  setName(event.target.value)
                  saving.reset()
                  setSavedName(false)
                }}
                className="w-60 max-md:flex-1"
              />
              {/* With nothing to save, it keeps the focus it was pressed with: a disabled press would drop it to the page. */}
              <Button type="submit" aria-disabled={!changedName || undefined} loading={saving.busy} className={cn('min-w-16', !changedName && 'opacity-50')}>
                {saving.busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          }
        />
        {saving.error && <p className="mt-2 text-xs text-danger">{saving.error}</p>}
        {savedName && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            Saved.
          </p>
        )}
      </form>
      <div>
        <SettingsRow
          label="Picture"
          description={person.avatar ? (person.login ? `From @${person.login} on GitHub.` : 'Yours.') : 'None: your initials.'}
          control={
            <div className="flex items-center gap-2">
              <Avatar person={person} size="h-8 w-8 text-xs" />
              {person.avatar && (
                <Button variant="secondary" loading={removing.busy} onClick={remove}>
                  Remove
                </Button>
              )}
            </div>
          }
        />
        {removing.error && <p className="mt-2 text-xs text-danger">{removing.error}</p>}
      </div>
      <form
        onSubmit={event => {
          event.preventDefault()
          if (github.trim()) sync()
        }}
      >
        <SettingsRow
          label="Sync from GitHub"
          labelFor="profile-github"
          description="Copies a GitHub profile’s name and picture, once. Read with no login; GitHub is not asked again after."
          control={
            <div className="flex items-center gap-2">
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
                className="w-60 max-md:flex-1"
              />
              <Button type="submit" variant="secondary" disabled={!github.trim()} loading={syncing.busy} className="min-w-16">
                {syncing.busy ? 'Syncing…' : 'Sync'}
              </Button>
            </div>
          }
        />
        {syncing.error && <p className="mt-2 text-xs text-danger">{syncing.error}</p>}
        {synced && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {synced}
          </p>
        )}
      </form>
    </SettingsSection>
  )
}
