import { useEffect, useState } from 'react'
import { ChevronLeft, Ellipsis, House, Monitor, Plus, Server, Smartphone, Tablet, UserRound } from 'lucide-react'
import { Button, ConfirmDialog, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, formatDateTime, formatRelative, usePolled, useSettingsCrumb } from '@openagt/dashboard/module'
import { keepPerson, loadMine, removeDevice, removeMine, removePerson, renameDevice, type Answer, type DeviceRow, type DoorStatus, type Mine, type PersonRow } from './devices.js'
import { removeDevice as removeServerDevice } from './servers.js'
import { AddDevice, type Adding } from './AddDevice.js'
import { ComputerPage } from './ComputerPage.js'
import { JoinedPage, OtherPage } from './JoinedPage.js'
import { ServerPage } from './ServerPage.js'
import { ThisComputer } from './ThisComputer.js'
import { hasServer, type Item, type PhoneItem } from './model.js'
import { Problem, Row, State, hostOf, olderThan } from './parts.js'
import { useDevices, type Devices, type Paces } from './use-devices.js'

// Settings › Devices: this computer, how the person's devices reach it, and every device of
// theirs once, phones, computers and servers, each with a page of its own. With nothing yet, the
// three things a person starts with. Each part is read with the package's own commands, and the
// saved machines are OpenAgent's.

/** What a device is, by the name it gave as it got in: "iPhone, Safari". */
const phoneKind = (name: string): { icon: typeof Smartphone; word: string } =>
  /iphone|android phone|phone/i.test(name) ? { icon: Smartphone, word: 'Phone' } : /ipad|tablet/i.test(name) ? { icon: Tablet, word: 'Tablet' } : { icon: Monitor, word: 'Browser' }

/** Which item is open: by its key, and by what it holds, so it stays open as the item it is becomes another (a computer saved here, then let in). */
interface Opened {
  key: string
  machine?: string
  door?: string
}

const openedOf = (item: Item): Opened => ({
  key: item.key,
  ...('machine' in item && item.machine ? { machine: item.machine.id } : {}),
  ...(item.kind === 'computer' && item.door ? { door: item.door.id } : {}),
})

const findOpened = (items: Item[], opened: Opened): Item | undefined =>
  items.find(item => item.key === opened.key) ??
  items.find(item => (opened.machine !== undefined && 'machine' in item && item.machine?.id === opened.machine) || (opened.door !== undefined && item.kind === 'computer' && item.door?.id === opened.door))

