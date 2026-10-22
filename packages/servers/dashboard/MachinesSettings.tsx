import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ChevronRight, Circle, CircleArrowUp, CircleCheck, CircleX, Laptop, Loader2, Plus, Server, UserPlus, UserRound } from 'lucide-react'
import { AddMachineDialog, Badge, Button, Checkbox, ConfirmDialog, Dialog, Input, InviteDialog, RadioGroup, RadioGroupOption, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SettingsSection, Switch, cn, formatDateTime, formatRelative, reachedByLine, useModuleHost, usePolled, type ModuleComputersThrough, type ModuleHost, type ModuleMachine, type ModuleMachines } from '@openagt/dashboard/module'
import { addAccount, addThrough, askLink, connect, forget, idsOf, loadAccounts, loadDevices, loadOther, loadOwn, loadServers, loadShared, login, logout, markAdded, nameOwner, otherLogin, ownCodeLogin, ownGithub, ownLogout, reach, readPersonThere, removeAccount, removeDevice, removePerson, setWho, sharedClaude, sharedForget, sharedGithub, sharedReach, type AccountRow, type Answer, type DeviceRow, type DevicesRead, type DoorLink, type OtherLogin, type OtherRow, type OwnGithub, type OwnRead, type PersonThere, type ServerRow, type ServersRead, type SharedRow, type StepState, type Who } from './servers.js'

// Settings → Machines: the other computers a run can be sent to, each listed once. A server this
// computer installed OpenAgent on is listed with all that is set up on it; a machine added with a
// link, and a person's own computer that keeps a line open to this one, by its name.
//
// "Connect your VPS": a person gives a server's address and a user name, and OpenAgent installs
// itself there over SSH. The install is the `servers` command's own process; the section reads
// how far it is with `servers status` and lists its steps. Once the steps are done the section
// asks the server's door for a link and saves the server among OpenAgent's machines with it, as
// a person does for another machine by pasting its link.
//
// An installed server lists its two logins. GitHub's is this computer's own, copied when the
// person ticks it or presses for it, or one the server gets for itself: GitHub gives the server a
// short code, the row shows it, and the person types it at GitHub. Claude's is made new for the
// server: a press opens this computer's browser, and the person says yes there. Whatever goes to
// the server goes over SSH, from the command's own process: no login ever comes to this page.
//
// An installed server also lets a person, a phone or a browser in: a server has no screen to press
// "Add device" on, so the row's Invite asks the server's door for a code over SSH, and shows it in
// a dialog as the Devices section does, as a QR code and a link to send, until a device got in
// with it. The row also lists the devices that are in on the server, asked of its door over SSH,
// each with a way to take it out: a person sets a server up from here, and does not open the
// server's own page for it.
//
// Each step of an install or an update has its own mark as it runs: waiting, a spinner, done or
// failed. The steps show while there is something to see in them, and fold into one line once
// the server is installed and runs can be sent to it.
//
// A computer at home, which nothing on the internet reaches, is set up as a server the same way,
// "through" a server this computer is in at: it gets no door of its own, and keeps a line to that
// server instead. Its row says who there may start runs on it, in place of an Invite: it is
// reached from that server's page, and from this computer through that server.

const NOT_READ: Answer<ServersRead> | undefined = undefined
const NO_MACHINES: ModuleMachines | undefined = undefined
const NOT_ASKED: Answer<OwnGithub> | undefined = undefined
const NOT_LISTED: Answer<DevicesRead> | undefined = undefined
/**
 * How often a server's devices are asked for again while a code is on the page: a device that
 * just got in shows soon. Each time is a login over SSH, and a server may shut out an address
 * that logs in too often: not more often than this.
 */
const WITH_A_CODE_MS = 10_000
/** How long a read of a server's devices is waited for: one that never answers is not left in the way of the next. */
const DEVICES_ANSWER_MS = 45_000

/** A day, as a person reads it. */
const day = (iso: string | undefined): string => (iso === undefined ? '' : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))

/** One login's line on a server's row: what is there, what a person can do about it, and why the last try failed. */
function LoginLine({ label, words, said, children }: { label: string; words: string; said: string | undefined; children: ReactNode }) {
  return (
    <li aria-label={label} className="space-y-1.5">
      <p>{words}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {said !== undefined && (
        <pre role="alert" className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 font-mono text-foreground">
          {said}
        </pre>
      )}
    </li>
  )
}

/** A step's mark: its own spinner while it runs. */
function StepMark({ state }: { state: StepState }) {
  const className = 'h-3.5 w-3.5 shrink-0'
  if (state === 'running') return <Loader2 aria-hidden className={cn(className, 'animate-spin text-primary')} />
  if (state === 'done') return <CircleCheck aria-hidden className={cn(className, 'text-success')} />
  if (state === 'failed') return <CircleX aria-hidden className={cn(className, 'text-danger')} />
  return <Circle aria-hidden className={cn(className, 'text-muted-foreground/50')} />
}

/** One line of the steps: its mark, its name, and what the server said when it failed. */
function StepLine({ label, state, said, children }: { label: string; state: StepState; said?: string | undefined; children?: ReactNode }) {
  return (
    <li aria-label={`${label}: ${STATE_WORD[state]}`}>
      <span className={cn('flex items-center gap-2', state === 'failed' ? 'text-danger' : state === 'waiting' ? 'text-muted-foreground' : undefined)}>
        <StepMark state={state} />
        {label}
      </span>
      {children}
      {said !== undefined && (
        <pre role="alert" className="mt-1 ml-5.5 overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 font-mono text-foreground">
          {said}
        </pre>
      )}
    </li>
  )
}

/** Where a server is, in a few words with a mark: the first line under its address. */
function ServerState({ tone, children }: { tone: 'working' | 'good' | 'warn' | 'bad' | 'quiet'; children: ReactNode }) {
  return (
    <p role="status" className={cn('flex items-center gap-1.5 text-xs', tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-muted-foreground')}>
      {tone === 'working' ? (
        <Loader2 aria-hidden className="h-3 w-3 shrink-0 animate-spin text-primary" />
      ) : tone === 'warn' ? (
        <CircleArrowUp aria-hidden className="h-3 w-3 shrink-0" />
      ) : tone === 'bad' ? (
        <CircleX aria-hidden className="h-3 w-3 shrink-0" />
      ) : (
        <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone === 'good' ? 'bg-[var(--color-primary)]' : 'bg-muted-foreground/40')} />
      )}
      {children}
    </p>
  )
}

const STATE_WORD: Record<StepState, string> = { waiting: 'not started', running: 'running', done: 'done', failed: 'failed' }

const without = (reasons: Record<string, string>, address: string): Record<string, string> => Object.fromEntries(Object.entries(reasons).filter(([at]) => at !== address))

/** Whether version `a` is older than `b`, by their three numbers; false when either is not three numbers. */
export function olderThan(a: string, b: string): boolean {
  const numbers = (version: string): number[] | undefined => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
    return match ? match.slice(1).map(Number) : undefined
  }
  const [x, y] = [numbers(a), numbers(b)]
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]!
  return false
}

export function MachinesSettings({
  everyMs = 3_000,
  devicesEveryMs = 30_000,
}: {
  /** How often the installs are read again. */
  everyMs?: number
  /** How often a server is asked which devices are in: each time is a login over SSH. */
  devicesEveryMs?: number
}) {
  const host = useModuleHost()
  const { value: read, reload } = usePolled<Answer<ServersRead> | undefined>(() => loadServers(host), NOT_READ, everyMs, [])
  // What this computer last said it is. A server is connected from a person's own computer: a
  // server's own page offers none to connect, and a read that fails later does not bring that back.
  const isServer = useRef<boolean | undefined>(undefined)
  if (read?.ok) isServer.current = read.value.isServer
  // Nothing shows until this computer said which it is, so a server never offers to connect one for a moment.
  if (read === undefined) return null
  return <Machines read={read} reload={reload} everyMs={everyMs} devicesEveryMs={devicesEveryMs} isServer={isServer.current === true} />
}

