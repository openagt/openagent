import { useEffect, useId, useRef, useState, type FormEvent, type Ref } from 'react'
import { Ellipsis, Loader2, Plus } from 'lucide-react'
import { onAgentLogins, onAgentsList, sendCopyAgentLogins, sendRemoveAgent, sendSaveAgent, type AgentAccountChoice, type AgentLoginsOn, type AgentRecord, type AgentsView } from '../rpc/agents.js'
import { DEFAULT_AGENT } from '../../src/client.js'
import { holdEntry } from '../lib/use-route.js'
import { usePolled, type ReadState } from '../lib/use-async.js'
import { useAddGitAccount } from './AddGitAccount.js'
import { Button } from './ui/button.js'
import { Panel, PanelRow } from './ui/panel.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { useIsMobile } from '../lib/use-mobile.js'
import { Section } from './ui/section.js'
import { Checkbox } from './ui/checkbox.js'
import { SKILL_TICKS_CLASS, SkillTick } from './ProjectSkills.js'
import { ConfirmDialog } from './ui/confirm-dialog.js'
import { Dialog } from './ui/dialog.js'
import { Input } from './ui/input.js'
import { Label } from './ui/label.js'
import { Page } from './Page.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js'
import { RowShapes, Slot } from './ui/slot.js'

// The Agents page (Rom's design): an agent is a name, a set of skills and a set of accounts, made
// once and used in any project or none. One row per agent, the default first, each edited in a
// dialog over the page: its name, its skills ticked from the list the Skills page has (and the two every agent
// starts with), and its accounts among the ones the Permissions page knows. The agents are kept
// in the person's folder (~/.openagent), so every computer that syncs it has them; a computer
// without an account an agent names runs the agent without it.

/** How often the agents are read again while the page is open. */
const SELDOM_MS = 30_000

/**
 * The agents (a name, skills and accounts each) as the dashboard reads them, remembered across
 * pages and loads so a menu lands whole and the box's rows, which name the agent and count its
 * skills, are drawn from the first frame.
 */
export function useAgentsList(): { view: AgentsView | undefined; state: ReadState; failing: boolean; reload: () => Promise<void> } {
  const { value, state, failing, reload } = usePolled<AgentsView | undefined>(onAgentsList, undefined, SELDOM_MS, [], { remember: 'agents', stored: true })
  return { view: value, state, failing, reload }
}

/** How often the devices are asked how the agents' GitHub accounts stand there. */
const DEVICES_MS = 15_000

/** How the agents' GitHub accounts stand on each device of the person's. */
function useAgentLogins(): { devices: AgentLoginsOn[] | undefined; reload: () => Promise<void> } {
  const { value, reload } = usePolled<AgentLoginsOn[] | undefined>(onAgentLogins, undefined, DEVICES_MS, [], 'previous')
  return { devices: value, reload }
}

/** An agent's name by its id, once the agents are read; the id itself for one this computer does not have; nothing for none. */
export function useAgentName(id: string | undefined): string | undefined {
  const { view } = useAgentsList()
  if (id === undefined || !view) return undefined
  return view.agents.find(agent => agent.id === id)?.name ?? id
}

/** What the editor holds: the agent as it stands, or a new one. */
interface Draft {
  id?: string
  name: string
  skills: Set<string>
  github?: string | undefined
  claude: Set<string>
  codex: Set<string>
  projectSkills: boolean
}

function draftOf(agent?: AgentRecord): Draft {
  return { ...(agent ? { id: agent.id } : {}), name: agent?.name ?? '', skills: new Set(agent?.skills ?? ['ask', 'github']), ...(agent?.accounts.github !== undefined ? { github: agent.accounts.github } : {}), claude: new Set(agent?.accounts.claude ?? []), codex: new Set(agent?.accounts.codex ?? []), projectSkills: agent?.projectSkills ?? true }
}

/** Whether two drafts hold the same agent. */
function sameDraft(a: Draft, b: Draft): boolean {
  const same = (x: Set<string>, y: Set<string>) => x.size === y.size && [...x].every(one => y.has(one))
  return a.name === b.name && a.github === b.github && a.projectSkills === b.projectSkills && same(a.skills, b.skills) && same(a.claude, b.claude) && same(a.codex, b.codex)
}