export function DevicesSettings({ everyMs = 3_000, devicesEveryMs = 30_000, devicesAnswerMs, item }: Partial<Paces> & { /** A saved machine to open the page of, by its id: what a link from elsewhere names. */ item?: string }) {
  const d = useDevices({ everyMs, devicesEveryMs, ...(devicesAnswerMs !== undefined ? { devicesAnswerMs } : {}) })
  const [opened, setOpened] = useState<Opened | undefined>(item !== undefined ? { key: '', machine: item } : undefined)
  // Named again (another link while Settings is open): that machine's page.
  useEffect(() => {
    if (item !== undefined) setOpened({ key: '', machine: item })
  }, [item])
  const [adding, setAdding] = useState<Adding | undefined>()
  // A server just set up opens on its page with Invite open.
  const [inviting, setInviting] = useState(false)
  const status = d.door?.ok ? d.door.value : undefined
  const open = opened ? findOpened(d.items, opened) : undefined
  const back = (): void => {
    setOpened(undefined)
    setInviting(false)
  }
  // A device's page is named in the Settings dialog's header, with its way back; outside it, the page has its own.
  const crumbShown = useSettingsCrumb(open ? { title: open.name, back } : undefined)

  // One person's own OpenAgent on a computer several people use: their devices are the door's, and only they are shown.
  if (status?.person !== undefined) return <PersonDevices person={status.person} everyMs={everyMs} />
  // Nothing shows until this computer said what it is: a server never offers a server to set up for a moment.
  if (d.door === undefined || (d.machines === undefined && d.door.ok)) return null

  const dialogs = adding !== undefined && (
    <AddDevice
      d={d}
      start={adding}
      isServer={d.isServer}
      onClose={() => setAdding(undefined)}
      onInvite={address => {
        setAdding(undefined)
        setInviting(true)
        setOpened({ key: `server:${address}` })
      }}
    />
  )

  if (open)
    return (
      <>
        {!crumbShown && (
          <button type="button" aria-label="Back to Devices" onClick={back} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
            Devices
          </button>
        )}
        {open.kind === 'computer' && <ComputerPage d={d} item={open} onBack={back} onSetUp={() => setAdding('server')} />}
        {open.kind === 'server' && <ServerPage d={d} item={open} onBack={back} invite={inviting} />}
        {open.kind === 'joined' && <JoinedPage d={d} item={open} onBack={back} />}
        {open.kind === 'other' && <OtherPage d={d} item={open} onBack={back} />}
        {dialogs}
      </>
    )

  const persons = status?.persons ?? []
  const start = d.items.length === 0 && !status?.on && status?.https === undefined && persons.length === 0
  return (
    <div className="space-y-4 pt-1">
      <ThisComputer d={d} start={start} />
      {start ? <Start d={d} onAdd={setAdding} /> : <List d={d} onOpen={item => setOpened(openedOf(item))} onAdd={() => setAdding('choose')} />}
      {d.door !== undefined && !d.door.ok && <Problem>{`The devices could not be read: ${d.door.error}`}</Problem>}
      {d.serversError !== undefined && !d.isServer && <Problem>{`The servers could not be read: ${d.serversError}`}</Problem>}
      {/* An open dialog says what went wrong in it. */}
      {d.error !== undefined && adding === undefined && <Problem>{d.error}</Problem>}
      {dialogs}
    </div>
  )
}

/** With no device yet: the three things a person starts with, and a code someone gave them. */
function Start({ d, onAdd }: { d: Devices; onAdd: (adding: Adding) => void }) {
  return (
    <>
      <div>
        <p className="text-sm font-medium">Add your first device</p>
        <p className="text-xs text-muted-foreground">Pick what you want to do. You can add the others later.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile icon={Smartphone} title="Use it on your phone" words="Start runs and answer your agents from your phone, on the same Wi-Fi as this computer." button="Add phone" primary onClick={() => onAdd('phone')} />
        <Tile icon={Monitor} title="Use another computer" words="Run agents on your other Mac or PC, on the same Wi-Fi as this computer." button="Add computer" onClick={() => onAdd('computer')} />
        {!d.isServer && <Tile icon={Server} title="Get a server" words="Always on. Your phone and computers reach each other from anywhere, and you can share it with people." button="Set up a server" onClick={() => onAdd('server')} />}
      </div>
      <p className="text-xs text-muted-foreground">
        Someone gave you a code?{' '}
        <button type="button" className="underline hover:text-foreground" onClick={() => onAdd('code')}>
          Join with a code
        </button>
      </p>
    </>
  )
}

function Tile({ icon: Icon, title, words, button, primary = false, onClick }: { icon: typeof Smartphone; title: string; words: string; button: string; primary?: boolean; onClick: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <Icon aria-hidden className="h-4 w-4 text-primary" />
      <p className="text-sm font-semibold">{title}</p>
      <p className="flex-1 text-xs text-muted-foreground">{words}</p>
      <Button size="sm" variant={primary ? 'default' : 'outline'} className="self-start" onClick={onClick}>
        {button}
      </Button>
    </div>
  )
}