/** What removing a person does, said before it is done: it cannot be taken back. */
export const REMOVE_PERSON = (account: string): string =>
  `Their devices are taken out, and their own user on the server is deleted with everything in it: their GitHub and Claude logins, their copies of projects, and any work they did not push to GitHub. Their finished runs stay on GitHub. @${account} can be invited again later.`

/** A device that is in on a server: what it is, when it was last there, and a way to take it out. */
function DeviceLine({ device, address, busy, ownKey, onRemove }: { device: DeviceRow; address: string; busy: boolean; /** The device is this computer's OpenAgent, by the key it has on the server. */ ownKey: boolean; onRemove: () => void }) {
  // This computer is in on its server by itself: taken out there alone, its row here would go on asking with a key that opens nothing.
  const own = device.own === true || ownKey
  return (
    <li className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="truncate text-sm">{device.name}</p>
        <p className="text-muted-foreground" title={formatDateTime(device.seen ?? device.added)}>
          {`Added ${formatRelative(device.added)}`}
          {device.seen !== undefined ? `, last seen ${formatRelative(device.seen)}` : ''}
        </p>
        {device.own && ownKey ? (
          <p className="text-muted-foreground">This computer: its OpenAgent, and the line it keeps open to the server. The switch above says what the server may do through the line. To take this computer out, remove the server from this list.</p>
        ) : device.own ? (
          <p className="text-muted-foreground">This computer, by the line it keeps open to the server. The switch above says what the server may do through it.</p>
        ) : ownKey ? (
          <p className="text-muted-foreground">This computer's OpenAgent: it sends runs to the server and reads them with this. To take it out, remove the server from this list.</p>
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

/**
 * The devices that are in on one server, as its door lists them. Asked over SSH, so not often:
 * more often while a code is on the page, which a device is about to get in with.
 */
function ServerDevices({
  host,
  address,
  everyMs,
  awaited,
  busy,
  ownDevice,
  onGotIn,
  onLine,
  onOwner,
  answerMs = DEVICES_ANSWER_MS,
}: {
  host: ModuleHost
  address: string
  everyMs: number
  /** How long one read is waited for. */
  answerMs?: number
  /** A code is on the page for this server. */
  awaited: boolean
  busy: boolean
  /** The id the server lists this computer's OpenAgent under, when this computer said. */
  ownDevice: string | undefined
  /** A device got in while a code was on the page: its name. */
  onGotIn: (name: string) => void
  /** Told with each read whether the server said no to this computer's line. */
  onLine: (refused: boolean) => void
  /** Told with each read who the server's owner is, once named. */
  onOwner: (account: string | undefined) => void
}) {
  // One read at a time, and none for a page nobody looks at: a read that takes long is not joined by the next.
  const asking = useRef<Promise<Answer<DevicesRead>> | undefined>(undefined)
  const answered = useRef<Answer<DevicesRead> | undefined>(undefined)
  const ask = (): Promise<Answer<DevicesRead>> => {
    if (document.hidden && answered.current) return Promise.resolve(answered.current)
    asking.current ??= new Promise<Answer<DevicesRead>>(resolve => {
      const late = setTimeout(() => resolve({ ok: false, error: 'The server did not say in time which devices are in.' }), answerMs)
      void loadDevices(host, address).then(answer => {
        clearTimeout(late)
        resolve(answer)
      })
    })
      .then(answer => (answered.current = answer))
      .finally(() => (asking.current = undefined))
    return asking.current
  }
  const { value: read, reload } = usePolled<Answer<DevicesRead> | undefined>(ask, NOT_LISTED, awaited ? Math.min(everyMs, WITH_A_CODE_MS) : everyMs, [address, awaited], 'previous')
  // The answer of the last removal, shown until the read made after it has landed.
  const [changed, setChanged] = useState<Pick<DevicesRead, 'devices' | 'persons'> | undefined>()
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  // The last list the server gave: a read that fails once says why, and takes nothing off the page.
  const listed = useRef<Pick<DevicesRead, 'devices' | 'persons'> | undefined>(undefined)
  if (read?.ok) listed.current = read.value
  const devices = (changed ?? listed.current)?.devices
  const persons = (changed ?? listed.current)?.persons ?? []
  // By person, the owner first; one list with no heading while nobody else is invited.
  const groups = persons.length ? persons.map(person => ({ person, devices: (devices ?? []).filter(device => (device.person ?? persons[0]!.account) === person.account) })) : [{ person: undefined, devices: devices ?? [] }]

  // What this computer's own door says of its line to the server comes with the list: told at every read, so what a press said meanwhile is put right by the next one.
  useEffect(() => {
    if (!read?.ok) return
    onLine(read.value.lineRefused)
    onOwner(read.value.persons.find(person => person.owner)?.account)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read])

  // The devices that were in when the code came on the page: one more, and the code is spent.
  const before = useRef<string[] | undefined>(undefined)
  // Every id under every row: a computer that gets in again is a new id under the row it had.
  const ids = devices?.flatMap(idsOf).join(',')
  useEffect(() => {
    if (!awaited) return void (before.current = undefined)
    if (ids === undefined) return
    const now = ids.split(',').filter(Boolean)
    if (before.current === undefined) before.current = now
    else {
      const fresh = devices?.find(device => idsOf(device).some(id => !before.current!.includes(id)))
      if (fresh) onGotIn(fresh.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaited, ids])

  const remove = async (taken: () => Promise<Answer<DevicesRead>>): Promise<void> => {
    setRemoving(true)
    setError(undefined)
    const answer = await taken()
    if (answer.ok) {
      // What the server said after the removal is the list from here on, also when the next read fails or is not made.
      listed.current = answer.value
      answered.current = answer
      setChanged(answer.value)
    } else setError(answer.error)
    // A read that was on its way when the device went tells the list before: the next one is asked once it has landed.
    await asking.current?.catch(() => {})
    await reload().catch(() => {})
    setChanged(undefined)
    setRemoving(false)
  }

  if (read === undefined) return null
  return (
    <div className="space-y-2 text-xs">
      <p className="text-sm">{devices !== undefined && devices.length > 0 ? `Who is in (${devices.length})` : 'Who is in'}</p>
      {(devices === undefined || (devices.length === 0 && persons.length < 2)) && (
        <p className="text-muted-foreground">{devices === undefined ? 'The devices that are in on the server could not be read.' : 'Nobody yet. Invite gives a code for a person, a phone or a browser.'}</p>
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
            {person?.problem !== undefined && !person.working && (
              <p role="alert" className="text-danger">{`@${person.account}'s own user on the server could not be made: ${person.problem.replace(/\.?$/, '.')} Invite them again to try again.`}</p>
            )}
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
      {(error ?? (read.ok ? undefined : read.error)) !== undefined && (
        <pre role="alert" className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 font-mono text-foreground">
          {error ?? (read.ok ? undefined : read.error)}
        </pre>
      )}
    </div>
  )
}

/** Where a computer saved through a server is reached: the server's address, then this. */
const THROUGH = '/_remote-access/via/'

/** A server's address as a person reads it: its host, without the scheme. */
const hostOf = (url: string): string => new URL(url).host

/** Names as a sentence says them: `@a`, `@a and @b`, `@a, @b and @c`. */
const named = (accounts: readonly string[]): string => {
  const said = accounts.map(account => `@${account}`)
  return said.length < 2 ? (said[0] ?? '') : `${said.slice(0, -1).join(', ')} and ${said.at(-1)}`
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
      <p className="text-sm">Who can start runs on it</p>
      <RadioGroup aria-label={`Who can start runs on ${server.address}`} value={who} disabled={busy} onValueChange={next => void pick(next as Who)}>
        <RadioGroupOption value="nobody">Nobody: its runs only show there</RadioGroupOption>
        <RadioGroupOption value="me">Only me</RadioGroupOption>
        <RadioGroupOption value="everyone">
          {`Everyone on ${at}${people !== undefined ? ` (${people} ${people === 1 ? 'person' : 'people'})` : ''}`}
          <span className="block w-full pl-6 text-xs text-muted-foreground">
            Each person's runs use their own logins, never yours.
            <br />
            Their agents run on your home network.
          </span>
        </RadioGroupOption>
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
function ComputersThrough({ host, machine, busy, everyMs }: { host: ModuleHost; machine: ModuleMachine; busy: boolean; everyMs: number }) {
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
    <div className="space-y-2 text-xs">
      <p className="text-sm">Computers on this server</p>
      {read.ok ? (
        <ul aria-label={`The computers on ${machine.label}`} className="space-y-2">
          {read.computers.map(computer => (
            <li key={computer.id} className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2">
                {computer.owner !== undefined ? <Server aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Laptop aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate text-sm">{computer.name}</span>
                {/* Another person's, set up as a server and shared with everyone on this one. */}
                {computer.owner !== undefined && <span className="shrink-0 text-muted-foreground">{`· @${computer.owner}'s · for everyone`}</span>}
                <ServerState tone={computer.online ? 'good' : 'quiet'}>{computer.online ? 'Online' : 'Away'}</ServerState>
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
        <p className="text-muted-foreground">{`Its computers could not be read: ${read.error}`}</p>
      )}
      {read.ok && read.computers.some(computer => !computer.added) && <p className="text-muted-foreground">Added, a computer is in "Run on" here: a run started on it goes through this server.</p>}
      {error !== undefined && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** A machine that is no server of this computer's: one added with a link, a computer saved through a server, or a person's own computer that keeps a line open to this one. */
function MachineLine({ host, machine, known, busy, everyMs, onRemove }: { host: ModuleHost; machine: ModuleMachine; /** The machines were asked whether they answer. */ known: boolean; busy: boolean; everyMs: number; onRemove: () => void }) {
  const computer = reachedByLine(machine.url)
  const through = machine.url.includes(THROUGH)
  const state = !known ? 'Checking…' : machine.version !== undefined ? 'Online' : 'Offline'
  return (
    <li aria-label={machine.label} className="flex items-start justify-between gap-4 py-4">
      <div className="flex min-w-0 gap-3">
        <Laptop aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium">{machine.label}</p>
          <ServerState tone={state === 'Online' ? 'good' : 'quiet'}>{state}</ServerState>
          {computer ? (
            <p className="text-xs text-muted-foreground">Your computer. It keeps a line open to this server. Removed here, it is back when it calls again: to take it out, remove it under Devices.</p>
          ) : through ? (
            <p className="text-xs text-muted-foreground">A computer reached through its server. Removed here, it is no longer in "Run on"; the server keeps it.</p>
          ) : (
            <p className="truncate text-xs text-muted-foreground">{machine.url}</p>
          )}
          {!computer && !through && known && (
            <div className="pt-2">
              <ComputersThrough host={host} machine={machine} busy={busy} everyMs={everyMs} />
            </div>
          )}
        </div>
      </div>
      <Button size="sm" variant="ghost" className="shrink-0" disabled={busy} aria-label={`Remove ${machine.label}`} onClick={onRemove}>
        Remove
      </Button>
    </li>
  )
}

/**
 * A saved machine, as it is listed: a server someone invited this computer's person to is shown as
 * a server, with what that person has there; any other machine by its name. Which one it is, its
 * door says: a computer several people use answers who this computer's person is there.
 */
function OtherMachine({ host, machine, known, busy, everyMs, workingMs, ownGithub: account, noLogin, onRemove }: { host: ModuleHost; machine: ModuleMachine; known: boolean; busy: boolean; everyMs: number; /** How often while a login is being changed there. */ workingMs: number; ownGithub: string | undefined; noLogin: string | undefined; onRemove: () => Promise<void> }) {
  // Only a machine with a door of its own on the internet can be a computer several people use.
  const asks = machine.url.startsWith('https://') && !machine.url.includes(THROUGH)
  const { value: said } = usePolled<PersonThere | undefined>(asks ? async () => {
    const asked = await host.machinePerson(machine.id)
    return asked.ok ? readPersonThere(asked.said) : undefined
  } : null, undefined, Math.max(everyMs, 30_000), [machine.id, asks], 'previous')
  if (said && !said.owner && said.account !== undefined) return <SharedServer host={host} machine={machine} person={said} busy={busy} everyMs={everyMs} workingMs={workingMs} ownGithub={account} noLogin={noLogin} onRemove={onRemove} />
  if (machine.owner !== undefined) return <OtherComputer host={host} machine={machine} owner={machine.owner} known={known} busy={busy} everyMs={everyMs} workingMs={workingMs} ownGithub={account} noLogin={noLogin} onRemove={() => void onRemove()} />
  return <MachineLine host={host} machine={machine} known={known} busy={busy} everyMs={everyMs} onRemove={() => void onRemove()} />
}

/** The words for one of this person's logins on another person's computer: a copy, one made there, or none yet. */
function otherWords(label: 'GitHub' | 'Claude', login: OtherLogin | undefined, name: string, server: string): string {
  if (login?.source === 'copied') return `${label}: copied from ${login.from ?? server}.`
  if (login?.source === 'made') return `${label}: made here.`
  return `${label}: not on ${name} yet: it is copied from ${server} at your first run there.`
}

/**
 * Another person's computer, set up as a server and shared with everyone on a server this
 * computer's person is in at. This person has an OpenAgent of their own there, as a user of their
 * own, and their runs there use their own logins: copies from their OpenAgent on the server, made
 * the first time they start a run there. This row says which logins it has, and makes one here in
 * place of a copy: GitHub's copied from this computer, Claude's made in this computer's browser.
 * A login made here is no copy, and no copy from the server takes its place.
 */
function OtherComputer({ host, machine, owner, known, busy: pageBusy, everyMs, workingMs, ownGithub: account, noLogin, onRemove }: { host: ModuleHost; machine: ModuleMachine; owner: string; known: boolean; busy: boolean; everyMs: number; workingMs: number; ownGithub: string | undefined; noLogin: string | undefined; onRemove: () => void }) {
  const [working, setWorking] = useState(false)
  const pace = working ? workingMs : everyMs
  const { value: read, reload } = usePolled<Answer<OtherRow[]> | undefined>(() => loadOther(host, [machine.url]), undefined, pace, [machine.url, pace], 'previous')
  const [busyHere, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const busy = pageBusy || busyHere
  const row = read?.ok ? read.value.find(candidate => candidate.url === machine.url) : undefined
  const making = row?.making ?? { there: false, working: false }
  useEffect(() => setWorking(making.working), [making.working])
  const name = machine.label
  // The server both computers are in at: where the copies come from.
  const server = machine.url.includes(THROUGH) ? new URL(machine.url).host : 'this server'

  const act = async (change: () => Promise<Answer<unknown>>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const answer = await change()
    if (!answer.ok) setError(answer.error)
    await reload().catch(() => {})
    setBusy(false)
  }
  const state = !known ? 'Checking…' : machine.version !== undefined ? 'Online' : 'Offline'
  return (
    <li aria-label={name} className="space-y-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <Server aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-medium">{name}</p>
            <ServerState tone={state === 'Online' ? 'good' : 'quiet'}>{state}</ServerState>
            <p className="text-xs text-muted-foreground">{`@${owner}'s server, for everyone on ${server}. Your runs there use your own GitHub and Claude logins.`}</p>
          </div>
        </div>
        <Button size="sm" variant="ghost" className="shrink-0" disabled={busy} aria-label={`Remove ${name}`} onClick={onRemove}>
          Remove
        </Button>
      </div>
      <div className="space-y-2 pl-7">
        <p className="text-sm">Logins on the server</p>
        {row?.error !== undefined && <p className="text-xs text-muted-foreground">{`${name} did not say: ${row.error}`}</p>}
        {read !== undefined && !read.ok && <p className="text-xs text-muted-foreground">{`${name} did not say: ${read.error}`}</p>}
        <ul aria-label={`Your logins on ${name}`} className="space-y-2 text-xs">
          <LoginLine label="GitHub" words={otherWords('GitHub', row?.github, name, server)} said={undefined}>
            <Button size="sm" variant="outline" disabled={busy || account === undefined} aria-label={`Log in to GitHub on ${name} instead`} title={account !== undefined ? `Copies the login of ${account} from this computer to your own OpenAgent on ${name}. A copy from ${server} no longer takes its place.` : noLogin} onClick={() => void act(() => otherLogin(host, machine.url, 'github'))}>
              Log in here instead
            </Button>
          </LoginLine>
          <LoginLine
            label="Claude"
            words={making.asking ? "Claude: say yes in the page this computer's browser opened." : making.working ? `Claude: one moment, ${name} is being told.` : otherWords('Claude', row?.claude, name, server)}
            said={making.working ? undefined : making.said}
          >
            <Button size="sm" variant="outline" disabled={busy || (making.working && making.asking !== true)} aria-label={`Log in to Claude on ${name} instead`} title={`Opens this computer's browser, where you say yes once. The login is made for your OpenAgent on ${name} alone and lasts a year. A copy from ${server} no longer takes its place.`} onClick={() => void act(() => otherLogin(host, machine.url, 'claude'))}>
              {making.asking ? 'Start over' : 'Log in here instead'}
            </Button>
          </LoginLine>
        </ul>
        {error !== undefined && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </li>
  )
}

/**
 * A server someone invited this computer's person to: that person has an OpenAgent of their own
 * there, as a user of their own, and their runs there use their own logins. This row gives that
 * OpenAgent its logins, keeps this computer's line to it, and lists the person's own devices,
 * all through the server's door with this computer's key there: the person has no way in over SSH.
 * What only the server's owner does (the install, an update, an invite) is not here.
 */
function SharedServer({ host, machine, person, busy: pageBusy, everyMs, workingMs, ownGithub: account, noLogin, onRemove }: { host: ModuleHost; machine: ModuleMachine; person: PersonThere; busy: boolean; everyMs: number; workingMs: number; ownGithub: string | undefined; noLogin: string | undefined; onRemove: () => Promise<void> }) {
  // Read often only while a login is being changed: each read of the server's side is a call through its door.
  const [working, setWorking] = useState(false)
  const pace = working ? workingMs : everyMs
  const { value: own, reload: reloadOwn } = usePolled<Answer<OwnRead> | undefined>(() => loadOwn(host, machine.id), undefined, pace, [machine.id, pace], 'previous')
  const { value: kept, reload: reloadKept } = usePolled<Answer<SharedRow[]> | undefined>(() => loadShared(host, [machine.url]), undefined, pace, [machine.url, pace], 'previous')
  const [devices, setDevices] = useState<DeviceRow[] | undefined>()
  const [busyHere, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const busy = pageBusy || busyHere
  const here = kept?.ok ? kept.value.find(row => row.url === machine.url) : undefined
  const logins = own?.ok ? own.value.logins : undefined
  const github = logins?.github ?? { there: false, working: false }
  // Whether the login is there is the server's to say; this computer only makes it, in its browser.
  const claudeThere = logins?.claude ?? { there: false, working: false }
  const making = here?.claude ?? { there: false, working: false }
  const claude = { ...claudeThere, working: making.working, ...(making.asking ? { asking: true } : {}), said: making.working ? undefined : (making.said ?? claudeThere.said) }
  const listed = devices ?? person.devices
  const name = machine.label
  const nowWorking = github.working || claude.working
  useEffect(() => setWorking(nowWorking), [nowWorking])

  const act = async (change: () => Promise<Answer<unknown>>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const answer = await change()
    if (!answer.ok) setError(answer.error)
    await Promise.all([reloadOwn(), reloadKept()]).catch(() => {})
    setBusy(false)
  }
  const state = machine.version !== undefined ? 'good' : 'quiet'
  return (
    <li aria-label={name} className="space-y-4 py-4">
      <div className="flex min-w-0 gap-3">
        <Server aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium">{name}</p>
          <ServerState tone={state}>{machine.version !== undefined ? `OpenAgent ${machine.version}.` : 'Does not answer right now.'}</ServerState>
          <p className="text-xs text-muted-foreground">{`You are in as @${person.account}. Your runs there are yours: they use your own GitHub and Claude logins.`}</p>
        </div>
      </div>
      <div className="space-y-4 pl-7">
        {(!github.there || !claude.there) && own?.ok && (
          <p className="text-xs text-warning">Before your first run there: log in to GitHub and Claude below.</p>
        )}
        <label className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-sm">Start runs on this computer from the phone</span>
            <span className="block text-xs text-muted-foreground">
              {here?.lineRefused
                ? `Off: ${name} no longer lets this computer in for its line. Turn it on to set the line up again.`
                : here?.reach === 'full'
                  ? `On: on your page at ${name}, "Run on" offers this computer, and a run started there runs here. This computer must be on.`
                  : here?.reach === 'watch'
                    ? `Off: your page at ${name} shows this computer's runs. It cannot start one here.`
                    : `Off. Turn it on to pick this computer under "Run on" on your page at ${name}, from your phone.`}
            </span>
          </span>
          <Switch aria-label={`Start runs on this computer from ${name}`} checked={here?.reach === 'full' && !here.lineRefused} disabled={busy || !kept} onCheckedChange={on => void act(() => sharedReach(host, machine.url, on ? 'full' : 'watch'))} />
        </label>
        <div className="space-y-2">
          <p className="text-sm">Your logins on the server</p>
          {own !== undefined && !own.ok && <p className="text-xs text-muted-foreground">{`Your OpenAgent on ${name} did not say: ${own.error}`}</p>}
          <ul aria-label={`Your logins on ${name}`} className="space-y-2 text-xs">
            <LoginLine
              label="GitHub"
              words={
                github.asking && github.code !== undefined
                  ? `GitHub: type the code ${github.code} at github.com/login/device, and say yes there.`
                  : github.working
                    ? 'GitHub: one moment, the server is being told.'
                    : github.there
                      ? `GitHub: logged in as ${github.account ?? person.account} since ${day(github.since)}.`
                      : github.said !== undefined
                        ? 'GitHub: the last try did not go through.'
                        : 'GitHub: not logged in on the server.'
              }
              said={github.working ? undefined : github.said}
            >
              <Button size="sm" variant="outline" disabled={busy || github.working || account === undefined} aria-label={`Copy my GitHub login to ${name}`} title={account !== undefined ? `Copies the login of ${account} from this computer to your own OpenAgent on the server. It must be @${person.account}'s.` : noLogin} onClick={() => void act(() => sharedGithub(host, machine.url))}>
                {github.there ? 'Copy again' : 'Copy my login'}
              </Button>
              <Button size="sm" variant="outline" disabled={busy || (github.working && github.asking !== true)} aria-label={`Log in to GitHub for ${name}`} title={`The server asks GitHub for a login of your own. GitHub gives a short code: you type it at github.com/login/device, logged in as @${person.account}, and say yes there.`} onClick={() => void act(() => ownCodeLogin(host, machine.id))}>
                {github.asking ? 'Start over' : 'Log in to GitHub'}
              </Button>
              {github.asking && github.code !== undefined && (
                <a href="https://github.com/login/device" target="_blank" rel="noreferrer" className="self-center underline">
                  Open GitHub
                </a>
              )}
              {(github.there || github.said !== undefined) && !github.working && (
                <Button size="sm" variant="outline" disabled={busy} aria-label={`Remove my GitHub login from ${name}`} onClick={() => void act(() => ownLogout(host, machine.id, 'github'))}>
                  Remove
                </Button>
              )}
            </LoginLine>
            <LoginLine
              label="Claude"
              words={
                claude.asking
                  ? "Claude: say yes in the page this computer's browser opened."
                  : claude.working
                    ? 'Claude: one moment, the server is being told.'
                    : claude.there
                      ? `Claude: logged in since ${day(claude.since)}, good until about ${day(claude.ends)}.`
                      : claude.said !== undefined
                        ? 'Claude: the last try did not go through.'
                        : 'Claude: not logged in on the server.'
              }
              said={claude.said}
            >
              <Button size="sm" variant={claude.there || claude.working ? 'outline' : 'default'} disabled={busy || (claude.working && claude.asking !== true)} aria-label={`Log in to Claude for ${name}`} title="Opens this computer's browser, where you say yes once. The login is made for your OpenAgent on the server alone and lasts a year." onClick={() => void act(() => sharedClaude(host, machine.url))}>
                {claude.asking ? 'Start over' : claude.there ? 'Log in again' : 'Log in to Claude'}
              </Button>
              {(claude.there || claude.said !== undefined) && !claude.working && (
                <Button size="sm" variant="outline" disabled={busy} aria-label={`Remove my Claude login from ${name}`} onClick={() => void act(() => ownLogout(host, machine.id, 'claude'))}>
                  Remove
                </Button>
              )}
            </LoginLine>
          </ul>
        </div>
        <div className="space-y-2">
          <p className="text-sm">{`Your devices on ${name} (${listed.length})`}</p>
          <ul aria-label={`Your devices on ${name}`} className="space-y-2">
            {listed.map(device => (
              <DeviceLine
                key={device.id}
                device={here?.line !== undefined && idsOf(device).includes(here.line) ? { ...device, own: true } : device}
                address={name}
                busy={busy}
                ownKey={machine.device !== undefined && idsOf(device).includes(machine.device)}
                onRemove={() =>
                  void act(async () => {
                    const removed = await host.removeMachineDevice(machine.id, device.id)
                    if (!removed.ok) return removed
                    const after = readPersonThere(removed.said)
                    if (after) setDevices(after.devices)
                    return { ok: true, value: undefined }
                  })
                }
              />
            ))}
          </ul>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2 text-muted-foreground"
          disabled={busy}
          aria-label={`Remove ${name}`}
          title="Takes the server off this list, and this computer out of it. Your user, your logins and your projects on the server stay until its owner removes you."
          onClick={() =>
            void act(async () => {
              const forgotten = await sharedForget(host, machine.url)
              if (!forgotten.ok) return forgotten
              await onRemove()
              return { ok: true, value: undefined }
            })
          }
        >
          Remove server
        </Button>
        {error !== undefined && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </li>
  )
}

/** How full an account was at the last run on it: its week, else its five hours; at a limit, when it frees. */
function accountWords(account: AccountRow, now = Date.now()): string {
  if (account.limitedUntil !== undefined && account.limitedUntil > now) return `at its limit until ${formatDateTime(new Date(account.limitedUntil).toISOString())}`
  const window = account.windows?.find(w => w.window === 'seven_day') ?? account.windows?.find(w => w.window === 'five_hour')
  if (window === undefined) return 'no run on it yet'
  return `${Math.round(window.percentUsed)}% of its ${window.window === 'seven_day' ? 'week' : 'five hours'} used at its last run`
}

/**
 * The Claude accounts a server has beside its own login: its runs take the next free one when
 * one hits its limit. Read from the server once the row shows; added with a login made in this
 * computer's browser, as the server's own is.
 */
function ClaudeAccounts({ host, server, busy, act, reload }: { host: ModuleHost; server: ServerRow; busy: boolean; act: (change: () => Promise<Answer<unknown>>) => Promise<boolean>; reload: () => Promise<unknown> }) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [unread, setUnread] = useState<string | undefined>()
  const { address, claudeAccounts: accounts, claudeAdding: adding } = server
  useEffect(() => {
    let gone = false
    void loadAccounts(host, address).then(read => {
      if (gone) return
      setUnread(read.ok ? undefined : read.error)
      if (read.ok) void reload().catch(() => {})
    })
    return () => {
      gone = true
    }
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
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                aria-label={`Remove the Claude account ${account.name} from ${address}`}
                title="Takes the account off the server: its runs no longer switch to it. The login itself stays good until its year is over."
                onClick={() => void act(() => removeAccount(host, address, account.name))}
              >
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
      {adding?.said !== undefined && !adding.working && (
        <pre role="alert" className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 font-mono text-foreground">
          {`${adding.name}: ${adding.said}`}
        </pre>
      )}
      {unread !== undefined && <p className="text-muted-foreground">{`The server did not say its other accounts: ${unread}`}</p>}
    </li>
  )
}

/** The section itself. On a computer that is itself a server it lists the machines, and offers no server to connect. */
function Machines({ read, reload, everyMs, devicesEveryMs, isServer }: { read: Answer<ServersRead>; reload: () => Promise<unknown>; everyMs: number; devicesEveryMs: number; isServer: boolean }) {
  const host = useModuleHost()
  const { value: known, reload: reloadMachines } = usePolled<ModuleMachines | undefined>(() => host.machines(), NO_MACHINES, Math.max(everyMs, 10_000), [])
  const [addingByLink, setAddingByLink] = useState(false)
  // Whose GitHub login a copy would be: asked of this computer's own gh, which asks GitHub, so not often.
  const { value: own } = usePolled<Answer<OwnGithub> | undefined>(isServer ? null : () => ownGithub(host), NOT_ASKED, Math.max(everyMs, 5 * 60_000), [isServer])
  const account = own?.ok && 'account' in own.value ? own.value.account : undefined
  /** Why there is no GitHub login to copy, once this computer said so. */
  const noLogin = own === undefined || account !== undefined ? undefined : own.ok ? ('problem' in own.value ? own.value.problem : undefined) : own.error
  const [address, setAddress] = useState('')
  const [user, setUser] = useState('root')
  const [copy, setCopy] = useState(false)
  // How the server to connect is reached: at its own address, or through a server this computer is in at, by that server's address.
  const [reached, setReached] = useState<'internet' | 'through'>('internet')
  const [via, setVia] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  // Why a server whose install ended is not among the machines, by its address.
  const [notAdded, setNotAdded] = useState<Record<string, string>>({})
  const adding = useRef(new Set<string>())
  // The servers that said no to the key this computer asks for its line with, by address: the switch then reads off.
  const [refusedLines, setRefusedLines] = useState<Record<string, boolean>>({})
  // Each server's owner, by address, once its door names one.
  const [owners, setOwners] = useState<Record<string, string | undefined>>({})
  // The server whose Invite dialog is open; the code on its page, which a device is about to get in
  // with; and the name of the one that got in with it.
  const [inviting, setInviting] = useState<string | undefined>()
  const [code, setCode] = useState<(DoorLink & { address: string }) | undefined>()
  const [joined, setJoined] = useState<string | undefined>()
  const [connecting, setConnecting] = useState(false)
  // The server whose Update or Try again was pressed, until the command answered: its button spins.
  const [pressed, setPressed] = useState<string | undefined>()
  // The steps a person opened on a server whose steps are folded, by its address.
  const [opened, setOpened] = useState<Record<string, boolean>>({})

  // The servers as last read: a read that fails once says so, and takes no row off the page.
  const lastServers = useRef<ServerRow[]>([])
  if (read.ok) lastServers.current = read.value.servers
  // A server lists no servers of its own: what its file may hold from before it was one is not shown.
  const servers = isServer ? [] : lastServers.current
  // The machines that are no server's row: each machine is listed once.
  const others = (known?.machines ?? []).filter(machine => !servers.some(server => server.url === machine.url))
  // The servers a computer can be reached through: those with a door of their own on the internet.
  const doors = (known?.machines ?? []).filter(machine => machine.url.startsWith('https://') && !machine.url.includes(THROUGH))
  const through = reached === 'through' ? (via ?? doors[0]?.url) : undefined
  const inMachines = (server: ServerRow, among = known) => among?.machines.find(machine => machine.url === server.url)
  const installed = (server: ServerRow): boolean => !server.working && server.steps.every(step => step.state === 'done')

  const act = async (change: () => Promise<Answer<unknown>>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    const answer = await change()
    if (!answer.ok) setError(answer.error)
    await reload().catch(() => {})
    setBusy(false)
    return answer.ok
  }

  const install = async (at: string, as: string, github = false, through?: string): Promise<boolean> => {
    if (!known || known.version === 'unknown') {
      setError('This computer could not say which OpenAgent it runs.')
      return false
    }
    setNotAdded(reasons => without(reasons, at))
    setPressed(at)
    const started = await act(() => connect(host, at, as, known.version, github, through))
    setPressed(undefined)
    return started
  }

  /**
   * The last step, which is this computer's: the server's door gives a link, and OpenAgent saves
   * the server with it. A server that is among the machines and answers is left as it is; one
   * that is there and does not answer was made anew since, and gets in again with a new link.
   */
  const addToMachines = async (server: ServerRow): Promise<void> => {
    // One at a time for a server: every look at the page would otherwise ask for a link of its own.
    if (adding.current.has(server.address)) return
    adding.current.add(server.address)
    setNotAdded(reasons => without(reasons, server.address))
    const stopped = (why: string): void => setNotAdded(reasons => ({ ...reasons, [server.address]: why }))
    try {
      // A computer reached through a server is saved through that server, by its line: it has no door to give a link.
      if (server.through !== undefined) {
        const added = await addThrough(host, server.address)
        if (!added.ok) return stopped(added.error)
        await Promise.all([reload(), reloadMachines()]).catch(() => {})
        return
      }
      // Read now, not as the page last saw them: the machines change from the launcher, too.
      if (inMachines(server, await host.machines())?.version === undefined) {
        const link = await askLink(host, server.address)
        const added = link.ok ? await host.addMachine(link.value.url, server.address) : link
        if (!added.ok) return stopped(added.error)
        // At once: this computer has a new key there, and the row names its own entry among the server's devices by it.
        await reloadMachines().catch(() => {})
      }
      const told = await markAdded(host, server.address)
      if (!told.ok) return stopped(told.error)
      // A server just connected can start runs on this computer, until the person says otherwise:
      // the switch on its row. One that could not be given its line shows the switch off.
      if (told.value.find(row => row.address === server.address)?.reach === undefined) await reach(host, server.address, 'full')
      await Promise.all([reload(), reloadMachines()]).catch(() => {})
    } catch (err) {
      // Told, so the page does not try by itself again at its next look.
      stopped(err instanceof Error ? err.message : String(err))
    } finally {
      adding.current.delete(server.address)
    }
  }

  // A server whose install just ended is added by itself, once: a failure is told, and tried again on a press.
  useEffect(() => {
    if (!known) return
    for (const server of servers) if (server.adding && installed(server) && notAdded[server.address] === undefined) void addToMachines(server)
  })

  /** Take a machine off the list, and this computer out of it; whether it went. */
  const takeOut = async (machine: ModuleMachine): Promise<boolean> => {
    const removed = await host.removeMachine(machine.id).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    if (!removed.ok) setError(removed.error)
    await reloadMachines().catch(() => {})
    return removed.ok
  }

  const removeMachine = async (machine: ModuleMachine): Promise<void> => {
    setBusy(true)
    setError(undefined)
    await takeOut(machine)
    setBusy(false)
  }

  /**
   * Take a server off the list: this computer's key there, the line it keeps to it, and its row.
   * A server a run is at work on stays as it is, and the section says why.
   */
  const removeServer = async (server: ServerRow): Promise<void> => {
    // From the press on: the machines are asked first, and a second press meanwhile is no second removal.
    setBusy(true)
    setError(undefined)
    const machine = inMachines(server, await host.machines().catch(() => known))
    if (!machine || (await takeOut(machine))) {
      const forgotten = await forget(host, server.address)
      if (!forgotten.ok) setError(forgotten.error)
      await reload().catch(() => {})
    }
    setBusy(false)
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!address.trim() || !user.trim()) return
    // The server is in the list from here on, its steps running: the dialog has done its part.
    void install(address.trim(), user.trim(), copy && account !== undefined, through).then(started => {
      if (!started) return
      setAddress('')
      setConnecting(false)
    })
  }

  const empty = known !== undefined && servers.length === 0 && others.length === 0
  // The first thing to do on an empty list is the one filled button; with servers listed, a server's own Invite is.
  const connectButton = (
    <Button size="sm" variant={empty ? 'default' : 'outline'} className="whitespace-nowrap" onClick={() => setConnecting(true)}>
      <Server className="h-3.5 w-3.5" aria-hidden />
      Connect a server
    </Button>
  )
  const addButton = (
    <Button size="sm" variant="outline" className="whitespace-nowrap" onClick={() => setAddingByLink(true)}>
      <Plus className="h-3.5 w-3.5" aria-hidden />
      Add machine
    </Button>
  )

  return (
    <SettingsSection
      description={
        isServer
          ? 'The other computers that run OpenAgent, where a run can be sent from here.'
          : 'The other computers that run OpenAgent, where a run can be sent. Install OpenAgent on a server of yours (a VPS) from here, or add a computer that already runs it.'
      }
      action={
        // Nothing before the machines are known: a button that moved into the empty list as they came would close what it opened.
        known === undefined ? undefined : isServer ? addButton : empty ? undefined : (
          <div className="flex flex-wrap justify-end gap-2">
            {connectButton}
            {addButton}
          </div>
        )
      }
    >
      {empty && !isServer && (
        <ul aria-label="Ways to add a machine" className="divide-y divide-border">
          <li className="flex items-start justify-between gap-4 py-4 first:pt-0">
            <div className="flex min-w-0 gap-3">
              <Server aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Your own server</p>
                <p className="text-xs text-muted-foreground">A VPS you can SSH into. OpenAgent installs itself there, then you reach it from your phone, from anywhere.</p>
              </div>
            </div>
            {connectButton}
          </li>
          <li className="flex items-start justify-between gap-4 py-4 last:pb-0">
            <div className="flex min-w-0 gap-3">
              <Laptop aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium">A computer that runs OpenAgent</p>
                <p className="text-xs text-muted-foreground">No machines saved. To add one that already runs OpenAgent, use the link it gives: its Settings, Devices, Add device.</p>
              </div>
            </div>
            {addButton}
          </li>
        </ul>
      )}
      {empty && isServer && <p className="py-3 text-sm text-muted-foreground">No machines saved.</p>}
      {(servers.length > 0 || others.length > 0) && (
        <ul aria-label="Machines" className="divide-y divide-border">
          {servers.map(server => {
            const machine = inMachines(server)
            const failed = !server.working && server.steps.some(step => step.state === 'failed')
            const behind = machine?.version !== undefined && known !== undefined && olderThan(machine.version, known.version)
            // A step this computer's OpenAgent brings and the server's install never ran: the same press as an update runs it.
            const unfinished = !server.working && !failed && server.steps.some(step => step.state === 'waiting')
            const reason = notAdded[server.address]
            const { github, claude } = server.logins
            const lineRefused = refusedLines[server.address] === true
            const done = installed(server)
            // An install that runs again on a server that is among the machines is an update.
            const doing = machine ? 'Updating' : 'Installing'
            const current = server.steps.findIndex(step => step.state !== 'done')
            const sendable: StepState = machine ? 'done' : reason !== undefined ? 'failed' : server.adding ? 'running' : 'waiting'
            // The steps fold into one line once there is nothing left to see in them.
            const settled = done && machine !== undefined && !github.working
            const showSteps = !settled || opened[server.address] === true
            const spins = busy && pressed === server.address
            return (
              <li key={server.address} aria-label={server.address} className="space-y-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="flex min-w-0 gap-3">
                    <Server aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 space-y-0.5">
                      <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        <span className="truncate">{server.address}</span>
                        {server.through !== undefined && <Badge>Server</Badge>}
                      </p>
                      {server.working ? (
                        <ServerState tone="working">{current < 0 ? `${doing}…` : `${doing}: step ${current + 1} of ${server.steps.length}`}</ServerState>
                      ) : failed ? (
                        <ServerState tone="bad">{`${machine ? 'The update' : 'The install'} stopped at a step.`}</ServerState>
                      ) : machine?.version !== undefined ? (
                        behind ? (
                          <ServerState tone="warn">{`OpenAgent ${machine.version}: behind this computer, which runs ${known!.version}.`}</ServerState>
                        ) : (
                          <ServerState tone="good">{`OpenAgent ${machine.version}.`}</ServerState>
                        )
                      ) : machine ? (
                        <ServerState tone="quiet">Does not answer right now.</ServerState>
                      ) : done && server.adding && reason === undefined ? (
                        <ServerState tone="working">Connecting…</ServerState>
                      ) : done ? (
                        <ServerState tone={reason !== undefined ? 'bad' : 'quiet'}>Installed. A run cannot be sent to it yet.</ServerState>
                      ) : (
                        <ServerState tone="quiet">{`Logs in as ${server.user}.`}</ServerState>
                      )}
                      {server.through !== undefined && <p className="text-xs text-muted-foreground">{`Reached through ${hostOf(server.through)}`}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(behind || unfinished) && !server.working && !failed && (
                      <Button size="sm" disabled={busy || !known} aria-label={`Update ${server.address}`} onClick={() => void install(server.address, server.user)}>
                        {spins && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                        Update
                      </Button>
                    )}
                    {failed && (
                      // As Connect: not before this computer said which OpenAgent it runs, the one the server gets.
                      <Button size="sm" disabled={busy || !known} aria-label={`Try ${server.address} again`} onClick={() => void install(server.address, server.user, github.wanted === true)}>
                        {spins && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                        Try again
                      </Button>
                    )}
                    {done && machine?.version === undefined && (reason !== undefined || !server.adding) && (
                      <Button size="sm" variant="outline" disabled={busy} aria-label={machine ? `Connect ${server.address} again` : `Finish connecting ${server.address}`} onClick={() => void addToMachines(server)}>
                        {machine ? 'Connect again' : 'Finish connecting'}
                      </Button>
                    )}
                    {/* A computer reached through a server lets nobody in by itself: it is reached from that server. */}
                    {done && server.through === undefined && (
                      <Button
                        size="sm"
                        variant={machine?.version !== undefined && !behind ? 'default' : 'outline'}
                        disabled={busy}
                        aria-label={`Invite to ${server.address}`}
                        title="A code for a person, a phone or a browser: scanned or opened once, it lets them into OpenAgent on the server, from anywhere."
                        onClick={() => {
                          setJoined(undefined)
                          setInviting(server.address)
                        }}
                      >
                        <UserPlus className="h-3.5 w-3.5" aria-hidden />
                        Invite
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-4 pl-7">
                  {showSteps ? (
                    <div className="space-y-1.5">
                    <ol aria-label={`The install on ${server.address}`} className="space-y-1.5 text-xs">
                      {server.steps.map(step => (
                        <StepLine key={step.id} label={step.label} state={step.state} said={step.state === 'failed' ? step.said : undefined}>
                          {step.id === 'login' && step.state === 'done' && server.fingerprint !== undefined && (
                            <span className="ml-5.5 block break-all font-mono text-[11px] text-muted-foreground">{`The server's key: ${server.fingerprint}`}</span>
                          )}
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
                        <button type="button" className="ml-5.5 text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setOpened(steps => ({ ...steps, [server.address]: false }))}>
                          Hide the steps
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-expanded={false}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setOpened(steps => ({ ...steps, [server.address]: true }))}
                    >
                      <CircleCheck aria-hidden className="h-3.5 w-3.5 text-success" />
                      {`Installed, as ${server.user}`}
                      <ChevronRight aria-hidden className="h-3 w-3" />
                    </button>
                  )}
                  {done && server.through !== undefined && <WhoCanStart host={host} server={{ ...server, through: server.through }} busy={busy} onChange={act} />}
                  {/* This computer keeps no line to a computer reached through a server: that one keeps its line to its server. */}
                  {done && machine && server.through === undefined && (
                    <label className="flex items-start justify-between gap-4">
                      <span className="min-w-0">
                        <span className="block text-sm">Start runs on this computer from the phone</span>
                        <span className="block text-xs text-muted-foreground">
                          {lineRefused
                            ? `Off: ${server.address} no longer lets this computer in for its line. Turn it on to set the line up again: "Run on" on ${server.address}'s page then offers this computer.`
                            : server.reach === 'full'
                              ? `On: on ${server.address}'s page, "Run on" offers this computer, and a run started there runs here. This computer must be on.`
                              : server.reach === 'watch'
                                ? `Off: ${server.address}'s page shows this computer's runs. It cannot start one here, or say anything to one.`
                                : `Off. Turn it on to pick this computer under "Run on" on ${server.address}'s page, from your phone.`}
                        </span>
                      </span>
                      <Switch
                        aria-label={`Start runs on this computer from ${server.address}`}
                        checked={server.reach === 'full' && !lineRefused}
                        disabled={busy}
                        onCheckedChange={on =>
                          void act(() => reach(host, server.address, on ? 'full' : 'watch')).then(done => {
                            // A line asked for anew is one the server lets in: said at once, not at the next look at its devices.
                            if (done) setRefusedLines(lines => ({ ...lines, [server.address]: false }))
                          })
                        }
                      />
                    </label>
                  )}
                  {done && (
                    <div className="space-y-2">
                      <p className="text-sm">Logins on the server</p>
                      <ul aria-label={`The logins on ${server.address}`} className="space-y-2 text-xs">
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
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || github.working || account === undefined}
                        aria-label={`Copy my GitHub login to ${server.address}`}
                        title={account !== undefined ? `Copies the login of ${account} from this computer to the server, over SSH.` : noLogin}
                        onClick={() => void act(() => login(host, server.address, 'github'))}
                      >
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
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Remove the GitHub login from ${server.address}`}
                          title="Deletes the login on the server. The login itself is not ended by this: a copied one is this computer's own and stays good. To end one everywhere, take it back on github.com."
                          onClick={() => void act(() => logout(host, server.address, 'github'))}
                        >
                          Remove
                        </Button>
                      )}
                    </LoginLine>
                    <LoginLine
                      label="Claude"
                      words={
                        claude.asking
                          ? "Claude: say yes in the page this computer's browser opened."
                          : claude.working
                            ? 'Claude: one moment, the server is being told.'
                            : claude.there
                              ? `Claude: logged in since ${day(claude.since)}, good until about ${day(claude.ends)}.`
                              : claude.said !== undefined
                                ? 'Claude: the last try did not go through.'
                                : 'Claude: not logged in on the server.'
                      }
                      said={claude.working ? undefined : claude.said}
                    >
                      <Button
                        size="sm"
                        variant={claude.there || claude.working ? 'outline' : 'default'}
                        disabled={busy || (claude.working && claude.asking !== true)}
                        aria-label={`Log in to Claude for ${server.address}`}
                        title="Opens this computer's browser, where you say yes once. The login is made for this server alone and lasts a year; this computer's own Claude login is not touched."
                        onClick={() => void act(() => login(host, server.address, 'claude'))}
                      >
                        {claude.asking ? 'Start over' : claude.there ? 'Log in again' : 'Log in to Claude'}
                      </Button>
                      {(claude.there || claude.said !== undefined) && !claude.working && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Remove the Claude login from ${server.address}`}
                          title="Deletes the login on the server and starts OpenAgent there again without it. An agent at work there keeps it until it ends. The login itself stays good until its year is over."
                          onClick={() => void act(() => logout(host, server.address, 'claude'))}
                        >
                          Remove
                        </Button>
                      )}
                    </LoginLine>
                    <ClaudeAccounts host={host} server={server} busy={busy} act={act} reload={reload} />
                      </ul>
                    </div>
                  )}
                  {done && server.through === undefined && (
                    <ServerDevices
                      host={host}
                      address={server.address}
                      everyMs={devicesEveryMs}
                      awaited={code?.address === server.address}
                      busy={busy || known === undefined}
                      ownDevice={machine?.device}
                      onGotIn={name => {
                        setJoined(name)
                        setCode(undefined)
                      }}
                      onLine={refused => setRefusedLines(lines => (lines[server.address] === refused ? lines : { ...lines, [server.address]: refused }))}
                      onOwner={owner => setOwners(named => (named[server.address] === owner ? named : { ...named, [server.address]: owner }))}
                    />
                  )}
                  {done && machine && server.through === undefined && <ComputersThrough host={host} machine={machine} busy={busy} everyMs={devicesEveryMs} />}
                  {!server.working && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="-ml-2 text-muted-foreground"
                      // Not while one of its logins is being changed: the server is not forgotten then, and nothing of it is taken out before.
                      disabled={busy || github.working || claude.working}
                      aria-label={`Remove ${server.address}`}
                      title={
                        github.working || claude.working
                          ? 'One of its logins is being changed right now: wait until that ends.'
                          : 'Takes the server off this list, and this computer out of the server. Nothing else is changed on the server: OpenAgent goes on running there, and its logins stay there until you remove them.'
                      }
                      onClick={() => void removeServer(server)}
                    >
                      Remove server
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
          {others.map(machine => (
            <OtherMachine key={machine.id} host={host} machine={machine} known={known !== undefined} busy={busy} everyMs={devicesEveryMs} workingMs={everyMs} ownGithub={account} noLogin={noLogin} onRemove={() => removeMachine(machine)} />
          ))}
        </ul>
      )}
      {!read.ok && !isServer && (
        <p role="alert" className="py-3 text-xs text-danger">{`The servers could not be read: ${read.error}`}</p>
      )}
      {error !== undefined && !connecting && (
        <p role="alert" className="py-3 text-xs text-danger">
          {error}
        </p>
      )}
      {addingByLink && <AddMachineDialog onClose={() => setAddingByLink(false)} onAdded={() => void reloadMachines()} />}
      {connecting && (
        <Dialog open onOpenChange={open => !open && setConnecting(false)} title="Connect a server">
          <form onSubmit={submit} className="space-y-4">
            <p className="text-xs text-muted-foreground">OpenAgent installs itself on the server over SSH, with this computer's own SSH keys, and shows each step here as it runs. It takes a few minutes.</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-40 flex-1 space-y-1 text-xs text-muted-foreground">
                <span>The server's address</span>
                <Input autoFocus aria-label="The server's address" placeholder="203.0.113.5" value={address} onChange={event => setAddress(event.target.value)} />
              </label>
              <label className="w-32 space-y-1 text-xs text-muted-foreground">
                <span>User name</span>
                <Input aria-label="User name" value={user} onChange={event => setUser(event.target.value)} />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              The user is root, or one that becomes root without a password. It is only used to install, to update, to give the server its logins and to list its devices: what runs on the server afterwards runs as a user of its own, openagent.
            </p>
            {doors.length > 0 && (
              <div className="space-y-2 text-xs">
                <p className="text-muted-foreground">Reached:</p>
                <RadioGroup aria-label="How the server is reached" value={reached} disabled={busy} onValueChange={next => setReached(next as 'internet' | 'through')}>
                  <RadioGroupOption value="internet" className="text-xs">
                    on the internet, at its own address
                  </RadioGroupOption>
                  <RadioGroupOption value="through" className="text-xs">
                    through a server:
                    <Select items={doors.map(door => ({ value: door.url, label: door.label }))} value={through ?? doors[0]!.url} disabled={busy || reached !== 'through'} onValueChange={next => setVia(next as string)}>
                      <SelectTrigger size="sm" aria-label="The server it is reached through" className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {doors.map(door => (
                          <SelectItem key={door.url} value={door.url}>
                            {door.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </RadioGroupOption>
                </RadioGroup>
                {reached === 'through' && <p className="text-muted-foreground">SSH must be on at the computer, with this computer's key. The user name is your own user on it.</p>}
              </div>
            )}
            <label className="flex items-start gap-2 text-xs">
              <Checkbox checked={copy && account !== undefined} onCheckedChange={checked => setCopy(checked === true)} disabled={busy || account === undefined} className="mt-0.5" aria-label="Copy my GitHub login to the server" />
              <span>
                {account !== undefined ? `Copy my GitHub login (${account}) to the server.` : 'Copy my GitHub login to the server.'}{' '}
                <span className="text-muted-foreground">
                  {noLogin ?? "It can do there all it can do here, and every agent that runs on the server works with it. It goes there at the install's end, to a server met for the first time too, whose key is taken as it is."}
                </span>
              </span>
            </label>
            {error !== undefined && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" type="button" variant="ghost" onClick={() => setConnecting(false)}>
                Cancel
              </Button>
              {/* Not before this computer has said which OpenAgent it runs: that is the one the server gets. */}
              <Button size="sm" type="submit" disabled={busy || !known || !address.trim() || !user.trim()}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                Connect
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {inviting !== undefined && (
        <InviteDialog
          title={`Invite to ${inviting}`}
          ask={person => askLink(host, inviting, person)}
          persons={{
            owner: owners[inviting],
            // The server's owner is the person at this computer: the GitHub account its gh is logged in to.
            whoAmI: async () => {
              const me = await ownGithub(host)
              if (!me.ok) return me
              return 'account' in me.value ? { ok: true, account: me.value.account } : { ok: false, error: me.value.problem }
            },
            nameOwner: async account => {
              const named = await nameOwner(host, inviting, account)
              if (named.ok) setOwners(known => ({ ...known, [inviting]: named.value.persons.find(person => person.owner)?.account }))
              return named.ok ? { ok: true } : named
            },
          }}
          scan="Scan it with the phone's camera: it opens OpenAgent on the server, from anywhere."
          openHere
          joined={joined}
          onCode={next => {
            setJoined(undefined)
            setCode(next && { ...next, address: inviting })
          }}
          onClose={() => {
            setInviting(undefined)
            setCode(undefined)
            setJoined(undefined)
          }}
        />
      )}
    </SettingsSection>
  )
}
