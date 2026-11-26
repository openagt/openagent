import { useEffect, useId, useRef, useState, type FormEvent, type Ref } from 'react'
import { Ellipsis, Loader2, Plus } from 'lucide-react'
import {
  Button,
  ComposerControls,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Page,
  Panel,
  PanelRow,
  PanelShape,
  SetupRows,
  Slot,
  holdEntry,
  useControlsSaid,
  useIsMobile,
  useModuleHost,
  type ControlBox,
  type ModuleHost,
} from '@openagt/ui/module'
import { DEFAULT_PROFILE } from '@openagt/hooks'
import { removeProfile, saveProfile, useProfiles, type Profile, type RunOptions } from './calls.js'

// The Profiles page (#2394): a profile is a name and a saved set of run options, made once and used
// in any project or none. One row per profile, Default first, each edited in a dialog over the
// page: its name, and its run options as the message box's controls draw them, every module's
// (`composer.control`, `in: 'profile'`), so a profile can set whatever a module lets a run pick. The
// profiles are kept with the person, through the store, so every computer of theirs has them; a
// computer without what a profile names runs it without that.

/** The Profiles page. */
export function ProfilesPage() {
  const host = useModuleHost()
  const { read, state, failing, reload } = useProfiles(host)
  const [adding, setAdding] = useState(false)
  const newProfile = useRef<HTMLButtonElement>(null)
  // The profile just removed: once the list is read without it, its Remove press is gone with its card, and the focus goes to "New profile".
  const removed = useRef<string | undefined>(undefined)
  // The profile just made: once the list is read with it, the focus goes to its row's Edit (on a phone its menu).
  const made = useRef<string | undefined>(undefined)
  const madeEdit = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (made.current !== undefined && madeEdit.current) {
      made.current = undefined
      madeEdit.current.focus()
    }
    if (removed.current === undefined || read?.profiles.some(profile => profile.id === removed.current)) return
    removed.current = undefined
    newProfile.current?.focus()
  }, [read])
  return (
    <Page
      title="Profiles"
      description="An agent profile is a name and a saved set of run options: the accounts a run works as, the plugins it goes without, and the project skills it gets. Pick one from the gear under the message box; it works in any project, or in none."
      actions={
        <Button ref={newProfile} disabled={!read || adding} onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          New profile
        </Button>
      }
    >
      <Slot of={{ state, value: read, failing }} shape={<PanelShape />}>
        {read =>
          read && (
            <Panel aria-label="Profiles">
              {read.profiles.map(profile => (
                <ProfileRow key={profile.id} host={host} profile={profile} onChanged={reload} onRemoved={() => void (removed.current = profile.id)} {...(profile.id === made.current ? { editRef: madeEdit } : {})} />
              ))}
            </Panel>
          )
        }
      </Slot>
      {/* Over the page, so it opens at the press even while the list's shape still holds. */}
      {adding && read && <ProfileEditor host={host} onDone={async saved => (setAdding(false), saved ? ((made.current = saved), reload()) : undefined)} />}
    </Page>
  )
}

/**
 * What the message box's controls say of `options`, in a profile's editor, each in a few words:
 * the controls are drawn for it unseen, in a menu that never opens, and what they say is handed on.
 */
function OptionsSaid({ options, onSaid }: { options: RunOptions; onSaid: (key: string, said: { words: string } | undefined) => void }) {
  const box: ControlBox = { in: 'profile', options, onChange: () => {}, busy: true }
  return (
    <DropdownMenu open={false}>
      <DropdownMenuContent keepMounted>
        <ComposerControls at="setup" box={box} onSaid={onSaid} />
        <ComposerControls at="row" box={box} onSaid={onSaid} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * One profile, a row of the page's panel: its name (Default says it is used unless another is
 * picked), under it what its runs get, as the message box's controls say it. Edit and Remove come
 * under the pointer and the keyboard; on a phone the row's one press is a menu of them. `onRemoved`
 * is told before the list is read again without it.
 */
function ProfileRow({ host, profile, onChanged, onRemoved, editRef }: { host: ModuleHost; profile: Profile; onChanged: () => Promise<void>; onRemoved: () => void; editRef?: Ref<HTMLButtonElement> }) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const phone = useIsMobile()
  const isDefault = profile.id === DEFAULT_PROFILE
  const { said, onSaid } = useControlsSaid(JSON.stringify(profile.options))
  const facts = Object.values(said).map(one => one.words)
  return (
    <>
      <OptionsSaid options={profile.options} onSaid={onSaid} />
      <PanelRow
        title={
          <>
            {profile.name}
            {isDefault && <span className="font-normal text-muted-foreground"> used unless you pick another</span>}
          </>
        }
        {...(facts.length > 0 ? { titleHint: facts.join(' · '), meta: facts } : {})}
        actions={
          phone ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button ref={editRef} variant="ghost" size="icon-sm" aria-label={`More for ${profile.name}`} className="-mr-1.5" />}>
                <Ellipsis className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditing(true)}>Edit</DropdownMenuItem>
                {!isDefault && <DropdownMenuItem onClick={() => setRemoving(true)}>Remove</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button ref={editRef} size="sm" variant="secondary" aria-label={`Edit ${profile.name}`} onClick={() => setEditing(true)}>
                Edit
              </Button>
              {/* Unpainted at the row's end: pulled out by its own padding, its word ends on the inset. */}
              {!isDefault && (
                <Button size="sm" variant="ghost" className="-mr-2 hover:text-danger" aria-label={`Remove ${profile.name}`} onClick={() => setRemoving(true)}>
                  Remove
                </Button>
              )}
            </>
          )
        }
      />
      {!isDefault && (
        <ConfirmDialog
          open={removing}
          onOpenChange={setRemoving}
          title={`Remove ${profile.name}?`}
          body="Sessions that ran on it keep their records. Nothing is removed from any account."
          confirmLabel="Remove"
          onConfirm={async () => {
            const done = await removeProfile(host, profile.id)
            if (!done.ok) throw new Error(done.error)
          }}
          onSuccess={() => {
            onRemoved()
            void onChanged()
          }}
        />
      )}
      {editing && <ProfileEditor host={host} profile={profile} onDone={async saved => (setEditing(false), saved ? onChanged() : undefined)} />}
    </>
  )
}