/** Every device, once, each a row: a phone with its menu, anything else opening its page. */
function List({ d, onOpen, onAdd }: { d: Devices; onOpen: (item: Item) => void; onAdd: () => void }) {
  const status = d.door?.ok ? d.door.value : undefined
  const persons = status?.persons ?? []
  // A computer several people use lists its door's devices by person, as it did: the people part below.
  const items = persons.length ? d.items.filter(item => !(item.kind === 'phone' && item.door)) : d.items
  const server = hasServer({ servers: d.servers, machines: d.machines?.machines ?? [] })
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium">{items.length ? `Your devices (${items.length})` : 'Your devices'}</p>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add device
        </Button>
      </div>
      {items.length === 0 && !persons.length && <p className="text-xs text-muted-foreground">{server ? 'None yet. Add device: a phone from anywhere, or a computer.' : 'None yet. Add device: a phone or a computer on the same Wi-Fi.'}</p>}
      <ul aria-label="Your devices" className="divide-y divide-border">
        {items.map(item => (
          <ItemRow key={item.key} d={d} item={item} onOpen={() => onOpen(item)} />
        ))}
      </ul>
      {persons.length > 0 && <DoorPeople d={d} persons={persons} devices={status?.devices ?? []} />}
    </div>
  )
}

const seenWords = (seen: string | undefined, added: string): string => (seen !== undefined ? `last seen ${formatRelative(seen)}` : `added ${formatRelative(added)}`)

function ItemRow({ d, item, onOpen }: { d: Devices; item: Item; onOpen: () => void }) {
  if (item.kind === 'phone') return <PhoneRow d={d} item={item} />
  if (item.kind === 'computer') {
    const { machine, door, through } = item
    const where = item.line ? 'keeps a line open here' : through ? `through ${through.label}` : machine?.url.startsWith('https://') ? 'on the internet' : 'on this Wi-Fi'
    const runs = item.line ? undefined : machine && door ? 'runs go both ways' : machine ? 'your runs go there' : 'starts runs here'
    const state = machine ? machine.version !== undefined ? <State tone="good">Online</State> : <State tone="quiet">Offline</State> : undefined
    return <Row icon={Monitor} name={item.name} facts={[state, 'Computer', where, runs]} onOpen={onOpen} />
  }
  if (item.kind === 'server') {
    const { server, machine } = item
    const home = server.through !== undefined
    const failed = !server.working && server.steps.some(step => step.state === 'failed')
    const behind = machine?.version !== undefined && d.machines !== undefined && olderThan(machine.version, d.machines.version)
    const state = server.working ? <State tone="working">{machine ? 'Updating…' : 'Installing…'}</State> : failed ? <State tone="bad">Stopped at a step</State> : machine?.version !== undefined ? <State tone="good">Online</State> : <State tone="quiet">{machine ? 'Offline' : 'Not connected yet'}</State>
    return (
      <Row
        icon={home ? House : Server}
        name={item.name}
        facts={[state, home ? 'Server at home' : 'Server', home ? `through ${hostOf(server.through!)}` : undefined, item.people !== undefined ? `${item.people} ${item.people === 1 ? 'person' : 'people'}` : undefined, behind && <span className="rounded-full border border-[var(--color-warning)] px-1.5 text-[10px] font-medium text-warning">Update</span>]}
        onOpen={onOpen}
      />
    )
  }
  if (item.kind === 'joined') {
    const { machine, person } = item
    return <Row icon={Server} name={item.name} facts={[machine.version !== undefined ? <State tone="good">Online</State> : <State tone="quiet">Offline</State>, 'Server', person.owner ? 'yours' : person.person !== undefined ? `you are ${person.person}` : undefined]} onOpen={onOpen} />
  }
  return <Row icon={Server} name={item.name} facts={[item.machine.version !== undefined ? <State tone="good">Online</State> : <State tone="quiet">Offline</State>, `${item.owner}'s server`]} onOpen={onOpen} />
}

