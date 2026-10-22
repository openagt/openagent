import { useEffect, useState, type FormEvent } from 'react'
import { ChevronRight, CircleCheck, House, Laptop, Loader2, Plus, Server, UserPlus, UserRound } from 'lucide-react'
import { Button, ConfirmDialog, Dialog, Input, InviteDialog, RadioGroup, RadioGroupOption, formatDateTime, formatRelative, usePolled, type ModuleComputersThrough, type ModuleHost, type ModuleMachine } from '@openagt/dashboard/module'
import { addAccount, idsOf, loadAccounts, loadDevices, login, logout, nameOwner, ownGithub, removeAccount, removeDevice, removePerson, setWho, askLink, type AccountRow, type Answer, type DeviceRow, type ServerRow, type Who } from './servers.js'
import type { ServerItem } from './model.js'
import { Head, LoginLine, Part, Problem, Said, State, StepLine, StepMark, Tabs, day, hostOf, named, olderThan } from './parts.js'
import type { Devices } from './use-devices.js'

// A server's own page in Settings › Devices, for a server this computer installed OpenAgent on:
// on the internet, or a computer at home reached through one. Its state and its steps, who is in
// on it and who may start runs on it, and its logins. Whatever is changed on it is changed over
// SSH, by the `devices server` command's own process: no login ever comes to this page.

/** What removing a person does, said before it is done: it cannot be taken back. */
export const REMOVE_PERSON = (account: string): string =>
  `Their devices are taken out, and their own user on the server is deleted with everything in it: their GitHub and Claude logins, their copies of projects, and any work they did not push to GitHub. Their finished runs stay on GitHub. @${account} can be invited again later.`

type Tab = 'overview' | 'people' | 'logins'

