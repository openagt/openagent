import { useEffect, useId, useRef, useState, type FormEvent, type Ref } from 'react'
import { Ellipsis, Loader2, Plus } from 'lucide-react'
import { onProfilesList, sendRemoveProfile, sendSaveProfile, type Profile, type ProfileAccountChoice, type ProfilesView, type RunOptions } from '../rpc/profiles.js'
import { DEFAULT_PROFILE } from '../../src/client.js'
import { holdEntry } from '../lib/use-route.js'
import { usePolled, type ReadState } from '../lib/use-async.js'
import { useAddGitAccount } from './AddGitAccount.js'
import { Button } from './ui/button.js'
import { Panel, PanelRow } from './ui/panel.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { useIsMobile } from '../lib/use-mobile.js'
import { Checkbox } from './ui/checkbox.js'
import { ConfirmDialog } from './ui/confirm-dialog.js'
import { Dialog } from './ui/dialog.js'
import { Input } from './ui/input.js'
import { Label } from './ui/label.js'
import { Page } from './Page.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js'
import { PanelShape, Slot } from './ui/slot.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import { cn } from '../lib/utils.js'
import { inWords } from '../lib/in-words.js'

// The Agent profiles page (#2394): a profile is a name and a saved set of run options, made once
// and used in any project or none. One row per profile, Default first, each edited in a dialog over
// the page: its name, its accounts among the ones the Permissions page knows, the plugins its runs
// go without, and whether they get the project's own skills. The profiles are kept with the person,
// through the store, so every computer of theirs has them; a computer without an account a profile
// names runs it without that account.

/** How often the profiles are read again while the page is open. */
const SELDOM_MS = 30_000

/**
 * The profiles as the dashboard reads them, remembered across pages and loads so a menu lands
 * whole and the box's row that names the profile is drawn from the first frame.
 */
export function useProfilesList(): { view: ProfilesView | undefined; state: ReadState; failing: boolean; reload: () => Promise<void> } {
  const { value, state, failing, reload } = usePolled<ProfilesView | undefined>(onProfilesList, undefined, SELDOM_MS, [], { remember: 'profiles', stored: true })
  return { view: value, state, failing, reload }
}

/** A profile's name by its id, once the profiles are read; the id itself for one this computer does not have; nothing for none. */
export function useProfileName(id: string | undefined): string | undefined {
  const { view } = useProfilesList()
  if (id === undefined || !view) return undefined
  return view.profiles.find(profile => profile.id === id)?.name ?? id
}

/** Which of the project's own skills a profile's runs get: every one when absent. */
type ProjectPick = NonNullable<RunOptions['skills']>['project']

/** What the editor holds: the profile as it stands, or a new one. */
interface Draft {
  id?: string
  name: string
  github?: string | undefined
  claude: Set<string>
  codex: Set<string>
  /** The plugins its runs go without. */
  without: Set<string>
  project?: ProjectPick
}

function draftOf(profile?: Profile): Draft {
  const options = profile?.options ?? {}
  const project = options.skills?.project
  return {
    ...(profile ? { id: profile.id } : {}),
    name: profile?.name ?? '',
    ...(options.github?.account !== undefined ? { github: options.github.account } : {}),
    claude: new Set(options['agent-driver']?.claude ?? []),
    codex: new Set(options['agent-driver']?.codex ?? []),
    without: new Set(options.plugins?.without ?? []),
    ...(project !== undefined ? { project } : {}),
  }
}

/** The run options a draft holds; of the plugins it goes without, the ones a run can get anything from (`plugins`). */
function optionsOf(draft: Draft, plugins: readonly string[]): RunOptions {
  const without = plugins.filter(name => draft.without.has(name))
  return {
    ...(draft.github !== undefined ? { github: { account: draft.github } } : {}),
    ...(draft.claude.size > 0 || draft.codex.size > 0 ? { 'agent-driver': { ...(draft.claude.size > 0 ? { claude: [...draft.claude] } : {}), ...(draft.codex.size > 0 ? { codex: [...draft.codex] } : {}) } } : {}),
    ...(draft.project !== undefined ? { skills: { project: draft.project } } : {}),
    ...(without.length > 0 ? { plugins: { without } } : {}),
  }
}