/** A phone or a browser: no page of its own, a menu to rename it here, or take it out. */
function PhoneRow({ d, item }: { d: Devices; item: PhoneItem }) {
  const { host } = d
  const { icon, word } = phoneKind(item.name)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(item.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const where = 'wifi' in item.via ? 'on this Wi-Fi' : 'internet' in item.via ? 'from anywhere' : `through ${item.via.label}`
  const act = async (change: () => Promise<Answer<unknown> | { ok: true } | { ok: false; error: string }>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    const answer = await change()
    if (!answer.ok) setError(answer.error)
    await Promise.all([d.reloadDoor(), d.reloadDevices(), d.reloadMachines()]).catch(() => {})
    setBusy(false)
    return answer.ok
  }
  const remove = (): Promise<Answer<unknown> | { ok: true } | { ok: false; error: string }> => {
    if (item.door) return d.changeDoor(() => removeDevice(host, item.door!.id))
    if (item.at) {
      const { address, device } = item.at
      return removeServerDevice(host, address, device.id).then(answer => {
        if (answer.ok) d.setDevices(address, answer.value)
        return answer
      })
    }
    return host.removeMachineDevice(item.on!.machine.id, item.on!.device.id)
  }
  return (
    <>
      <Row
        icon={icon}
        name={item.name}
        facts={[word, where, <span title={formatDateTime(item.seen ?? item.added)}>{seenWords(item.seen, item.added)}</span>]}
        end={
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={`${item.name}: more`} disabled={busy} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
              <Ellipsis className="h-4 w-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {item.door && <DropdownMenuItem onClick={() => (setName(item.name), setRenaming(true))}>Rename</DropdownMenuItem>}
              <DropdownMenuItem className="text-danger" onClick={() => void act(remove)}>
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      {error !== undefined && <Problem>{error}</Problem>}
      {renaming && item.door && (
        <Dialog open onOpenChange={open => !open && setRenaming(false)} title={`Rename ${item.name}`}>
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault()
              void act(() => d.changeDoor(() => renameDevice(host, item.door!.id, name.trim()))).then(done => done && setRenaming(false))
            }}
          >
            <Input autoFocus aria-label="Name" value={name} maxLength={80} onChange={event => setName(event.target.value)} />
            <div className="flex justify-end gap-2">
              <Button size="sm" type="button" variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button size="sm" type="submit" disabled={busy || !name.trim()}>
                Save
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  )
}

/** Removing a person, asked first: everything of theirs on this computer goes. */
function RemovePerson({ name, label, busy, onConfirm }: { name: string; label: string; busy: boolean; onConfirm: () => Promise<void> }) {
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${name}`}>
          {label}
        </Button>
      }
      title={`Remove ${name}?`}
      body={`Their devices are taken out, and their own user on this computer is deleted with everything in it: their logins, their copies of projects, and any work they did not push. ${name} can be invited again later.`}
      confirmLabel="Remove person"
      confirmBusyLabel="Removing…"
      onConfirm={onConfirm}
    />
  )
}

/** A device's lines in a person's list: its name, when it was seen, and what a computer of theirs is. */
function DoorDevice({ device, mine, busy, onRemove }: { device: DeviceRow; mine: boolean; busy: boolean; onRemove: () => void }) {
  const { icon: Icon } = device.line ? { icon: Monitor } : phoneKind(device.name)
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-sm">{device.name}</p>
          <p className="text-xs text-muted-foreground" title={formatDateTime(device.seen ?? device.added)}>
            {device.seen !== undefined ? `Last seen ${formatRelative(device.seen)}, added ${formatRelative(device.added)}` : `Added ${formatRelative(device.added)}`}
          </p>
          {device.line && <p className="text-xs text-muted-foreground">{`${device.person !== undefined && !mine ? `A computer of ${device.person}` : 'A computer of yours'}: runs can be started on it from here. Remove it and it is no longer in "Run on".`}</p>}
        </div>
      </div>
      <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${device.name}`} onClick={onRemove}>
        Remove
      </Button>
    </li>
  )
}