/** The Agents page. */
export function AgentsPage() {
  const { view, state, failing, reload } = useAgentsList()
  const { devices, reload: reloadDevices } = useAgentLogins()
  const [adding, setAdding] = useState(false)
  const newAgent = useRef<HTMLButtonElement>(null)
  // The agent just removed: once the list is read without it, its Remove press is gone with its card, and the focus goes to "New agent".
  const removed = useRef<string | undefined>(undefined)
  // The agent just made: once the list is read with it, the focus goes to its row's Edit (on a phone its menu).
  const made = useRef<string | undefined>(undefined)
  const madeEdit = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (made.current !== undefined && madeEdit.current) {
      made.current = undefined
      madeEdit.current.focus()
    }
    if (removed.current === undefined || view?.agents.some(agent => agent.id === removed.current)) return
    removed.current = undefined
    newAgent.current?.focus()
  }, [view])
  const changed = async () => {
    await reload()
    await reloadDevices()
  }
  return (
    <Page
      title="Agents"
      description="An agent is a name, a set of skills and a set of accounts. Pick one under the message box; it works in any project, or in none."
      actions={
        <Button ref={newAgent} disabled={!view || adding} onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          New agent
        </Button>
      }
    >
      <Slot of={{ state, value: view, failing }} shape={<RowShapes />}>
        {view =>
          view && (
            <Panel aria-label="Agents">
              {view.agents.map(agent => (
                <AgentRow key={agent.id} agent={agent} view={view} devices={devices} onChanged={changed} onRemoved={() => void (removed.current = agent.id)} {...(agent.id === made.current ? { editRef: madeEdit } : {})} />
              ))}
            </Panel>
          )
        }
      </Slot>
      {/* Over the page, so it opens at the press even while the list's shape still holds. */}
      {adding && view && <AgentEditor view={view} onAccounts={reload} onDone={async saved => (setAdding(false), saved ? ((made.current = saved), changed()) : undefined)} />}
    </Page>
  )
}

/**
 * One agent, a row of the page's panel: its name (the default says it is used unless another is
 * picked), under it what it starts with (its skills and the accounts it works as), then a line of its
 * own for each skill every agent starts with that it goes without, and one that says where its GitHub
 * account is, device by device, a device it could not be copied to in the warning colour with why.
 * Edit and Remove come under the pointer and the keyboard, and "Copy again" beside them where a copy
 * failed; on a phone the row's one press is a menu of them.
 * `onRemoved` is told before the list is read again without it.
 */
function AgentRow({ agent, view, devices, onChanged, onRemoved, editRef }: { agent: AgentRecord; view: AgentsView; devices: AgentLoginsOn[] | undefined; onChanged: () => Promise<void>; onRemoved: () => void; editRef?: Ref<HTMLButtonElement> }) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const phone = useIsMobile()
  const isDefault = agent.id === DEFAULT_AGENT
  // What a skill every agent starts with does is what this one goes without: the skill's own line says it.
  const without = (view.skills[0]?.skills ?? []).filter(skill => !agent.skills.includes(skill.name))
  const facts = [
    `${agent.skills.length === 0 ? 'No skills' : agent.skills.join(', ')}${agent.projectSkills ? '' : ', no project skills'}`,
    agent.accounts.github !== undefined ? `@${agent.accounts.github} on GitHub` : 'GitHub: whatever the computer uses',
    ...(agent.accounts.claude ? [`Claude: ${agent.accounts.claude.map(id => view.claude.find(account => account.id === id)?.name ?? id).join(', ')}`] : []),
    ...(agent.accounts.codex ? [`Codex: ${agent.accounts.codex.map(id => view.codex.find(account => account.id === id)?.name ?? id).join(', ')}`] : []),
  ]
  const login = agent.accounts.github
  const where = login !== undefined && devices && devices.length > 0 ? devices : undefined
  const failed = where?.some(device => device.reachable && device.github[login!]?.state === 'failed') ?? false
  const copy = useCopyAgain(onChanged)
  const under = (without.length > 0 || where !== undefined) && (
    <>
      {without.map(skill => (
        <span key={skill.name} className="block text-faint-foreground">{`Without ${skill.name}, which every agent starts with. ${skill.description}`}</span>
      ))}
      {where !== undefined && <OnDevices login={login!} devices={where} />}
      {copy.error !== undefined && (
        <span role="alert" className="block text-danger">
          {copy.error}
        </span>
      )}
    </>
  )
  return (
    <>
      <PanelRow
        title={
          <>
            {agent.name}
            {isDefault && <span className="font-normal text-muted-foreground"> used unless you pick another</span>}
          </>
        }
        titleHint={facts.join(' · ')}
        meta={facts}
        {...(under ? { under } : {})}
        actions={
          phone ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button ref={editRef} variant="ghost" size="icon-sm" aria-label={`More for ${agent.name}`} className="-mr-1.5" />}>
                <Ellipsis className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditing(true)}>Edit</DropdownMenuItem>
                {failed && (
                  <DropdownMenuItem disabled={copy.busy} onClick={copy.run}>
                    Copy again
                  </DropdownMenuItem>
                )}
                {!isDefault && <DropdownMenuItem onClick={() => setRemoving(true)}>Remove</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              {failed && (
                <Button size="sm" variant="ghost" loading={copy.busy} onClick={copy.run}>
                  Copy again
                </Button>
              )}
              <Button ref={editRef} size="sm" variant="secondary" aria-label={`Edit ${agent.name}`} onClick={() => setEditing(true)}>
                Edit
              </Button>
              {/* Unpainted at the row's end: pulled out by its own padding, its word ends on the inset. */}
              {!isDefault && (
                <Button size="sm" variant="ghost" className="-mr-2 hover:text-danger" aria-label={`Remove ${agent.name}`} onClick={() => setRemoving(true)}>
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
          title={`Remove ${agent.name}?`}
          body="Sessions that ran on it keep their records. Nothing is removed from any account."
          confirmLabel="Remove"
          onConfirm={async () => {
            const done = await sendRemoveAgent(agent.id)
            if (!done.ok) throw new Error(done.error)
          }}
          onSuccess={() => {
            onRemoved()
            void onChanged()
          }}
        />
      )}
      {editing && <AgentEditor agent={agent} view={view} onAccounts={onChanged} onDone={async saved => (setEditing(false), saved ? onChanged() : undefined)} />}
    </>
  )
}

