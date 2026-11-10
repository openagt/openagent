import { useEffect, useState } from 'react'
import { ChevronRight, CircleCheck, House, Laptop, Loader2, Server, UserPlus, UserRound } from 'lucide-react'
import { Button, Checkbox, ConfirmDialog, Dialog, Switch, formatDateTime, formatRelative, usePolled, type ModuleAccountsAgent, type ModuleComputersThrough, type ModuleHost, type ModuleMachine, type ModuleMachineAccount } from '@openagt/dashboard/module'
import { idsOf, myName, type Answer, type DeviceRow } from './devices.js'
import { installDone, installFailed, nameOwner, removeDevice, removePerson, setPeople, setWho, askLink, type ServerRow } from './servers.js'
import { labelOf, type ServerItem } from './model.js'
import { Invite } from './codes.js'
import { Head, Part, Problem, Said, State, StepLine, SwitchLine, Tabs, hostOf, olderThan } from './parts.js'
import type { Devices } from './use-devices.js'

// A server's own page in Settings › Devices, for a server this computer installed OpenAgent on:
// on the internet, or a computer at home reached through one. Its state and its steps, and who is
// in on it and who may start runs on it. Whatever is changed on it is changed over SSH, by the
// `devices server` command's own process. Its logins are on its page on the Permissions page.

/** What removing a person does, said before it is done: it cannot be taken back. */
export const REMOVE_PERSON = (name: string): string =>
  `Their devices are taken out, and their own user on the server is deleted with everything in it: their logins, their copies of projects, and any work they did not push. ${name} can be invited again later.`

type Tab = 'overview' | 'people'