/** Whether two drafts hold the same profile. */
function sameDraft(a: Draft, b: Draft): boolean {
  const same = (x: Set<string>, y: Set<string>) => x.size === y.size && [...x].every(one => y.has(one))
  return a.name === b.name && a.github === b.github && JSON.stringify(a.project) === JSON.stringify(b.project) && same(a.claude, b.claude) && same(a.codex, b.codex) && same(a.without, b.without)
}

/** What a profile says of the project's own skills, in a few words. */
function projectSaid(project: ProjectPick): string {
  return project === undefined || project === 'all' ? 'every project skill' : project === 'none' ? 'no project skills' : `the project skills ${project.join(', ')}`
}

/** The Agent profiles page. */
export function ProfilesPage() {
  const { view, state, failing, reload } = useProfilesList()
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
    if (removed.current === undefined || view?.profiles.some(profile => profile.id === removed.current)) return
    removed.current = undefined
    newProfile.current?.focus()
  }, [view])
  const changed = reload
  return (
    <Page
      title="Agent profiles"
      description="An agent profile is a name and a saved set of run options: the accounts a run works as, the plugins it goes without, and the project skills it gets. Pick one from the gear under the message box; it works in any project, or in none."
      actions={
        <Button ref={newProfile} disabled={!view || adding} onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          New profile
        </Button>
      }
    >
      <Slot of={{ state, value: view, failing }} shape={<PanelShape />}>
        {view =>
          view && (
            <Panel aria-label="Profiles">
              {view.profiles.map(profile => (
                <ProfileRow key={profile.id} profile={profile} view={view} onChanged={changed} onRemoved={() => void (removed.current = profile.id)} {...(profile.id === made.current ? { editRef: madeEdit } : {})} />
              ))}
            </Panel>
          )
        }
      </Slot>
      {/* Over the page, so it opens at the press even while the list's shape still holds. */}
      {adding && view && <ProfileEditor view={view} onAccounts={reload} onDone={async saved => (setAdding(false), saved ? ((made.current = saved), changed()) : undefined)} />}
    </Page>
  )
}

/**
 * One profile, a row of the page's panel: its name (Default says it is used unless another is
 * picked), under it what its runs get (the accounts they work as, the plugins they go without, and
 * the project's own skills). Edit and Remove come under the pointer and the keyboard; on a phone
 * the row's one press is a menu of them. `onRemoved` is told before the list is read again without it.
 */
function ProfileRow({ profile, view, onChanged, onRemoved, editRef }: { profile: Profile; view: ProfilesView; onChanged: () => Promise<void>; onRemoved: () => void; editRef?: Ref<HTMLButtonElement> }) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const phone = useIsMobile()
  const isDefault = profile.id === DEFAULT_PROFILE
  const { github, 'agent-driver': driver, skills, plugins } = profile.options
  const said = projectSaid(skills?.project)
  const facts = [
    github?.account !== undefined ? `@${github.account} on GitHub` : 'GitHub: whatever the computer uses',
    ...(driver?.claude ? [`Claude: ${driver.claude.map(id => view.claude.find(account => account.id === id)?.name ?? id).join(', ')}`] : []),
    ...(driver?.codex ? [`Codex: ${driver.codex.map(id => view.codex.find(account => account.id === id)?.name ?? id).join(', ')}`] : []),
    ...(plugins?.without ? [`Without ${inWords(plugins.without)}`] : []),
    `${said.charAt(0).toUpperCase()}${said.slice(1)}`,
  ]
  return (
    <>
      <PanelRow
        title={
          <>
            {profile.name}
            {isDefault && <span className="font-normal text-muted-foreground"> used unless you pick another</span>}
          </>
        }
        titleHint={facts.join(' · ')}
        meta={facts}
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
            const done = await sendRemoveProfile(profile.id)
            if (!done.ok) throw new Error(done.error)
          }}
          onSuccess={() => {
            onRemoved()
            void onChanged()
          }}
        />
      )}
      {editing && <ProfileEditor profile={profile} view={view} onAccounts={onChanged} onDone={async saved => (setEditing(false), saved ? onChanged() : undefined)} />}
    </>
  )
}

/** No account of the profile's own, whatever the computer uses: the value of the select for a profile that names none. */
const COMPUTERS = ''