export function ServerPage({ d, item, onBack }: { d: Devices; item: ServerItem; onBack: () => void }) {
  const { host, busy } = d
  const { server, machine } = item
  const home = server.through !== undefined
  const [tab, setTab] = useState<Tab>('overview')
  const [inviting, setInviting] = useState(false)
  const [joined, setJoined] = useState<string | undefined>()
  const [codeOn, setCodeOn] = useState(false)
  const read = d.devices[server.address]
  const owner = read?.persons.find(person => person.owner)?.account

  // A device that got in while a code was on the page got in with it: the dialog says so.
  useDevicesBefore(read?.devices, codeOn, name => setJoined(name))
  useEffect(() => {
    d.await(codeOn ? server.address : undefined)
    return () => d.await(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeOn])

  const failed = !server.working && server.steps.some(step => step.state === 'failed')
  const behind = machine?.version !== undefined && d.machines !== undefined && olderThan(machine.version, d.machines.version)
  // A step this computer's OpenAgent brings and the server's install never ran: the same press as an update runs it.
  const unfinished = !server.working && !failed && server.steps.some(step => step.state === 'waiting')
  const done = !server.working && server.steps.every(step => step.state === 'done')
  const reason = d.notAdded[server.address]
  const doing = machine ? 'Updating' : 'Installing'
  const current = server.steps.findIndex(step => step.state !== 'done')
  const spins = busy && d.pressed === server.address
  const { github } = server.logins

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

  const tabs: { id: Tab; title: string }[] = home || !done ? [{ id: 'overview', title: 'Overview' }, ...(done ? [{ id: 'logins' as const, title: 'Logins' }] : [])] : [
    { id: 'overview', title: 'Overview' },
    { id: 'people', title: 'People' },
    { id: 'logins', title: 'Logins' },
  ]

  return (
    <div>
      <Head
        icon={home ? House : Server}
        name={item.name}
        badge={home ? 'Server at home' : 'Server'}
        facts={[state, home ? `through ${hostOf(server.through!)}` : item.name !== server.address ? server.address : undefined, machine?.version !== undefined ? `OpenAgent ${machine.version}` : undefined]}
        {...(machine ? { rename: async (name: string) => {
          const renamed = await host.renameMachine(machine.id, name)
          await d.reloadMachines().catch(() => {})
          return renamed
        } } : {})}
      />
      {(behind || unfinished || failed) && !server.working && (
        <div role="status" className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <p className="text-xs">{failed ? `${machine ? 'The update' : 'The install'} stopped at a step: see Overview.` : behind ? `OpenAgent ${machine!.version} runs there: behind this computer, which runs ${d.machines!.version}.` : 'A step of the install never ran there.'}</p>
          <Button size="sm" disabled={busy || !d.machines} aria-label={failed ? `Try ${server.address} again` : `Update ${server.address}`} onClick={() => void d.install(server.address, server.user, failed && github.wanted === true)}>
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
            <Button size="sm" disabled={busy} aria-label={`Invite to ${server.address}`} title="A code for a person, a phone or a browser: scanned or opened once, it lets them into OpenAgent on the server, from anywhere." onClick={() => (setJoined(undefined), setInviting(true))}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              Invite
            </Button>
          </div>
          <People d={d} address={server.address} ownDevice={machine?.device} />
        </Part>
      )}
      {tab === 'logins' && (
        <Part>
          <Logins d={d} server={server} />
        </Part>
      )}
      {d.error !== undefined && <Problem>{d.error}</Problem>}
      {inviting && (
        <InviteDialog
          title={`Invite to ${item.name}`}
          ask={person => askLink(host, server.address, person)}
          persons={{
            owner,
            // The server's owner is the person at this computer: the GitHub account its gh is logged in to.
            whoAmI: async () => {
              const me = await ownGithub(host)
              if (!me.ok) return me
              return 'account' in me.value ? { ok: true, account: me.value.account } : { ok: false, error: me.value.problem }
            },
            nameOwner: async account => {
              const named = await nameOwner(host, server.address, account)
              if (named.ok) d.setDevices(server.address, named.value)
              return named.ok ? { ok: true } : named
            },
          }}
          scan="Scan it with the phone's camera: it opens OpenAgent on the server, from anywhere."
          openHere
          joined={joined}
          onCode={next => {
            setJoined(undefined)
            setCodeOn(next !== undefined)
          }}
          onClose={() => {
            setInviting(false)
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
  const done = !server.working && server.steps.every(step => step.state === 'done')
  const reason = d.notAdded[server.address]
  const { github, claude } = server.logins
  const sendable = machine ? 'done' : reason !== undefined ? 'failed' : server.adding ? 'running' : 'waiting'
  // The steps fold into one line once there is nothing left to see in them.
  const settled = done && machine !== undefined && !github.working
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
              {github.working && (
                <li aria-label="Your GitHub login: not copied yet" className="flex items-center gap-2 text-muted-foreground">
                  <StepMark state={server.steps.every(step => step.state === 'done') ? 'running' : 'waiting'} />
                  Your GitHub login
                </li>
              )}
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
        <Part title="Who can use it">
          <WhoCanStart host={host} server={{ ...server, through: server.through }} busy={busy} onChange={d.act} />
        </Part>
      )}
      {done && machine && server.through === undefined && <ComputersThrough host={host} machine={machine} busy={busy} everyMs={30_000} />}
      {!server.working && (
        <div className="pt-4">
          <ConfirmDialog
            trigger={
              <Button
                size="sm"
                variant="outline"
                className="text-danger"
                // Not while one of its logins is being changed: the server is not forgotten then, and nothing of it is taken out before.
                disabled={busy || github.working || claude.working}
                aria-label={`Remove ${server.address}`}
                title={github.working || claude.working ? 'One of its logins is being changed right now: wait until that ends.' : 'Takes the server off this list, and this computer out of the server.'}
              >
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

/**
 * Who on its server may start runs on a computer reached through it: nobody, its own person, or
 * every person there. Going from everyone to fewer asks first what becomes of the users the others
 * have on the computer: they go with all of it, or stay, switched off.
 */
function WhoCanStart({ host, server, busy, onChange }: { host: ModuleHost; server: ServerRow & { through: string }; busy: boolean; onChange: (change: () => Promise<Answer<unknown>>) => Promise<boolean> }) {
  const at = hostOf(server.through)
  // How many people that server has, when its door says: a person's computer only hears of them through a line for everyone.
  const { value: people } = usePolled<number | undefined>(
    async () => {
      const asked = await host.machinePerson(server.through)
      const persons = asked.ok && asked.said && typeof asked.said === 'object' ? (asked.said as Record<string, unknown>).persons : undefined
      return Array.isArray(persons) ? persons.length : undefined
    },
    undefined,
    60_000,
    [server.through],
    'previous',
  )
  // The others whose users the computer holds, and what the person picked, while the question is open.
  const [asking, setAsking] = useState<{ who: Who; others: string[] } | undefined>()
  const who = server.who ?? 'me'
  const pick = async (next: Who): Promise<void> => {
    if (next === who) return
    if (who === 'everyone') {
      const listed = await loadDevices(host, server.address)
      const others = listed.ok ? listed.value.persons.filter(person => !person.owner && person.from === server.through).map(person => person.account) : []
      if (others.length) return setAsking({ who: next, others })
    }
    await onChange(() => setWho(host, server.address, next))
  }
  const answer = (remove: boolean): void => {
    const asked = asking!
    setAsking(undefined)
    void onChange(() => setWho(host, server.address, asked.who, remove))
  }
  return (
    <div className="space-y-2">
      <RadioGroup aria-label={`Who can start runs on ${server.address}`} value={who} disabled={busy} onValueChange={next => void pick(next as Who)}>
        <RadioGroupOption value="me">Only me</RadioGroupOption>
        <RadioGroupOption value="everyone">
          {`Everyone on ${at}${people !== undefined ? ` (${people} ${people === 1 ? 'person' : 'people'})` : ''}`}
          <span className="block w-full pl-6 text-xs text-muted-foreground">
            Each person's runs use their own logins, never yours.
            <br />
            Their agents run on your home network.
          </span>
        </RadioGroupOption>
        <RadioGroupOption value="nobody">{`Nobody: its runs only show on ${at}`}</RadioGroupOption>
      </RadioGroup>
      {asking !== undefined && (
        <Dialog open onOpenChange={open => !open && setAsking(undefined)} title={`Who can start runs on ${server.address}`}>
          <div className="space-y-4 text-sm">
            <p>{`${named(asking.others)} ${asking.others.length === 1 ? 'has a user of their own' : 'have their own users'} on ${server.address}.`}</p>
            <div className="space-y-1">
              <Button size="sm" variant="destructive" onClick={() => answer(true)}>
                Remove them, with their logins and projects
              </Button>
              <p className="text-xs text-muted-foreground">Work they did not push goes with them.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAsking(undefined)}>
                Cancel
              </Button>
              <Button size="sm" variant="outline" onClick={() => answer(false)}>
                Keep them, switched off
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
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
                {/* Another person's, set up as a server and shared with everyone on this one. */}
                {computer.owner !== undefined && <span className="shrink-0 text-muted-foreground">{`· @${computer.owner}'s · for everyone`}</span>}
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
function People({ d, address, ownDevice }: { d: Devices; address: string; ownDevice: string | undefined }) {
  const { host, busy } = d
  const read = d.devices[address]
  const error = d.devicesError[address]
  const [removing, setRemoving] = useState(false)
  const [failed, setFailed] = useState<string | undefined>()
  const devices = read?.devices
  const persons = read?.persons ?? []
  // By person, the owner first; one list with no heading while nobody else is invited.
  const groups = persons.length ? persons.map(person => ({ person, devices: (devices ?? []).filter(device => (device.person ?? persons[0]!.account) === person.account) })) : [{ person: undefined, devices: devices ?? [] }]

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
        <p className="text-muted-foreground">{devices === undefined ? (error === undefined ? 'Asking the server who is in…' : 'The devices that are in on the server could not be read.') : 'Nobody yet. Invite gives a code for a person, a phone or a browser.'}</p>
      )}
      {devices !== undefined &&
        (devices.length > 0 || persons.length > 1) &&
        groups.map(({ person, devices: theirs }) => (
          <div key={person?.account ?? ''} className="space-y-2">
            {person !== undefined && (
              <div className="flex items-center justify-between gap-4 pt-1">
                <p className="flex min-w-0 items-center gap-2 font-medium text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{person.owner ? `@${person.account}, the owner` : `@${person.account}`}</span>
                </p>
                {!person.owner && (
                  <ConfirmDialog
                    trigger={
                      <Button size="sm" variant="ghost" disabled={busy || removing} aria-label={`Remove @${person.account} from ${address}`}>
                        Remove person
                      </Button>
                    }
                    title={`Remove @${person.account} from ${address}?`}
                    body={REMOVE_PERSON(person.account)}
                    confirmLabel="Remove person"
                    confirmBusyLabel="Removing…"
                    onConfirm={() => remove(() => removePerson(host, address, person.account))}
                  />
                )}
              </div>
            )}
            {person?.working && <p className="text-muted-foreground">{`Making @${person.account}'s own user on the server, with their own OpenAgent. This takes a minute or two.`}</p>}
            {person?.problem !== undefined && !person.working && <p role="alert" className="text-danger">{`@${person.account}'s own user on the server could not be made: ${person.problem.replace(/\.?$/, '.')} Invite them again to try again.`}</p>}
            {person !== undefined && theirs.length === 0 && <p className="text-muted-foreground">No device yet.</p>}
            {theirs.length > 0 && (
              <ul aria-label={person !== undefined ? `Devices of @${person.account} on ${address}` : `The devices that are in on ${address}`} className="space-y-2">
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

/** How full an account was at the last run on it: its week, else its five hours; at a limit, when it frees. */
function accountWords(account: AccountRow, now = Date.now()): string {
  if (account.limitedUntil !== undefined && account.limitedUntil > now) return `at its limit until ${formatDateTime(new Date(account.limitedUntil).toISOString())}`
  const window = account.windows?.find(w => w.window === 'seven_day') ?? account.windows?.find(w => w.window === 'five_hour')
  if (window === undefined) return 'no run on it yet'
  return `${Math.round(window.percentUsed)}% of its ${window.window === 'seven_day' ? 'week' : 'five hours'} used at its last run`
}

/** A server's logins: GitHub's, Claude's, and the other Claude accounts its runs go on with at a limit. */
function Logins({ d, server }: { d: Devices; server: ServerRow }) {
  const { host, busy, account, noLogin } = d
  const { github, claude } = server.logins
  const act = d.act
  return (
    <ul aria-label={`The logins on ${server.address}`} className="space-y-3 text-xs">
      <LoginLine
        label="GitHub"
        words={
          github.asking && github.code !== undefined
            ? `GitHub: type the code ${github.code} at github.com/login/device, and say yes there.`
            : github.working
              ? 'GitHub: one moment, the server is being told.'
              : github.there
                ? `GitHub: logged in as ${github.account ?? 'you'} since ${day(github.since)}.`
                : github.said !== undefined
                  ? 'GitHub: the last try did not go through.'
                  : 'GitHub: no login on the server.'
        }
        said={github.working ? undefined : github.said}
      >
        <Button size="sm" variant="outline" disabled={busy || github.working || account === undefined} aria-label={`Copy my GitHub login to ${server.address}`} title={account !== undefined ? `Copies the login of ${account} from this computer to the server, over SSH.` : noLogin} onClick={() => void act(() => login(host, server.address, 'github'))}>
          {github.there ? 'Copy again' : 'Copy my login'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || (github.working && github.asking !== true)}
          aria-label={`Log in to GitHub for ${server.address}`}
          title="The server asks GitHub for a login of its own. GitHub gives a short code: you type it at github.com/login/device and say yes there. This computer's own GitHub login is not touched, and the login the server had is replaced."
          onClick={() => void act(() => login(host, server.address, 'github', true))}
        >
          {github.asking ? 'Start over' : 'Log in to GitHub'}
        </Button>
        {github.asking && github.code !== undefined && (
          <a href="https://github.com/login/device" target="_blank" rel="noreferrer" className="self-center underline">
            Open GitHub
          </a>
        )}
        {/* After a try that failed too: what it left on the server is not always known here. */}
        {(github.there || github.said !== undefined) && !github.working && (
          <Button size="sm" variant="outline" disabled={busy} aria-label={`Remove the GitHub login from ${server.address}`} title="Deletes the login on the server. The login itself is not ended by this: a copied one is this computer's own and stays good. To end one everywhere, take it back on github.com." onClick={() => void act(() => logout(host, server.address, 'github'))}>
            Remove
          </Button>
        )}
      </LoginLine>
      <LoginLine
        label="Claude"
        words={claude.asking ? "Claude: say yes in the page this computer's browser opened." : claude.working ? 'Claude: one moment, the server is being told.' : claude.there ? `Claude: logged in since ${day(claude.since)}, good until about ${day(claude.ends)}.` : claude.said !== undefined ? 'Claude: the last try did not go through.' : 'Claude: not logged in on the server.'}
        said={claude.working ? undefined : claude.said}
      >
        <Button size="sm" variant={claude.there || claude.working ? 'outline' : 'default'} disabled={busy || (claude.working && claude.asking !== true)} aria-label={`Log in to Claude for ${server.address}`} title="Opens this computer's browser, where you say yes once. The login is made for this server alone and lasts a year; this computer's own Claude login is not touched." onClick={() => void act(() => login(host, server.address, 'claude'))}>
          {claude.asking ? 'Start over' : claude.there ? 'Log in again' : 'Log in to Claude'}
        </Button>
        {(claude.there || claude.said !== undefined) && !claude.working && (
          <Button size="sm" variant="outline" disabled={busy} aria-label={`Remove the Claude login from ${server.address}`} title="Deletes the login on the server and starts OpenAgent there again without it. An agent at work there keeps it until it ends. The login itself stays good until its year is over." onClick={() => void act(() => logout(host, server.address, 'claude'))}>
            Remove
          </Button>
        )}
      </LoginLine>
      <ClaudeAccounts d={d} server={server} />
    </ul>
  )
}

/**
 * The Claude accounts a server has beside its own login: its runs take the next free one when
 * one hits its limit. Read from the server once the page shows them; added with a login made in
 * this computer's browser, as the server's own is.
 */
function ClaudeAccounts({ d, server }: { d: Devices; server: ServerRow }) {
  const { host, busy, act } = d
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [unread, setUnread] = useState<string | undefined>()
  const { address, claudeAccounts: accounts, claudeAdding: adding } = server
  useEffect(() => {
    let gone = false
    void loadAccounts(host, address).then(read => {
      if (gone) return
      setUnread(read.ok ? undefined : read.error)
      if (read.ok) void d.reloadServers().catch(() => {})
    })
    return () => {
      gone = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, address])
  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (await act(() => addAccount(host, address, name.trim()))) {
      setNaming(false)
      setName('')
    }
  }
  return (
    <li aria-label="Other Claude accounts" className="space-y-1.5">
      <p>{accounts.length === 0 ? 'Other Claude accounts: none. A run that hits the limit of the login above stops there.' : 'Other Claude accounts: a run that hits a limit goes on with the next free one, in this order.'}</p>
      {accounts.length > 0 && (
        <ul className="space-y-1">
          {accounts.map(account => (
            <li key={account.name} aria-label={account.name} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{account.name}</span>
              <span className="text-muted-foreground">{`${account.added !== undefined ? `added ${day(account.added)}, ` : ''}${accountWords(account)}`}</span>
              <Button size="sm" variant="outline" disabled={busy} aria-label={`Remove the Claude account ${account.name} from ${address}`} title="Takes the account off the server: its runs no longer switch to it. The login itself stays good until its year is over." onClick={() => void act(() => removeAccount(host, address, account.name))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding?.working ? (
        <p>{adding.asking ? `${adding.name}: say yes in the page this computer's browser opened, logged in to ${adding.name}'s Claude account.` : `${adding.name}: one moment, the server is being told.`}</p>
      ) : naming ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={event => void add(event)}>
          <Input aria-label="Whose account it is" placeholder="Whose account, e.g. Dani" value={name} maxLength={40} onChange={event => setName(event.target.value)} className="h-8 w-48" autoFocus />
          <Button size="sm" type="submit" disabled={busy || name.trim() === ''} title="Opens this computer's browser: log in there to that account's Claude and say yes once. The login is made for this server alone and lasts a year.">
            Log in to Claude
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} aria-label={`Add another Claude account to ${address}`} onClick={() => setNaming(true)}>
          <Plus aria-hidden className="h-3.5 w-3.5" />
          Add another Claude account
        </Button>
      )}
      {adding?.said !== undefined && !adding.working && <Said>{`${adding.name}: ${adding.said}`}</Said>}
      {unread !== undefined && <p className="text-muted-foreground">{`The server did not say its other accounts: ${unread}`}</p>}
    </li>
  )
}