/** On a computer several people use: its door's devices by person, the owner first, and what is become of each person. */
function DoorPeople({ d, persons, devices }: { d: Devices; persons: PersonRow[]; devices: DeviceRow[] }) {
  const { host } = d
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const act = async (change: () => Promise<Answer<DoorStatus>>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const answer = await d.changeDoor(change)
    if (!answer.ok) setError(answer.error)
    setBusy(false)
  }
  return (
    <div className="space-y-1 pt-2">
      {persons.map(person => {
        const theirs = devices.filter(device => (device.person ?? persons[0]!.name) === person.name)
        return (
          <div key={person.name} className="pt-2">
            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{person.owner ? `${person.name}, the owner` : person.name}</span>
              </p>
              {!person.owner && !(person.removed && !person.kept) && <RemovePerson name={person.name} label="Remove person" busy={busy} onConfirm={() => act(() => removePerson(host, person.name))} />}
            </div>
            {/* A person of a server whose line lets everyone there start runs here: where they come from, and whether that server still has them. */}
            {person.from !== undefined && !(person.removed && !person.kept) && <p className="pt-1 text-xs text-muted-foreground">{person.removed ? `Removed from ${hostOf(person.from)}. Kept here, switched off.` : `Uses this computer through ${hostOf(person.from)}.`}</p>}
            {person.from !== undefined && person.removed && !person.kept && (
              <div role="group" aria-label={`${person.name} was removed from ${hostOf(person.from)}`} className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-xs text-warning">{`Removed from ${hostOf(person.from)}.`}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => keepPerson(host, person.name))}>
                    Keep, switched off
                  </Button>
                  <RemovePerson name={person.name} label="Remove" busy={busy} onConfirm={() => act(() => removePerson(host, person.name))} />
                </div>
              </div>
            )}
            {person.working && <p className="pt-1 text-xs text-muted-foreground">{`Making ${person.name}'s own user on this computer, with their own OpenAgent. This takes a minute or two.`}</p>}
            {person.problem !== undefined && !person.working && <p role="alert" className="pt-1 text-xs text-danger">{`${person.name}'s own user on this computer could not be made: ${person.problem.replace(/\.?$/, '.')} Add a device for them again to try again.`}</p>}
            {/* A person of a server has their devices at that server: none here is none missing. */}
            {person.from === undefined && theirs.length === 0 && <p className="py-2 text-xs text-muted-foreground">No device yet.</p>}
            <ul aria-label={`Devices of ${person.name}`} className="divide-y divide-border">
              {theirs.map(device => (
                <DoorDevice key={device.id} device={device} mine={person.owner === true} busy={busy} onRemove={() => void act(() => removeDevice(host, device.id))} />
              ))}
            </ul>
          </div>
        )
      })}
      {error !== undefined && <Problem>{error}</Problem>}
    </div>
  )
}

/**
 * Devices on the OpenAgent of one person on a computer several people use: the devices that are
 * theirs, as the computer's door lists them, each removable. Nothing more: only the computer's
 * owner invites, the door is the owner's, and the other persons' devices are theirs.
 */
function PersonDevices({ person, everyMs }: { person: string; everyMs: number }) {
  const { value: read, reload } = usePolled<Answer<Mine> | undefined>(() => loadMine(), undefined, everyMs, [])
  const [changed, setChanged] = useState<Mine | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const mine = changed ?? (read?.ok ? read.value : undefined)

  const remove = async (id: string): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const answer = await removeMine(id)
    if (answer.ok) setChanged(answer.value)
    else setError(answer.error)
    await reload().catch(() => {})
    setChanged(undefined)
    setBusy(false)
  }

  const devices = mine?.devices ?? []
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{`This computer is shared, and you are on it as ${person}. Your devices are in until you remove them. A new device gets in with a code from the computer's owner.`}</p>
      {mine !== undefined && (
        <div className="space-y-1">
          <p className="text-sm">{devices.length > 0 ? `Your devices (${devices.length})` : 'Your devices'}</p>
          {devices.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
          <ul aria-label="Your devices" className="divide-y divide-border">
            {devices.map(device => (
              <DoorDevice key={device.id} device={device} mine busy={busy} onRemove={() => void remove(device.id)} />
            ))}
          </ul>
        </div>
      )}
      {read !== undefined && !read.ok && <Problem>{`Your devices could not be read: ${read.error}`}</Problem>}
      {error !== undefined && <Problem>{error}</Problem>}
    </div>
  )
}
