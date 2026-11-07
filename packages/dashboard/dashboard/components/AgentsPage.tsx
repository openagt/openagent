import { useEffect, useState } from 'react'
import { Bot, Check, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { onAgentLogins, onAgentsList, sendCopyAgentLogins, sendRemoveAgent, sendSaveAgent, type AgentLoginsOn, type AgentRecord, type AgentsView } from '../rpc/agents.js'
import { DEFAULT_AGENT } from '../../src/client.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { Checkbox } from './ui/checkbox.js'
import { ConfirmDialog } from './ui/confirm-dialog.js'
import { Input } from './ui/input.js'
import { Label } from './ui/label.js'
import { Page } from './Page.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js'
import { Skeleton } from './ui/skeleton.js'

// The Agents page (Rom's design): an agent is a name, a set of skills and a set of accounts, made
// once and used in any project or none. One card per agent, the default first, each edited in
// place: its name, its skills ticked from the list the Skills page has (and the two every agent
// starts with), and its accounts among the ones the Permissions page knows. The agents are kept
// in the person's folder (~/.openagent), so every computer that syncs it has them; a computer
// without an account an agent names runs the agent without it.

/** How often the agents are read again while the page is open. */
const SELDOM_MS = 30_000

/** The agents as the dashboard reads them, remembered across pages so a menu lands whole. */
export function useAgents(): { view: AgentsView | undefined; reload: () => Promise<void> } {
  const { value, reload } = usePolled<AgentsView | undefined>(onAgentsList, undefined, SELDOM_MS, [], { remember: 'agents' })
  return { view: value, reload }
}

/** How often the devices are asked how the agents' GitHub accounts stand there. */
const DEVICES_MS = 15_000

/** How the agents' GitHub accounts stand on each device of the person's. */
function useAgentLogins(): { devices: AgentLoginsOn[] | undefined; reload: () => Promise<void> } {
  const { value, reload } = usePolled<AgentLoginsOn[] | undefined>(onAgentLogins, undefined, DEVICES_MS, [], 'previous')
  return { devices: value, reload }
}

/** An agent's name by its id; the id itself for one this computer does not have; nothing for none. */
export function useAgentName(id: string | undefined): string | undefined {
  const { view } = useAgents()
  if (id === undefined) return undefined
  return view?.agents.find(agent => agent.id === id)?.name ?? id
}

/** What the editor holds: the agent as it stands, or a new one. */
interface Draft {
  id?: string
  name: string
  skills: Set<string>
  github?: string | undefined
  claude: Set<string>
  codex: Set<string>
}

function draftOf(agent?: AgentRecord): Draft {
  return { ...(agent ? { id: agent.id } : {}), name: agent?.name ?? '', skills: new Set(agent?.skills ?? ['ask', 'github']), ...(agent?.accounts.github !== undefined ? { github: agent.accounts.github } : {}), claude: new Set(agent?.accounts.claude ?? []), codex: new Set(agent?.accounts.codex ?? []) }
}

/** The Agents page. */
export function AgentsPage() {
  const { view, reload } = useAgents()
  const { devices, reload: reloadDevices } = useAgentLogins()
  const [adding, setAdding] = useState(false)
  const changed = async () => {
    await reload()
    await reloadDevices()
  }
  return (
    <Page
      title="Agents"
      description="An agent is a name, a set of skills and a set of accounts. Pick one under the message box; it works in any project, or in none."
      actions={
        <Button size="sm" disabled={!view || adding} onClick={() => setAdding(true)}>
          <Plus className="size-3.5" aria-hidden />
          New agent
        </Button>
      }
    >
      {!view ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="space-y-4">
          {adding && <AgentEditor view={view} onDone={async saved => (setAdding(false), saved ? changed() : undefined)} />}
          {view.agents.map(agent => (
            <AgentCard key={agent.id} agent={agent} view={view} devices={devices} onChanged={changed} />
          ))}
        </div>
      )}
    </Page>
  )
}