/** What the editor holds: the profile as it stands, or a new one. */
interface Draft {
  id?: string
  name: string
  options: RunOptions
}

/**
 * A profile edited, or a new one, in a dialog over the page: its name, then its run options as the
 * message box's controls draw them, the gear's lines in a menu of their own and the row's beside
 * it, what they say of the profile under them. Save, or Enter in the name, writes it, and Cancel,
 * Esc, the ✕, Back or a reload ask first once something is changed. A click beside it closes
 * nothing: much is typed here.
 */
function ProfileEditor({ host, profile, onDone }: { host: ModuleHost; profile?: Profile; onDone: (savedId: string | undefined) => Promise<void> | void }) {
  // What is being typed is the editor's own from its first frame: the page reading the profiles again changes nothing in it.
  const [draft, setDraft] = useState<Draft>(() => ({ ...(profile ? { id: profile.id } : {}), name: profile?.name ?? '', options: profile?.options ?? {} }))
  const opened = useRef(draft).current
  const changed = draft.name !== opened.name || JSON.stringify(draft.options) !== JSON.stringify(opened.options)
  // Leaving what is changed asks first, and the step asked about waits here.
  const [leaving, setLeaving] = useState<(() => void) | undefined>()
  const release = useRef(() => {})
  useEffect(() => {
    if (!changed) return
    release.current = holdEntry(step => setLeaving(() => step))
    return release.current
  }, [changed])
  const close = () => (changed ? setLeaving(() => () => void onDone(undefined)) : void onDone(undefined))
  const nameField = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const formId = useId()
  const [nameMissing, setNameMissing] = useState(false)
  // The refusal said is the name's: the field is marked, and says it.
  const [nameRefused, setNameRefused] = useState(false)
  const isDefault = profile?.id === DEFAULT_PROFILE
  const box: ControlBox = { in: 'profile', options: draft.options, onChange: options => setDraft(d => ({ ...d, options })), busy }
  const save = async () => {
    setBusy(true)
    setError(undefined)
    setNameRefused(false)
    try {
      const done = await saveProfile(host, { ...(draft.id !== undefined ? { id: draft.id } : {}), name: draft.name, options: draft.options })
      if (!done.ok) {
        setError(done.error)
        setNameRefused(done.field === 'name')
      } else {
        release.current()
        await onDone(done.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (draft.name.trim()) return void save()
    setNameMissing(true)
    nameField.current?.focus()
  }
  return (
    <Dialog
      open
      wide
      keepOnOutsidePress
      initialFocus={nameField}
      onOpenChange={open => {
        if (!open && !busy) close()
      }}
      title={profile ? `Editing ${profile.name}` : 'New profile'}
      footer={
        <div className="space-y-2">
          {error !== undefined && (
            <p id="profile-refused" role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
          <ConfirmDialog
            open={leaving !== undefined}
            onOpenChange={open => !open && setLeaving(undefined)}
            title={profile ? `Discard your changes to ${profile.name}?` : 'Discard the new profile?'}
            body="What you typed and picked here is not saved."
            confirmLabel="Discard"
            onSuccess={() => {
              release.current()
              leaving?.()
            }}
          />
        </div>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-6 pb-1">
        {/* The default's name is the title's and stays: no field for it, the reason under the title. */}
        {isDefault ? (
          <p className="text-sm text-muted-foreground">Default keeps its name: it is the one a session is on unless you pick another.</p>
        ) : (
          <div className="space-y-1.5 md:max-w-sm">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              ref={nameField}
              value={draft.name}
              readOnly={busy}
              placeholder="Social media"
              // On a phone a finger's 44, as the foot's presses.
              className="max-md:h-11"
              aria-invalid={nameMissing || nameRefused}
              {...(nameMissing ? { 'aria-describedby': 'profile-name-missing' } : nameRefused ? { 'aria-describedby': 'profile-refused' } : {})}
              onChange={event => {
                setNameMissing(false)
                setNameRefused(false)
                setDraft(d => ({ ...d, name: event.target.value }))
              }}
            />
            {nameMissing && (
              <p id="profile-name-missing" className="text-xs text-danger">
                Give the profile a name.
              </p>
            )}
          </div>
        )}
        {/* Its run options as a form's rows (his pick A of three, 2026-11-26): the coding agent and its accounts, then the gear's lines, each its pick at the right. */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Its sessions</p>
          <SetupRows>
            <ComposerControls at="row" box={box} />
            <ComposerControls at="setup" box={box} />
          </SetupRows>
        </div>
      </form>
    </Dialog>
  )
}