export function ServerPage({ d, item, onBack, invite = false }: { d: Devices; item: ServerItem; onBack: () => void; /** Opened to invite people: on its People, with Invite open. */ invite?: boolean }) {
  const { host, busy } = d
  const { server, machine } = item
  const home = server.through !== undefined
  const [tab, setTab] = useState<Tab>(invite ? 'people' : 'overview')
  // Where a person is added from: picked by name among the people of the server it is reached through, with no code; or with a code at its own door. A server at home with both is asked which.
  const ownDoor = item.door?.https !== undefined || item.door?.tailscale !== undefined
  const firstWay: Way = home && ownDoor ? 'ask' : home ? 'pick' : 'code'
  const [inviting, setInviting] = useState<Way | undefined>(invite ? firstWay : undefined)
  const [joined, setJoined] = useState<string | undefined>()
  const [codeOn, setCodeOn] = useState(false)
  const read = d.devices[server.address]
  const owner = read?.persons.find(person => person.owner)?.name

  // A device that got in while a code was on the page got in with it: the dialog says so.
  useDevicesBefore(read?.devices, codeOn, name => setJoined(name))
  useEffect(() => {
    d.await(codeOn ? server.address : undefined)
    return () => d.await(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeOn])

  const failed = installFailed(server)
  const behind = machine?.version !== undefined && d.machines !== undefined && olderThan(machine.version, d.machines.version)
  // A step this computer's OpenAgent brings and the server's install never ran: the same press as an update runs it.
  const unfinished = !server.working && !failed && server.steps.some(step => step.state === 'waiting')
  const done = installDone(server)
  const reason = d.notAdded[server.address]
  const doing = machine ? 'Updating' : 'Installing'
  const current = server.steps.findIndex(step => step.state !== 'done')
  const spins = busy && d.pressed === server.address

  const state = server.working ? (
    <State tone="working">{current < 0 ? `${doing}…` : `${doing}: step ${current + 1} of ${server.steps.length}`}</State>
  ) : failed ? (
    <State tone="bad">{`${machine ? 'The update' : 'The install'} stopped at a step`}</State>
  ) : machine?.version !== undefined ? (
    <State tone="good">Online</State>
  ) : machine ? (
    <State tone="quiet">Does not answer right now</State>
  ) : done && server.adding && reason === undefined ? (
    <State tone="working">Connecting…</State>
  ) : done ? (
    <State tone={reason !== undefined ? 'bad' : 'quiet'}>Installed. A run cannot be sent to it yet</State>
  ) : (
    <State tone="quiet">{`Logs in as ${server.user}`}</State>
  )

  const tabs: { id: Tab; title: string }[] = !done ? [{ id: 'overview', title: 'Overview' }] : [
    { id: 'overview', title: 'Overview' },
    { id: 'people', title: 'People' },
  ]

  return (
    <div>
      <Head
        icon={home ? House : Server}
        name={item.name}
        badge={home ? 'Server at home' : 'Server'}
        facts={[state, home ? `through ${labelOf(d.machines?.machines ?? [], server.through!)}` : server.tailscale ? 'on your Tailscale network' : item.name !== server.address ? server.address : undefined, item.door?.tailscale !== undefined && !server.tailscale ? `on Tailscale at ${item.door.tailscale}` : undefined, machine?.version !== undefined ? `OpenAgent ${machine.version}` : undefined]}
        {...(machine ? { rename: async (name: string) => {
          const renamed = await host.renameMachine(machine.id, name)
          await d.reloadMachines().catch(() => {})
          return renamed
        } } : {})}
      />
      {(behind || unfinished || failed) && !server.working && (
        <div role="status" className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <p className="text-xs">{failed ? `${machine ? 'The update' : 'The install'} stopped at a step: see Overview.` : behind ? `OpenAgent ${machine!.version} runs there: behind this computer, which runs ${d.machines!.version}.` : 'A step of the install never ran there.'}</p>
          <Button size="sm" disabled={busy || !d.machines} aria-label={failed ? `Try ${server.address} again` : `Update ${server.address}`} onClick={() => void d.install(server.address, server.user)}>
            {spins && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {failed ? 'Try again' : 'Update'}
          </Button>
        </div>
      )}
      {tabs.length > 1 && <Tabs label={`${item.name}`} tabs={tabs} value={tab} onChange={setTab} />}
      {tab === 'overview' && <Overview d={d} item={item} />}
      {tab === 'people' && (
        <Part>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">{read ? `Who is in (${read.devices.length})` : 'Who is in'}</p>
            <Button size="sm" disabled={busy} aria-label={`Add person to ${server.address}`} title={firstWay === 'code' ? 'Someone else, by their name: they add this server to their own OpenAgent with the code, and get a user of their own here.' : `Someone on ${hostOf(server.through!)}, by their name: they get a user of their own here, and reach it through ${hostOf(server.through!)}.${firstWay === 'ask' ? ' Or someone with a code at its own door.' : ''}`} onClick={() => (setJoined(undefined), setInviting(firstWay))}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              Add person
            </Button>
          </div>
          <People d={d} address={server.address} ownDevice={machine?.device} {...(server.through !== undefined ? { through: labelOf(d.machines?.machines ?? [], server.through), picks: true } : {})} />
        </Part>
      )}
      {d.error !== undefined && <Problem>{d.error}</Problem>}
      {inviting === 'ask' && <AddPersonWay label={item.name} at={hostOf(server.through!)} codeWay={item.door?.tailscale !== undefined && item.door.https === undefined ? 'Someone on your Tailscale network' : 'Someone anywhere'} onWay={setInviting} onClose={() => setInviting(undefined)} />}
      {inviting === 'pick' && <PickPeople host={host} server={{ ...server, through: server.through! }} label={item.name} onChange={d.act} onClose={() => setInviting(undefined)} />}
      {inviting === 'code' && (
        <Invite
          label={item.name}
          tailscale={server.tailscale === true || (item.door?.tailscale !== undefined && item.door.https === undefined)}
          ask={person => askLink(host, server.address, person)}
          persons={{
            owner,
            // The server's owner is the person at this computer: their name starts as the one git knows.
            myName: () => myName(host),
            nameOwner: async name => {
              const named = await nameOwner(host, server.address, name)
              if (named.ok) d.setDevices(server.address, named.value)
              return named.ok ? { ok: true } : named
            },
          }}
          joined={joined}
          onCode={next => {
            setJoined(undefined)
            setCodeOn(next !== undefined)
          }}
          onClose={() => {
            setInviting(undefined)
            setCodeOn(false)
            setJoined(undefined)
          }}
        />
      )}
    </div>
  )
}

/** The ids of the devices that were in when a code came on the page: one more, and it got in with the code. */
function useDevicesBefore(devices: DeviceRow[] | undefined, waiting: boolean, onGotIn: (name: string) => void): void {
  const [before, setBefore] = useState<string[] | undefined>()
  const ids = devices?.flatMap(idsOf).join(',')
  useEffect(() => {
    if (!waiting) return void setBefore(undefined)
    if (ids === undefined) return
    const now = ids.split(',').filter(Boolean)
    if (before === undefined) setBefore(now)
    else {
      const fresh = devices?.find(device => idsOf(device).some(id => !before.includes(id)))
      if (fresh) onGotIn(fresh.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, ids])
}

function Overview({ d, item }: { d: Devices; item: ServerItem }) {
  const { host, busy } = d
  const { server, machine } = item
  const [opened, setOpened] = useState(false)
  const done = installDone(server)
  const reason = d.notAdded[server.address]
  const sendable = machine ? 'done' : reason !== undefined ? 'failed' : server.adding ? 'running' : 'waiting'
  // The steps fold into one line once there is nothing left to see in them.
  const settled = done && machine !== undefined
  return (
    <>
      <Part title="Install">
        {!settled || opened ? (
          <div className="space-y-1.5">
            <ol aria-label={`The install on ${server.address}`} className="space-y-1.5 text-xs">
              {server.steps.map(step => (
                <StepLine key={step.id} label={step.label} state={step.state} said={step.state === 'failed' ? step.said : undefined}>
                  {step.id === 'login' && step.state === 'done' && server.fingerprint !== undefined && <span className="ml-5.5 block break-all font-mono text-[11px] text-muted-foreground">{`The server's key: ${server.fingerprint}`}</span>}
                </StepLine>
              ))}
              {done && <StepLine label="Runs can be sent to it" state={sendable} said={machine ? undefined : reason} />}
            </ol>
            {settled && (
              <button type="button" className="ml-5.5 text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setOpened(false)}>
                Hide the steps
              </button>
            )}
          </div>
        ) : (
          <button type="button" aria-expanded={false} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpened(true)}>
            <CircleCheck aria-hidden className="h-3.5 w-3.5 text-success" />
            {`Installed, as ${server.user}`}
            <ChevronRight aria-hidden className="h-3 w-3" />
          </button>
        )}
        {done && machine?.version === undefined && (reason !== undefined || !server.adding) && (
          <Button size="sm" variant="outline" disabled={busy} aria-label={machine ? `Connect ${server.address} again` : `Finish connecting ${server.address}`} onClick={() => void d.addToMachines(server)}>
            {machine ? 'Connect again' : 'Finish connecting'}
          </Button>
        )}
      </Part>
      {done && server.through !== undefined && (
        <Part title="Runs">
          <RunsThrough host={host} server={{ ...server, through: server.through }} label={item.name} busy={busy} onChange={d.act} />
        </Part>
      )}
      {done && machine?.version !== undefined && <Accounts host={host} machine={machine} name={item.name} busy={busy} />}
      {/* A computer on Tailscale keeps no lines: no computer is reached through it. */}
      {done && machine && server.through === undefined && !server.tailscale && <ComputersThrough host={host} machine={machine} busy={busy} everyMs={30_000} />}
      {!server.working && (
        <div className="pt-4">
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="outline" className="text-danger" disabled={busy} aria-label={`Remove ${server.address}`} title="Takes the server off this list, and this computer out of the server.">
                Remove server
              </Button>
            }
            title={`Remove ${item.name}?`}
            body="Takes the server off this list, and this computer out of the server. Nothing else is changed on the server: OpenAgent goes on running there, and its logins stay there until you remove them."
            confirmLabel="Remove"
            confirmBusyLabel="Removing…"
            onConfirm={() => d.removeServer(server)}
          />
        </div>
      )}
    </>
  )
}

const AGENTS: { agent: ModuleAccountsAgent; title: string }[] = [
  { agent: 'claude', title: 'Claude Code' },
  { agent: 'codex', title: 'Codex' },
]

/**
 * The coding agents' accounts on the server, as it says them, each in the order its runs take
 * them. One is removed here as on the server's own page: one this computer handed it, this computer
 * offers again on the Permissions page. The server's own login stays: Claude Code or Codex keeps it.
 */
function Accounts({ host, machine, name, busy }: { host: ModuleHost; machine: ModuleMachine; name: string; busy: boolean }) {
  const { value: read, reload } = usePolled<(ModuleMachineAccount[] | null)[] | undefined>(() => Promise.all(AGENTS.map(({ agent }) => host.machineAccounts(machine.id, agent))), undefined, 30_000, [machine.id])
  const [removing, setRemoving] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const remove = async (agent: ModuleAccountsAgent, account: ModuleMachineAccount) => {
    setRemoving(`${agent} ${account.id}`)
    setError(undefined)
    const done = await host.removeMachineAccount(machine.id, agent, account.id)
    if (!done.ok) setError(done.error)
    await reload()
    setRemoving(undefined)
  }
  const shown = AGENTS.map((one, i) => ({ ...one, accounts: read?.[i] ?? [] })).filter(one => one.accounts.length > 0)
  if (read === undefined || shown.length === 0) return null
  return (
    <Part title="Accounts">
      {shown.map(({ agent, title, accounts }) => (
        <div key={agent} className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{title}</p>
          <ul aria-label={`${title} accounts on ${name}`} className="space-y-1.5">
            {accounts.map(account => (
              <li key={account.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {account.name}
                  <span className="ml-2 text-xs text-muted-foreground">{[account.from !== undefined ? `from ${account.from}` : account.own ? `${name}'s own login` : undefined, account.first ? 'runs take it first' : undefined].filter(Boolean).join(' · ')}</span>
                </span>
                {!account.own && (
                  <Button size="xs" variant="ghost" disabled={busy || removing !== undefined} aria-label={`Remove ${account.name}'s ${title} account on ${name}`} title={account.from !== undefined ? `Runs on ${name} no longer use it. ${account.from} offers it again on the Permissions page.` : `Runs on ${name} no longer use it.`} onClick={() => void remove(agent, account)}>
                    {removing === `${agent} ${account.id}` && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {error !== undefined && <Problem>{error}</Problem>}
    </Part>
  )
}

/**
 * Whether the server a computer at home is reached through may start its owner's runs on it, or
 * only show them: one switch, as a computer's page has for a server. Who else may is its People;
 * the switch changes nothing about who is named.
 */
export function RunsThrough({ host, server, label = server.address, busy, onChange }: { host: ModuleHost; server: ServerRow & { through: string }; /** The computer's name, as its page shows it. */ label?: string; busy: boolean; onChange: (change: () => Promise<Answer<unknown>>) => Promise<boolean> }) {
  const at = hostOf(server.through)
  const on = server.who !== 'nobody'
  return (
    <SwitchLine label={`Your runs can go here from ${at}`} words={on ? `Pick ${label} under "Run on" on ${at}. The people on its People run here too, each as themselves.` : `Off: its runs only show on ${at}.`}>
      <Switch aria-label={`Your runs can go here from ${at}`} checked={on} disabled={busy} onCheckedChange={next => void onChange(() => setWho(host, server.address, next ? 'me' : 'nobody'))} />
    </SwitchLine>
  )
}

/** How a person is added to a server at home that has both: picked on the server it is reached through, or given a code at its own door. */
type Way = 'ask' | 'pick' | 'code'

/**
 * Which way a person is added, asked when a server at home has both: someone on the server it
 * is reached through, picked by name with no code; or someone at its own door, with a code.
 */
function AddPersonWay({ label, at, codeWay, onWay, onClose }: { label: string; at: string; /** The second way, by where the door is: on Tailscale, or anywhere. */ codeWay: string; onWay: (way: 'pick' | 'code') => void; onClose: () => void }) {
  const choice = 'w-full rounded-md border border-border p-3 text-left hover:bg-muted'
  return (
    <Dialog open onOpenChange={open => !open && onClose()} title={`Add person to ${label}`}>
      <div className="space-y-3 text-sm">
        <p>Who is it?</p>
        <button type="button" className={choice} onClick={() => onWay('pick')}>
          <span className="block">{`Someone on ${at}`}</span>
          <span className="block text-xs text-muted-foreground">{`Picked by name. No code: they reach ${label} through ${at}.`}</span>
        </button>
        <button type="button" className={choice} onClick={() => onWay('code')}>
          <span className="block">{codeWay}</span>
          <span className="block text-xs text-muted-foreground">You type their name and send them a code; they add it in their own OpenAgent.</span>
        </button>
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/**
 * Pick, among the people on the server a computer is reached through, who may start runs on it
 * too: the server's door says who is there, and the computer's own person and the people named
 * already are not offered. No link and no code: each person reaches the computer through the
 * server they are already in at, and gets a user of their own on it at their first run.
 */
export function PickPeople({ host, server, label, onChange, onClose }: { host: ModuleHost; server: ServerRow & { through: string }; /** The computer's name, as its page shows it. */ label: string; onChange: (change: () => Promise<Answer<unknown>>) => Promise<boolean>; onClose: () => void }) {
  const at = hostOf(server.through)
  const have = server.people ?? []
  const { value: there } = usePolled<{ me: string | undefined; persons: string[] } | undefined>(
    async () => {
      const asked = await host.machinePerson(server.through)
      const said = asked.ok && asked.said && typeof asked.said === 'object' ? (asked.said as Record<string, unknown>) : undefined
      if (!said) return undefined
      return { me: typeof said.person === 'string' ? said.person : undefined, persons: Array.isArray(said.persons) ? said.persons.filter((name): name is string => typeof name === 'string') : [] }
    },
    undefined,
    60_000,
    [server.through],
  )
  const choices = there?.persons.filter(name => name !== there.me && !have.includes(name)) ?? []
  const [picked, setPicked] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const add = async (): Promise<void> => {
    setAdding(true)
    const done = await onChange(() => setPeople(host, server.address, [...have, ...picked]))
    setAdding(false)
    if (done) onClose()
  }
  return (
    <Dialog open onOpenChange={open => !open && onClose()} title={`Add person to ${label}`}>
      <div className="space-y-4 text-sm">
        {there === undefined ? (
          <p className="text-xs text-muted-foreground">{`Asking ${at} who is there…`}</p>
        ) : choices.length === 0 ? (
          <p className="text-xs text-muted-foreground">{have.length ? `Everyone on ${at} is here already. Someone new is added on ${at} first: its People.` : `Nobody else is on ${at} yet. Add them there first: its People.`}</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{`Someone on ${at}. They get a user of their own on ${label}, with their own logins, and reach it through ${at}: no code to send. Their agents run on your home network.`}</p>
            <ul aria-label={`The people on ${at}`} className="space-y-2">
              {choices.map(name => (
                <li key={name}>
                  <label className="flex items-center gap-2">
                    <Checkbox checked={picked.includes(name)} onCheckedChange={checked => setPicked(checked === true ? [...picked, name] : picked.filter(other => other !== name))} aria-label={name} />
                    <span>{name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {choices.length > 0 && (
            <Button size="sm" disabled={picked.length === 0 || adding} onClick={() => void add()}>
              {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {picked.length > 1 ? `Add ${picked.length} people` : 'Add person'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/**
 * The computers that keep a line open to a server this computer is in at: computers at home a
 * run can be sent to through the server. One press saves one, and it is in "Run on" from then on.
 * Nothing at all for a server no computer keeps a line to.
 */
export function ComputersThrough({ host, machine, busy, everyMs }: { host: ModuleHost; machine: ModuleMachine; busy: boolean; everyMs: number }) {
  const { value: read, reload } = usePolled<ModuleComputersThrough | undefined>(() => host.computersThrough(machine.id), undefined, Math.max(everyMs, 10_000), [machine.id])
  const [adding, setAdding] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  if (read === undefined || (read.ok && read.computers.length === 0)) return null
  const add = async (computerId: string): Promise<void> => {
    setAdding(computerId)
    setError(undefined)
    const added = await host.addComputerThrough(machine.id, computerId)
    if (!added.ok) setError(added.error)
    await reload().catch(() => {})
    setAdding(undefined)
  }
  return (
    <Part title="Computers on this server">
      {read.ok ? (
        <ul aria-label={`The computers on ${machine.label}`} className="space-y-2 text-xs">
          {read.computers.map(computer => (
            <li key={computer.id} className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2">
                {computer.owner !== undefined ? <Server aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Laptop aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate text-sm">{computer.name}</span>
                {/* Another person's, set up as a server and shared with this person on this one. */}
                {computer.owner !== undefined && <span className="shrink-0 text-muted-foreground">{`· ${computer.owner}'s · shared with you`}</span>}
                <State tone={computer.online ? 'good' : 'quiet'}>{computer.online ? 'Online' : 'Away'}</State>
              </div>
              {computer.added ? (
                <span className="shrink-0 text-muted-foreground">In "Run on"</span>
              ) : (
                <Button size="sm" variant="outline" className="shrink-0" disabled={busy || adding !== undefined} aria-label={`Add ${computer.name} through ${machine.label}`} onClick={() => void add(computer.id)}>
                  {adding === computer.id && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  Add
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{`Its computers could not be read: ${read.error}`}</p>
      )}
      {read.ok && read.computers.some(computer => !computer.added) && <p className="text-xs text-muted-foreground">Added, a computer is in "Run on" here: a run started on it goes through this server.</p>}
      {error !== undefined && <Problem>{error}</Problem>}
    </Part>
  )
}

/** A device that is in on a server: what it is, when it was last there, and a way to take it out. */
function DeviceLine({ device, address, busy, ownKey, onRemove }: { device: DeviceRow; address: string; busy: boolean; /** The device is this computer's OpenAgent, by the key it has on the server. */ ownKey: boolean; onRemove: () => void }) {
  // This computer is in on its server by itself: taken out there alone, its page here would go on asking with a key that opens nothing.
  const own = device.own === true || ownKey
  return (
    <li className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="truncate text-sm">{device.name}</p>
        <p className="text-muted-foreground" title={formatDateTime(device.seen ?? device.added)}>
          {`Added ${formatRelative(device.added)}`}
          {device.seen !== undefined ? `, last seen ${formatRelative(device.seen)}` : ''}
        </p>
        {own ? (
          <p className="text-muted-foreground">This computer. To take it out, remove the server.</p>
        ) : (
          device.line && <p className="text-muted-foreground">{`A computer that keeps a line open to the server: runs can be started on it from the server's page. Remove it and it is no longer in "Run on" there.`}</p>
        )}
      </div>
      {!own && (
        <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${device.name} from ${address}`} onClick={onRemove}>
          Remove
        </Button>
      )}
    </li>
  )
}

/** Who is in on a server, as its door lists them, by person. Read by the page with the rest, over SSH. */
function People({ d, address, ownDevice, through, picks = false }: { d: Devices; address: string; ownDevice: string | undefined; /** A server at home: the server it is reached through, by its name, which its owner uses it through too. */ through?: string; /** Add person picks among that server's people, by name: no code. */ picks?: boolean }) {
  const { host, busy } = d
  const read = d.devices[address]
  const error = d.devicesError[address]
  const [removing, setRemoving] = useState(false)
  const [failed, setFailed] = useState<string | undefined>()
  const devices = read?.devices
  const persons = read?.persons ?? []
  // By person, the owner first; one list with no heading while nobody else is invited.
  const groups = persons.length ? persons.map(person => ({ person, devices: (devices ?? []).filter(device => (device.person ?? persons[0]!.name) === person.name) })) : [{ person: undefined, devices: devices ?? [] }]

  const remove = async (taken: () => Promise<Answer<{ devices: DeviceRow[]; persons: typeof persons; lineRefused: boolean }>>): Promise<void> => {
    setRemoving(true)
    setFailed(undefined)
    const answer = await taken()
    if (answer.ok) d.setDevices(address, answer.value)
    else setFailed(answer.error)
    await d.reloadDevices().catch(() => {})
    setRemoving(false)
  }

  return (
    <div className="space-y-2 text-xs">
      {(devices === undefined || (devices.length === 0 && persons.length < 2)) && (
        <p className="text-muted-foreground">{devices === undefined ? (error === undefined ? 'Asking the server who is in…' : 'The devices that are in on the server could not be read.') : picks ? `Nobody yet. Add person picks someone on ${through}; they get a user of their own here.` : 'Nobody yet. Invite gives someone a code; your own phone is added with Add device.'}</p>
      )}
      {devices !== undefined &&
        (devices.length > 0 || persons.length > 1) &&
        groups.map(({ person, devices: theirs }) => (
          <div key={person?.name ?? ''} className="space-y-2">
            {person !== undefined && (
              <div className="flex items-center justify-between gap-4 pt-1">
                <p className="flex min-w-0 items-center gap-2 font-medium text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{person.owner ? `${person.name}, the owner` : person.name}</span>
                </p>
                {/* The owner of a server at home, and a person a server's line named here: they reach it through that server, and their devices are in there, not here. */}
                {person.owner && through !== undefined && <p className="text-muted-foreground">{`Uses this computer through ${through}.`}</p>}
                {!person.owner && person.from !== undefined && <p className="text-muted-foreground">{`Uses this computer through ${labelOf(d.machines?.machines ?? [], person.from)}.`}</p>}
                {!person.owner && (
                  <ConfirmDialog
                    trigger={
                      <Button size="sm" variant="ghost" disabled={busy || removing} aria-label={`Remove ${person.name} from ${address}`}>
                        Remove person
                      </Button>
                    }
                    title={`Remove ${person.name} from ${address}?`}
                    body={REMOVE_PERSON(person.name)}
                    confirmLabel="Remove person"
                    confirmBusyLabel="Removing…"
                    onConfirm={() => remove(() => removePerson(host, address, person.name))}
                  />
                )}
              </div>
            )}
            {person?.working && <p className="text-muted-foreground">{`Making ${person.name}'s own user on the server, with their own OpenAgent. This takes a minute or two.`}</p>}
            {person?.problem !== undefined && !person.working && <p role="alert" className="text-danger">{`${person.name}'s own user on the server could not be made: ${person.problem.replace(/\.?$/, '.')} Add them again to try again.`}</p>}
            {person !== undefined && theirs.length === 0 && (person.owner || person.from === undefined) && <p className="text-muted-foreground">No device yet.</p>}
            {theirs.length > 0 && (
              <ul aria-label={person !== undefined ? `Devices of ${person.name} on ${address}` : `The devices that are in on ${address}`} className="space-y-2">
                {theirs.map(device => (
                  <DeviceLine key={device.id} device={device} address={address} busy={busy || removing} ownKey={ownDevice !== undefined && idsOf(device).includes(ownDevice)} onRemove={() => void remove(() => removeDevice(host, address, device.id))} />
                ))}
              </ul>
            )}
          </div>
        ))}
      {(failed ?? error) !== undefined && <Said>{failed ?? error}</Said>}
    </div>
  )
}