/**
 * A profile edited, or a new one, in a dialog over the page: the name, the accounts picked, the
 * plugins its runs go without, the project's own skills on or off; Save, or Enter in the name, writes it, and Cancel, Esc, the ✕, Back or a reload
 * ask first once something is changed. Its parts scroll under the title while Save
 * and Cancel stay in view, and a click beside it closes nothing: much is typed here. A GitHub
 * account OpenAgent does not have yet is added from here, in its own dialog over this one, and is
 * then the one picked; `onAccounts` reads the accounts again.
 */
function ProfileEditor({ profile, view, onAccounts, onDone }: { profile?: Profile; view: ProfilesView; onAccounts: () => Promise<void>; onDone: (savedId: string | undefined) => Promise<void> | void }) {
  // What is being typed is the editor's own from its first frame: the page reading the profiles again changes nothing in it.
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile))
  const opened = useRef(draft).current
  const changed = !sameDraft(draft, opened)
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
  const addingAccount = useAddGitAccount(async login => {
    setDraft(d => ({ ...d, github: login }))
    await onAccounts()
  })
  const isDefault = profile?.id === DEFAULT_PROFILE
  const tick = (set: 'claude' | 'codex' | 'without', name: string, on: boolean) =>
    setDraft(d => {
      const next = new Set(d[set])
      if (on) next.add(name)
      else next.delete(name)
      return { ...d, [set]: next }
    })
  const save = async () => {
    setBusy(true)
    setError(undefined)
    setNameRefused(false)
    try {
      const done = await sendSaveProfile({ ...(draft.id !== undefined ? { id: draft.id } : {}), name: draft.name, options: optionsOf(draft, view.plugins) })
      if (!done.ok) {
        setError(done.error)
        setNameRefused(done.field === 'name')
      } else await onDone(done.id)
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
  const githubItems = [{ value: COMPUTERS, label: 'None — whatever the computer uses' }, ...[...new Set([...(view.github?.accounts ?? []), ...(draft.github !== undefined ? [draft.github] : [])])].map(login => ({ value: login, label: `@${login}` }))]
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
            body="What you typed and ticked here is not saved."
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
        {isDefault && <p className="text-sm text-muted-foreground">Default keeps its name: it is the one a session is on unless you pick another.</p>}
        {/* Who it is first, its name and the account it pushes as side by side from a tablet up, then the
            coding agents' accounts it works with, then the plugins it goes without and the project's own skills. */}
        <div className="grid gap-x-4 gap-y-6 md:grid-cols-2">
          {!isDefault && (
            <div className="space-y-1.5">
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
          <div className="space-y-1.5">
            <Label htmlFor="profile-github">On GitHub as</Label>
            {/* The pick, and beside it a square of its height that adds an account: the block stays as
                short as the name's beside it. */}
            <div className="flex items-center gap-2">
              <Select items={githubItems} value={draft.github ?? COMPUTERS} onValueChange={next => setDraft(d => ({ ...d, ...(next ? { github: String(next) } : {}), ...(next ? {} : { github: undefined }) }))} disabled={busy}>
                <SelectTrigger id="profile-github" aria-label="GitHub account" className="min-w-0 grow basis-auto max-md:h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {githubItems.map(item => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {view.github && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button type="button" variant="secondary" size="icon" aria-label="Add account" disabled={busy} onClick={() => addingAccount.add(view.github!.host)} className="shrink-0 max-md:size-11" />
                    }
                  >
                    <Plus className="size-4" aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent>Add account</TooltipContent>
                </Tooltip>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Runs push and open pull requests as this account. An account this computer does not have refuses the start.</p>
            {addingAccount.dialog}
          </div>
        </div>
        <AccountPicks label="Claude" accounts={view.claude} picked={draft.claude} busy={busy} onTick={(id, on) => tick('claude', id, on)} onAll={() => setDraft(d => ({ ...d, claude: new Set() }))} />
        <AccountPicks label="Codex" accounts={view.codex} picked={draft.codex} busy={busy} onTick={(id, on) => tick('codex', id, on)} onAll={() => setDraft(d => ({ ...d, codex: new Set() }))} />
        {/* A plugin ticked off is one its runs go without. */}
        <PluginPicks plugins={view.plugins} without={draft.without} busy={busy} onTick={(name, on) => tick('without', name, !on)} />
        {/* A profile set to never pick up the project's own skills; a session can still pick them. */}
        <WordedTick
          name="Project skills"
          description={
            Array.isArray(draft.project)
              ? `Its sessions get ${projectSaid(draft.project)}. Off, a session starts without them and can still pick them from the gear under the box.`
              : 'The skills a project keeps in its repo go to this profile’s sessions too. Off, a session starts without them and can still pick them from the gear under the box.'
          }
          checked={draft.project !== 'none'}
          onChange={on =>
            setDraft(d => {
              const { project: _was, ...rest } = d
              return on ? rest : { ...rest, project: 'none' }
            })
          }
          disabled={busy}
        />
        {/* At the scroll's foot while more is under it: what is cut there fades out rather than ending on a line. */}
        <div aria-hidden className="pointer-events-none sticky bottom-0 -mt-6 h-4 bg-gradient-to-t from-card to-transparent" />
      </form>
    </Dialog>
  )
}

/**
 * A coding agent's accounts to pick from: "Every account, also new ones", ticked while none is picked, is every one of this computer's, also one added later; one or more ticked, those alone, where the computer has them.
 * This computer's own login, logged out, is offered only while it is picked, and says so.
 */
function AccountPicks({ label, accounts: all, picked, busy, onTick, onAll }: { label: string; accounts: readonly ProfileAccountChoice[]; picked: Set<string>; busy: boolean; onTick: (id: string, on: boolean) => void; onAll: () => void }) {
  const accounts = all.filter(account => !account.loggedOut || picked.has(account.id))
  if (accounts.length === 0) return null
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{`${label} accounts`}</legend>
      <div className="flex flex-wrap gap-3">
        {/* Left by ticking an account, as a radio is left by picking another. */}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={picked.size === 0} onCheckedChange={checked => checked === true && onAll()} disabled={busy} aria-label={`Every ${label} account, also new ones`} />
          Every account, also new ones
        </label>
        {accounts.map(account => {
          const name = account.loggedOut ? `${account.name}, not logged in` : account.name
          return (
            <label key={account.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={picked.has(account.id)} onCheckedChange={checked => onTick(account.id, checked === true)} disabled={busy} aria-label={`${label} account ${name}`} />
              {name}
            </label>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{picked.size === 0 ? `All of this computer's ${label} accounts, the next free one taking over at a limit.` : `Only these, where the computer the run goes to has them.`}</p>
    </fieldset>
  )
}

/**
 * The plugins a profile's sessions get, each ticked, where it is on in their project: one ticked off
 * is left out of them, none of its skills nor its steps, until a session ticks it on from the gear under the box.
 */
function PluginPicks({ plugins, without, busy, onTick }: { plugins: readonly string[]; without: Set<string>; busy: boolean; onTick: (name: string, on: boolean) => void }) {
  if (plugins.length === 0) return null
  const left = plugins.filter(name => without.has(name))
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">Plugins</legend>
      <div className="flex flex-wrap gap-3">
        {plugins.map(name => (
          <label key={name} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={!without.has(name)} onCheckedChange={checked => onTick(name, checked === true)} disabled={busy} aria-label={`Plugin ${name}`} />
            {name}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {left.length === 0
          ? 'Its sessions get every plugin on in their project. One ticked off is left out of them: none of its skills or steps.'
          : `Its sessions go without ${inWords(left)}: none of their skills or steps, even in a project where they are on. A session can still tick them on from the gear under the box.`}
      </p>
    </fieldset>
  )
}

/** A tick with its name, and its sentence under it in two lines, the whole of it on a press of those lines. No box around it. */
function WordedTick({ name, description, checked, onChange, disabled }: { name: string; description: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean | undefined }) {
  const [whole, setWhole] = useState(false)
  return (
    <div className="min-w-0">
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox checked={checked} onCheckedChange={next => onChange(next === true)} disabled={disabled} className="mt-0.5" aria-label={name} />
        <span className="min-w-0 text-sm font-medium">{name}</span>
      </label>
      {/* Under the name, on the edge its words start at: the box's 16 and the gap's 12. */}
      <div className="min-w-0 pl-7">
        <button
          type="button"
          aria-expanded={whole}
          onClick={() => setWhole(on => !on)}
          // 4 over and under its lines: its own box, since cut lines clip whatever reaches past them. Two lines
          // before the cut, the rest a press away.
          className={cn('focus-ring -my-1 block max-w-full rounded-sm py-1 text-left text-xs text-muted-foreground hover:text-foreground', !whole && 'line-clamp-2')}
        >
          {description}
        </button>
      </div>
    </div>
  )
}