/**
 * Where an agent's GitHub account is: one line, a device after another, as the last copy left it. The
 * account goes to every device by itself when the agent is saved and every minute after, so a device
 * it could not reach is the one said in the warning colour, with why.
 */
function OnDevices({ login, devices }: { login: string; devices: AgentLoginsOn[] }) {
  return (
    <ul aria-label={`Where @${login} is`} className="flex flex-wrap gap-x-1.5 text-faint-foreground">
      {devices.map(device => {
        const on = device.github[login]
        return (
          <li key={device.machineId} className="not-first:before:mr-1.5 not-first:before:content-['·']">
            {!device.reachable ? (
              `${device.label}: not reached`
            ) : on?.state === 'there' ? (
              `On ${device.label}`
            ) : on?.state === 'failed' ? (
              <span className="text-warning">{`${device.label}: not copied — ${on.error ?? 'it did not take it'}`}</span>
            ) : (
              `${device.label}: not copied yet`
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** "Copy again": the agents' GitHub accounts sent to every device once more, then the list read again; why it failed, when it did. */
function useCopyAgain(onCopied: () => Promise<void>): { busy: boolean; error: string | undefined; run: () => void } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const run = (): void => {
    setBusy(true)
    setError(undefined)
    void (async () => {
      try {
        const done = await sendCopyAgentLogins()
        if (!done.ok) setError(done.error)
        await onCopied()
      } finally {
        setBusy(false)
      }
    })()
  }
  return { busy, error, run }
}

/** No account of the agent's own, whatever the computer uses: the value of the select for an agent that names none. */
const COMPUTERS = ''

/**
 * An agent edited, or a new one, in a dialog over the page: the name, the skills ticked, the
 * accounts picked; Save, or Enter in the name, writes it, and Cancel, Esc, the ✕, Back or a reload
 * ask first once something is changed. Its parts scroll under the title while Save
 * and Cancel stay in view, and a click beside it closes nothing: much is typed here. A GitHub
 * account OpenAgent does not have yet is added from here, in its own dialog over this one, and is
 * then the one picked; `onAccounts` reads the accounts again.
 */
function AgentEditor({ agent, view, onAccounts, onDone }: { agent?: AgentRecord; view: AgentsView; onAccounts: () => Promise<void>; onDone: (savedId: string | undefined) => Promise<void> | void }) {
  // What is being typed is the editor's own from its first frame: the page reading the agents again changes nothing in it.
  const [draft, setDraft] = useState<Draft>(() => draftOf(agent))
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
  const isDefault = agent?.id === DEFAULT_AGENT
  const tick = (set: 'skills' | 'claude' | 'codex', name: string, on: boolean) =>
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
      const done = await sendSaveAgent({
        ...(draft.id !== undefined ? { id: draft.id } : {}),
        name: draft.name,
        skills: [...draft.skills],
        accounts: { ...(draft.github !== undefined ? { github: draft.github } : {}), ...(draft.claude.size > 0 ? { claude: [...draft.claude] } : {}), ...(draft.codex.size > 0 ? { codex: [...draft.codex] } : {}) },
        projectSkills: draft.projectSkills,
      })
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
      title={agent ? `Editing ${agent.name}` : 'New agent'}
      footer={
        <div className="space-y-2">
          {error !== undefined && (
            <p id="agent-refused" role="alert" className="text-xs text-danger">
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
            title={agent ? `Discard your changes to ${agent.name}?` : 'Discard the new agent?'}
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
        {/* Who it is first, its name and the account it pushes as side by side from a tablet up, then the
            coding agents' accounts it works with, then what it knows: its skills. */}
        <div className="grid gap-x-4 gap-y-6 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              ref={nameField}
              value={draft.name}
              disabled={isDefault}
              readOnly={busy}
              placeholder="Social media"
              aria-invalid={nameMissing || nameRefused}
              {...(nameMissing ? { 'aria-describedby': 'agent-name-missing' } : nameRefused ? { 'aria-describedby': 'agent-refused' } : isDefault ? { 'aria-describedby': 'agent-name-kept' } : {})}
              onChange={event => {
                setNameMissing(false)
                setNameRefused(false)
                setDraft(d => ({ ...d, name: event.target.value }))
              }}
            />
            {nameMissing && (
              <p id="agent-name-missing" className="text-xs text-danger">
                Give the agent a name.
              </p>
            )}
            {isDefault && (
              <p id="agent-name-kept" className="text-xs text-muted-foreground">
                The default agent keeps its name: it is the one a session is on unless you pick another.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-github">On GitHub as</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Select items={githubItems} value={draft.github ?? COMPUTERS} onValueChange={next => setDraft(d => ({ ...d, ...(next ? { github: String(next) } : {}), ...(next ? {} : { github: undefined }) }))} disabled={busy}>
                <SelectTrigger id="agent-github" aria-label="GitHub account" className="min-w-0 grow basis-48">
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
                <Button type="button" variant="secondary" disabled={busy} onClick={() => addingAccount.add(view.github!.host)}>
                  <Plus className="size-4" aria-hidden />
                  Add account
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Runs push and open pull requests as this account. An account this computer does not have refuses the start.</p>
            {addingAccount.dialog}
          </div>
        </div>
        <AccountPicks label="Claude" accounts={view.claude} picked={draft.claude} busy={busy} onTick={(id, on) => tick('claude', id, on)} onAll={() => setDraft(d => ({ ...d, claude: new Set() }))} />
        <AccountPicks label="Codex" accounts={view.codex} picked={draft.codex} busy={busy} onTick={(id, on) => tick('codex', id, on)} onAll={() => setDraft(d => ({ ...d, codex: new Set() }))} />
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold">Skills</p>
            <p className="text-xs text-muted-foreground">In a project, every run also gets the branches skill: where its work goes.</p>
          </div>
          {view.skills.map(group => (
            <Section key={group.title} title={group.title}>
              <div className={SKILL_TICKS_CLASS}>
                {group.skills.map(skill => (
                  <SkillTick key={skill.name} brief name={skill.name} description={skill.description} checked={draft.skills.has(skill.name)} onChange={on => tick('skills', skill.name, on)} disabled={busy} />
                ))}
              </div>
            </Section>
          ))}
          {/* Rom's first level: an agent set to never pick up the project's own skills. A session can still pick them. */}
          <SkillTick
            brief
            name="Project skills"
            description="The skills a project keeps in its repo go to this agent’s sessions too. Off, a session starts without them and can still pick them under the box."
            checked={draft.projectSkills}
            onChange={on => setDraft(d => ({ ...d, projectSkills: on }))}
            disabled={busy}
          />
        </div>
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
function AccountPicks({ label, accounts: all, picked, busy, onTick, onAll }: { label: string; accounts: readonly AgentAccountChoice[]; picked: Set<string>; busy: boolean; onTick: (id: string, on: boolean) => void; onAll: () => void }) {
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