/** One agent: its name, skills and accounts, and the presses that edit or remove it. */
function AgentCard({ agent, view, devices, onChanged }: { agent: AgentRecord; view: AgentsView; devices: AgentLoginsOn[] | undefined; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const isDefault = agent.id === DEFAULT_AGENT
  if (editing) return <AgentEditor agent={agent} view={view} onDone={async saved => (setEditing(false), saved ? onChanged() : undefined)} />
  const accounts = [
    agent.accounts.github !== undefined ? `@${agent.accounts.github} on GitHub` : `GitHub: this computer's${view.github?.computer !== undefined ? ` (@${view.github.computer})` : ''}`,
    ...(agent.accounts.claude ? [`Claude: ${agent.accounts.claude.map(id => view.claude.find(account => account.id === id)?.name ?? id).join(', ')}`] : []),
    ...(agent.accounts.codex ? [`Codex: ${agent.accounts.codex.map(id => view.codex.find(account => account.id === id)?.name ?? id).join(', ')}`] : []),
  ]
  return (
    <Card role="region" aria-label={agent.name}>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <CardTitle className="min-w-0 flex-1 truncate text-base">{agent.name}</CardTitle>
        {isDefault && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">the agent a session is on unless you pick another</span>}
        <Button size="xs" variant="ghost" aria-label={`Edit ${agent.name}`} onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" aria-hidden />
          Edit
        </Button>
        {!isDefault && (
          <ConfirmDialog
            trigger={
              <Button size="xs" variant="ghost" className="hover:text-danger" aria-label={`Remove ${agent.name}`}>
                <Trash2 className="size-3.5" aria-hidden />
                Remove
              </Button>
            }
            title={`Remove ${agent.name}?`}
            body="Sessions that ran on it keep their records. Nothing is removed from any account."
            confirmLabel="Remove"
            onConfirm={async () => {
              const done = await sendRemoveAgent(agent.id)
              if (!done.ok) throw new Error(done.error)
            }}
            onSuccess={() => void onChanged()}
          />
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Skills:</span>
          {agent.skills.length === 0 ? (
            <span className="text-muted-foreground">none</span>
          ) : (
            agent.skills.map(skill => (
              <span key={skill} className="rounded-md border border-border px-1.5 py-0.5 text-xs">
                {skill}
              </span>
            ))
          )}
        </p>
        <p className="text-muted-foreground">{accounts.join(' · ')}</p>
        {agent.accounts.github !== undefined && devices && devices.length > 0 && <OnDevices login={agent.accounts.github} devices={devices} onCopied={onChanged} />}
      </CardContent>
    </Card>
  )
}

/**
 * Where an agent's GitHub account is: one line per device of the person's, as the last copy left
 * it. The account goes to every device by itself when the agent is saved and every minute after;
 * "Copy again" is for one that failed, with why.
 */
function OnDevices({ login, devices, onCopied }: { login: string; devices: AgentLoginsOn[]; onCopied: () => Promise<void> }) {
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const copy = async () => {
    setCopying(true)
    setError(undefined)
    try {
      const done = await sendCopyAgentLogins()
      if (!done.ok) setError(done.error)
      await onCopied()
    } finally {
      setCopying(false)
    }
  }
  const failed = devices.some(device => device.reachable && device.github[login]?.state === 'failed')
  return (
    <ul aria-label={`Where @${login} is`} className="space-y-0.5 text-xs">
      {devices.map(device => {
        const on = device.github[login]
        return (
          <li key={device.machineId} className="flex items-center gap-1.5">
            {!device.reachable ? (
              <span className="text-muted-foreground">{device.label}: not reached</span>
            ) : on?.state === 'there' ? (
              <>
                <Check className="size-3 text-success" aria-hidden />
                <span>on {device.label}</span>
              </>
            ) : on?.state === 'failed' ? (
              <span className="text-warning">{`${device.label}: not copied — ${on.error ?? 'it did not take it'}`}</span>
            ) : (
              <span className="text-muted-foreground">{device.label}: not copied yet</span>
            )}
          </li>
        )
      })}
      {failed && (
        <li>
          <Button size="xs" variant="ghost" className="-ml-2 font-normal" disabled={copying} onClick={() => void copy()}>
            {copying ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RefreshCw className="size-3" aria-hidden />}
            {copying ? 'Copying…' : 'Copy again'}
          </Button>
          {error !== undefined && (
            <span role="alert" className="ml-2 text-danger">
              {error}
            </span>
          )}
        </li>
      )}
    </ul>
  )
}

/** This computer's account at GitHub: the value of the select for an agent that names none. */
const COMPUTERS = ''

/** An agent edited in place, or a new one: the name, the skills ticked, the accounts picked; Save writes it, Cancel leaves it. */
function AgentEditor({ agent, view, onDone }: { agent?: AgentRecord; view: AgentsView; onDone: (saved: boolean) => Promise<void> | void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(agent))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  useEffect(() => setDraft(draftOf(agent)), [agent])
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
    try {
      const done = await sendSaveAgent({
        ...(draft.id !== undefined ? { id: draft.id } : {}),
        name: draft.name,
        skills: [...draft.skills],
        accounts: { ...(draft.github !== undefined ? { github: draft.github } : {}), ...(draft.claude.size > 0 ? { claude: [...draft.claude] } : {}), ...(draft.codex.size > 0 ? { codex: [...draft.codex] } : {}) },
      })
      if (!done.ok) setError(done.error)
      else await onDone(true)
    } finally {
      setBusy(false)
    }
  }
  const githubItems = [{ value: COMPUTERS, label: `This computer's${view.github?.computer !== undefined ? ` (@${view.github.computer})` : ''}` }, ...(view.github?.accounts ?? []).map(login => ({ value: login, label: `@${login}` }))]
  return (
    <Card role="region" aria-label={agent ? `Editing ${agent.name}` : 'New agent'}>
      <CardHeader>
        <CardTitle className="text-base">{agent ? `Editing ${agent.name}` : 'New agent'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="agent-name">Name</Label>
          <Input id="agent-name" value={draft.name} disabled={busy || isDefault} placeholder="Social media" onChange={event => setDraft(d => ({ ...d, name: event.target.value }))} className="max-w-sm" />
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium">Skills</p>
          {view.skills.map(group => (
            <section key={group.title} aria-label={group.title} className="space-y-1.5">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.skills.map(skill => (
                  <label key={skill.name} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border bg-card p-3 transition-colors', draft.skills.has(skill.name) ? 'border-primary/60' : 'border-border hover:border-muted-foreground/40')}>
                    <Checkbox checked={draft.skills.has(skill.name)} onCheckedChange={checked => tick('skills', skill.name, checked === true)} disabled={busy} className="mt-0.5" aria-label={skill.name} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{skill.name}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{skill.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium">Accounts</p>
          <div className="space-y-1.5">
            <Label htmlFor="agent-github">GitHub</Label>
            <Select items={githubItems} value={draft.github ?? COMPUTERS} onValueChange={next => setDraft(d => ({ ...d, ...(next ? { github: String(next) } : {}), ...(next ? {} : { github: undefined }) }))} disabled={busy}>
              <SelectTrigger id="agent-github" size="sm" aria-label="GitHub account" className="max-w-sm">
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
            <p className="text-xs text-muted-foreground">Runs push and open pull requests as this account. An account this computer does not have refuses the start.</p>
          </div>
          <AccountPicks label="Claude" accounts={view.claude} picked={draft.claude} busy={busy} onTick={(id, on) => tick('claude', id, on)} />
          <AccountPicks label="Codex" accounts={view.codex} picked={draft.codex} busy={busy} onTick={(id, on) => tick('codex', id, on)} />
        </div>
        {error !== undefined && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onDone(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** A coding agent's accounts to pick from: none ticked means all of this computer's; one or more, those alone, where the computer has them. */
function AccountPicks({ label, accounts, picked, busy, onTick }: { label: string; accounts: readonly { id: string; name: string }[]; picked: Set<string>; busy: boolean; onTick: (id: string, on: boolean) => void }) {
  if (accounts.length === 0) return null
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm">{label}</legend>
      <div className="flex flex-wrap gap-3">
        {accounts.map(account => (
          <label key={account.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={picked.has(account.id)} onCheckedChange={checked => onTick(account.id, checked === true)} disabled={busy} aria-label={`${label} account ${account.name}`} />
            {account.name}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{picked.size === 0 ? `All of this computer's ${label} accounts, the next free one taking over at a limit.` : `Only these, where the computer the run goes to has them.`}</p>
    </fieldset>
  )
}
