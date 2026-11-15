import { useEffect, useState } from 'react'
import { ChevronLeft, Ellipsis, House, Loader2, Monitor, Plus, Server, Smartphone, Tablet, UserPlus, UserRound } from 'lucide-react'
import { Badge, Button, ConfirmDialog, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, List, Row, RowShapes, Section, SettingsRow, SettingsRowShapes, SettingsSection, Slot, formatDateTime, formatRelative, useOpenAgentDown, usePolled, useSettingsCrumb } from '@openagt/dashboard/module'
import { addDevice, keepPerson, loadMine, myName, nameOwner, removeDevice, removeMine, removePerson, renameDevice, setTailscale, type Answer, type DeviceRow, type DoorStatus, type LineRow, type PersonRow, type PersonThere } from './devices.js'
import { installFailed, removeDevice as removeServerDevice } from './servers.js'
import { ADDING, AddDevice, isAdding, useJoined, type Adding } from './AddDevice.js'
import { Invite } from './codes.js'
import { ComputerPage } from './ComputerPage.js'
import { JoinedPage, OtherPage } from './JoinedPage.js'
import { ServerPage } from './ServerPage.js'
import { ThisComputer } from './ThisComputer.js'
import { hasServer, labelOf, reachedAt, type Item, type PhoneItem } from './model.js'
import { LinkPress, ListedDevice, NamedAbove, PressRow, Problem, State, olderThan } from './parts.js'
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

export function DevicesSettings({ everyMs = 3_000, devicesEveryMs = 30_000, devicesAnswerMs, item }: Partial<Paces> & { /** The page the address names: a way of adding, or a saved machine's page by its id, which a link from elsewhere names. */ item?: string }) {
  const d = useDevices({ everyMs, devicesEveryMs, ...(devicesAnswerMs !== undefined ? { devicesAnswerMs } : {}) })
  const adding = isAdding(item) ? item : undefined
  const machineId = adding === undefined ? item : undefined
  const [opened, setOpened] = useState<Opened | undefined>(machineId !== undefined ? { key: '', machine: machineId } : undefined)
  // Named again (another link while Settings is open): that machine's page.
  useEffect(() => {
    if (machineId !== undefined) setOpened({ key: '', machine: machineId })
  }, [machineId])
  // A way of adding is kept in the address, as Settings' own place is: a reload stays on it, and Back leaves Settings.
  const add = (next: Adding | undefined): void => d.host.openSettings('devices', next)
  // A server just set up opens on its page with Invite open.
  const [inviting, setInviting] = useState(false)
  const status = d.door?.ok ? d.door.value : undefined
  const open = opened ? findOpened(d.items, opened) : undefined
  const back = (): void => {
    setOpened(undefined)
    setInviting(false)
  }
  // A page of the entry is named in the Settings dialog's header, with its way back: a way of adding goes back to where it was opened from.
  const crumbShown = useSettingsCrumb(adding ? { title: ADDING[adding], back: () => add(undefined) } : open ? { title: open.name, back } : undefined)
  // Outside the Settings dialog, a page draws its own way back.
  const way = (onBack: () => void) =>
    !crumbShown && (
      <button type="button" aria-label="Back to Devices" onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
        Devices
      </button>
    )

  // One person's own OpenAgent on a computer several people use: their devices are the door's, and only they are shown.
  if (status?.person !== undefined) return <PersonDevices person={status.person} everyMs={everyMs} />
  // Nothing but the rows' shape until this computer said what it is: a server never offers a server to set up for a moment.
  const known = d.door !== undefined && !(d.machines === undefined && d.door.ok)
  if (!known) return <Slot of={{ state: 'unknown', value: undefined }} shape={<SettingsRowShapes rows={3} />}>{() => null}</Slot>

  if (adding)
    return (
      <>
        {way(() => add(undefined))}
        <section aria-label={ADDING[adding]} className="max-w-prose">
          <AddDevice
            d={d}
            adding={adding}
            isServer={d.isServer}
            onAdd={add}
            onClose={() => add(undefined)}
            onInvite={address => {
              add(undefined)
              setInviting(true)
              setOpened({ key: `server:${address}` })
            }}
            onJoined={joined => d.host.openSettings('devices', joined)}
          />
        </section>
      </>
    )

  if (open)
    return (
      <NamedAbove.Provider value={crumbShown}>
        {way(back)}
        {open.kind === 'computer' && <ComputerPage d={d} item={open} onBack={back} onSetUp={() => add('set-up-server')} />}
        {open.kind === 'server' && <ServerPage d={d} item={open} onBack={back} invite={inviting} />}
        {open.kind === 'joined' && <JoinedPage d={d} item={open} onBack={back} />}
        {open.kind === 'other' && <OtherPage d={d} item={open} onBack={back} />}
      </NamedAbove.Provider>
    )

  const persons = status?.persons ?? []
  const start = d.items.length === 0 && !status?.on && status?.https === undefined && status?.tailscale === undefined && persons.length === 0
  return (
    <div className="space-y-8">
      <ThisComputer d={d} start={start} />
      {start ? <Start d={d} onAdd={add} /> : <YourDevices d={d} onOpen={item => setOpened(openedOf(item))} onAdd={() => add('add')} />}
      {d.door !== undefined && !d.door.ok && <Problem>{`The devices could not be read: ${d.door.error}`}</Problem>}
      {d.serversError !== undefined && !d.isServer && <Problem>{`The servers could not be read: ${d.serversError}`}</Problem>}
      {d.error !== undefined && <Problem>{d.error}</Problem>}
    </div>
  )
}

/** With no device yet: the three things a person starts with, a code someone gave them, and Tailscale for one who has it. */
function Start({ d, onAdd }: { d: Devices; onAdd: (adding: Adding) => void }) {
  const down = useOpenAgentDown()
  const [turning, setTurning] = useState(false)
  const [why, setWhy] = useState<string | undefined>()
  // The door behind Tailscale: from then on, This computer says how devices reach it there.
  const onTailscale = async (): Promise<void> => {
    setTurning(true)
    setWhy(undefined)
    const turned = await d.changeDoor(() => setTailscale(d.host, true))
    if (!turned.ok) setWhy(turned.error)
    setTurning(false)
  }
  return (
    <Section title="Add your first device">
      <SettingsSection description="Pick what you want to do. You can add the others later.">
        <SettingsRow label="Use it on your phone" description="Start runs and answer your agents from your phone, on the same Wi-Fi as this computer." control={<Button onClick={() => onAdd('add-phone')}>Add phone</Button>} />
        <SettingsRow
          label="Use another computer"
          description="Run agents on your other computer, on the same Wi-Fi as this one."
          control={
            <Button variant="secondary" onClick={() => onAdd('add-computer')}>
              Add computer
            </Button>
          }
        />
        {!d.isServer && (
          <SettingsRow
            label="Get a server"
            description="Always on. Your phone and computers reach each other from anywhere, and you can share it with people."
            control={
              <Button variant="secondary" onClick={() => onAdd('set-up-server')}>
                Set up a server
              </Button>
            }
          />
        )}
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Someone gave you a code? <LinkPress onClick={() => onAdd('join')}>Join with a code</LinkPress>
          </p>
          <p>
            On Tailscale? From anywhere, with no server: <LinkPress loading={turning} disabled={down} onClick={() => void onTailscale()}>Reach this computer on your Tailscale network</LinkPress>
          </p>
        </div>
        {why !== undefined && <Problem>{why}</Problem>}
      </SettingsSection>
    </Section>
  )
}

/** Every device, once, each a row: a phone with its menu, anything else opening its page. */
function YourDevices({ d, onOpen, onAdd }: { d: Devices; onOpen: (item: Item) => void; onAdd: () => void }) {
  const { host } = d
  const status = d.door?.ok ? d.door.value : undefined
  const persons = status?.persons ?? []
  // A computer several people use lists its door's devices by person, as it did: the people part below.
  const items = persons.length ? d.items.filter(item => !(item.kind === 'phone' && item.door)) : d.items
  const server = hasServer({ servers: d.servers, machines: d.machines?.machines ?? [] })
  // Someone else gets a user of their own only on a computer set up as a server: there, and only there, Add person.
  const addsPersons = d.isServer || status?.https !== undefined || persons.length > 0
  const [addingPerson, setAddingPerson] = useState(false)
  const [codeOn, setCodeOn] = useState(false)
  const joined = useJoined(d, codeOn)
  return (
    <Section
      title="Your devices"
      {...(items.length ? { count: items.length } : {})}
      action={
        <>
          {addsPersons && (
            <Button variant="secondary" title="Someone else, by their name: they add this computer to their own OpenAgent with the code, and get a user of their own here." onClick={() => setAddingPerson(true)}>
              <UserPlus className="size-4" aria-hidden />
              Add person
            </Button>
          )}
          <Button onClick={onAdd}>
            <Plus className="size-4" aria-hidden />
            Add device
          </Button>
        </>
      }
    >
      {addingPerson && (
        <Invite
          label={d.machines?.name ?? 'this computer'}
          tailscale={status?.tailscale !== undefined && status.https === undefined}
          ask={person => addDevice(host, person)}
          persons={{
            owner: persons.find(person => person.owner)?.name,
            myName: () => myName(host),
            nameOwner: async name => {
              const named = await nameOwner(host, name)
              await d.reloadDoor().catch(() => {})
              return named.ok ? { ok: true } : named
            },
          }}
          joined={joined}
          onCode={code => setCodeOn(code !== undefined)}
          onClose={() => {
            setAddingPerson(false)
            setCodeOn(false)
          }}
        />
      )}
      {items.length === 0 && !persons.length && <p className="text-sm text-muted-foreground">{server ? 'None yet. Add device: a phone from anywhere, or a computer.' : status?.tailscale ? 'None yet. Add device: a phone or a computer on your Tailscale network.' : 'None yet. Add device: a phone or a computer on the same Wi-Fi.'}</p>}
      <List aria-label="Your devices">
        {items.map(item => (
          <ItemRow key={item.key} d={d} item={item} onOpen={() => onOpen(item)} />
        ))}
      </List>
      {persons.length > 0 && <DoorPeople d={d} persons={persons} devices={status?.devices ?? []} lines={status?.lines ?? []} />}
    </Section>
  )
}

const seenWords = (seen: string | undefined, added: string): string => (seen !== undefined ? `last seen ${formatRelative(seen)}` : `added ${formatRelative(added)}`)

function ItemRow({ d, item, onOpen }: { d: Devices; item: Item; onOpen: () => void }) {
  if (item.kind === 'phone') return <PhoneRow d={d} item={item} />
  if (item.kind === 'computer') {
    const { machine, door, through } = item
    const where = item.line ? 'keeps a line open here' : through ? `through ${through.label}` : reachedAt(machine)
    const runs = item.line ? undefined : machine && door ? 'runs go both ways' : machine ? 'your runs go there' : 'starts runs here'
    const state = machine ? machine.version !== undefined ? <State tone="good">Online</State> : <State tone="quiet">Offline</State> : undefined
    return <ListedDevice icon={Monitor} name={item.name} facts={['Computer', where, runs]} state={state} onOpen={onOpen} />
  }
  if (item.kind === 'server') {
    const { server, machine } = item
    const home = server.through !== undefined
    const failed = installFailed(server)
    const behind = machine?.version !== undefined && d.machines !== undefined && olderThan(machine.version, d.machines.version)
    const state = server.working ? <State tone="working">{machine ? 'Updating…' : 'Installing…'}</State> : failed ? <State tone="bad">Stopped at a step</State> : machine?.version !== undefined ? <State tone="good">Online</State> : <State tone="quiet">{machine ? 'Offline' : 'Not connected yet'}</State>
    return (
      <ListedDevice
        icon={home ? House : Server}
        name={item.name}
        facts={[home ? 'Server at home' : 'Server', home ? `through ${labelOf(d.machines?.machines ?? [], server.through!)}` : undefined, item.door?.tailscale !== undefined ? `on Tailscale at ${item.door.tailscale}` : undefined, item.people !== undefined ? `${item.people} ${item.people === 1 ? 'person' : 'people'}` : undefined]}
        state={
          <>
            {behind && <Badge tone="warning">Update</Badge>}
            {state}
          </>
        }
        onOpen={onOpen}
      />
    )
  }
  if (item.kind === 'joined') {
    const { machine, person } = item
    return <ListedDevice icon={Server} name={item.name} facts={['Server', person?.owner ? 'yours' : person?.person !== undefined ? `you are ${person.person}` : undefined]} state={machine.version !== undefined ? <State tone="good">Online</State> : <State tone="quiet">Offline</State>} onOpen={onOpen} />
  }
  return <ListedDevice icon={Server} name={item.name} facts={[`${item.owner}'s, shared with you`, item.person?.person !== undefined ? `you are ${item.person.person}` : undefined]} state={item.machine.version !== undefined ? <State tone="good">Online</State> : <State tone="quiet">Offline</State>} onOpen={onOpen} />
}

/** A phone or a browser: no page of its own, a menu to rename it here, or take it out. */
function PhoneRow({ d, item }: { d: Devices; item: PhoneItem }) {
  const down = useOpenAgentDown()
  const { host } = d
  const { icon, word } = phoneKind(item.name)
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [name, setName] = useState(item.name)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // Being removed: said on the row from the press until the row is gone, which is the next read of its list; a removal that failed says why instead.
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const where = 'wifi' in item.via ? 'on this Wi-Fi' : 'internet' in item.via ? 'from anywhere' : 'tailscale' in item.via ? 'on your Tailscale network' : `through ${item.via.label}`
  const act = async (change: () => Promise<Answer<unknown> | { ok: true } | { ok: false; error: string }>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    const answer = await change()
    if (!answer.ok) {
      setError(answer.error)
      setRemoving(false)
    }
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
      <ListedDevice
        icon={icon}
        name={item.name}
        facts={[word, where, <span title={formatDateTime(item.seen ?? item.added)}>{seenWords(item.seen, item.added)}</span>]}
        {...(removing ? { state: <State tone="working">Removing…</State> } : {})}
        actions={
          // While its own change runs the menu stays shut, and its press keeps the keyboard.
          <DropdownMenu open={menuOpen} onOpenChange={next => setMenuOpen(next && !busy && !removing)}>
            <DropdownMenuTrigger aria-label={`${item.name}: more`} render={<Button variant="ghost" size="icon-sm" loading={busy || removing} />}>
              {removing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Ellipsis className="size-4" aria-hidden />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {item.door && <DropdownMenuItem onClick={() => (setName(item.name), setRenaming(true))}>Rename</DropdownMenuItem>}
              <DropdownMenuItem className="text-danger" disabled={down} onClick={() => setConfirming(true)}>
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      {/* Asked first, as every removal is: a device taken out gets in again only with a new code. */}
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={`Remove ${item.name}?`} body={`${item.name} is taken out, and gets in again only with a new code.`} confirmLabel="Remove" onSuccess={() => (setRemoving(true), void act(remove))} />
      {error !== undefined && (
        <li className="px-3">
          <Problem>{error}</Problem>
        </li>
      )}
      {renaming && item.door && (
        <Dialog open onOpenChange={open => !open && setRenaming(false)} title={`Rename ${item.name}`}>
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault()
              void act(() => d.changeDoor(() => renameDevice(host, item.door!.id, name.trim()))).then(done => done && setRenaming(false))
            }}
          >
            <Input name="device-name" autoFocus aria-label="Name" value={name} maxLength={80} onChange={event => setName(event.target.value)} />
            <PressRow>
              <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={!name.trim() || down}>
                Save
              </Button>
            </PressRow>
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
        <Button variant="ghost" disabled={busy} aria-label={`Remove ${name}`}>
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

/** A device in a person's list: its name, when it was seen, and what a computer of theirs is. */
function DoorDevice({ device, mine, busy, onRemove }: { device: DeviceRow; mine: boolean; busy: boolean; onRemove: () => void }) {
  const down = useOpenAgentDown()
  const { icon: Icon } = device.line ? { icon: Monitor } : phoneKind(device.name)
  const seen = device.seen !== undefined ? `Last seen ${formatRelative(device.seen)}, added ${formatRelative(device.added)}` : `Added ${formatRelative(device.added)}`
  const line = device.line ? `${device.person !== undefined && !mine ? `A computer of ${device.person}` : 'A computer of yours'}: runs can be started on it from here. Remove it and it is no longer in "Run on".` : undefined
  return (
    <Row
      leading={<Icon className="size-4" aria-hidden />}
      title={device.name}
      detail={<span title={line ?? formatDateTime(device.seen ?? device.added)}>{line ?? seen}</span>}
      {...(line !== undefined ? { meta: <span title={formatDateTime(device.seen ?? device.added)}>{seen}</span> } : {})}
      stackOnPhone
      actions={
        <Button variant="ghost" size="sm" disabled={busy || down} aria-label={`Remove ${device.name}`} onClick={onRemove}>
          Remove
        </Button>
      }
    />
  )
}

/** On a computer several people use: its door's devices by person, the owner first, and what is become of each person. */
function DoorPeople({ d, persons, devices, lines }: { d: Devices; persons: PersonRow[]; devices: DeviceRow[]; /** The servers this computer keeps a line to: how the owner, and the people a line made, use it. */ lines: LineRow[] }) {
  const down = useOpenAgentDown()
  const { host } = d
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  // A server by the name its door said, as the line keeps it; by its address until it said.
  const nameAt = (url: string): string => lines.find(line => line.url === url)?.name ?? labelOf(d.machines?.machines ?? [], url)
  const act = async (change: () => Promise<Answer<DoorStatus>>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const answer = await d.changeDoor(change)
    if (!answer.ok) setError(answer.error)
    setBusy(false)
  }
  return (
    <div className="space-y-6">
      {persons.map(person => {
        const theirs = devices.filter(device => (device.person ?? persons[0]!.name) === person.name)
        return (
          <div key={person.name} className="space-y-1">
            <div className="flex min-h-8 items-center justify-between gap-3">
              <p className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                <UserRound className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{person.owner ? `${person.name}, the owner` : person.name}</span>
              </p>
              {!person.owner && !(person.removed && !person.kept) && <RemovePerson name={person.name} label="Remove person" busy={busy} onConfirm={() => act(() => removePerson(host, person.name))} />}
            </div>
            {/* The owner uses this computer through each server it keeps a line to, as their phone there does. */}
            {person.owner &&
              lines
                .filter(line => !line.refused)
                .map(line => (
                  <p key={line.url} className="text-xs text-muted-foreground">
                    {line.mode === 'watch' ? `${nameAt(line.url)} only sees this computer's runs.` : `Uses this computer through ${nameAt(line.url)}.`}
                  </p>
                ))}
            {/* A person a server's line named here: where they come from, and whether that server still has them. */}
            {person.from !== undefined && !(person.removed && !person.kept) && <p className="text-xs text-muted-foreground">{person.removed ? `Removed from ${nameAt(person.from)}. Kept here, switched off.` : `Uses this computer through ${nameAt(person.from)}.`}</p>}
            {person.from !== undefined && person.removed && !person.kept && (
              <div role="group" aria-label={`${person.name} was removed from ${nameAt(person.from)}`} className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-warning">{`Removed from ${nameAt(person.from)}.`}</p>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={busy || down} onClick={() => void act(() => keepPerson(host, person.name))}>
                    Keep, switched off
                  </Button>
                  <RemovePerson name={person.name} label="Remove" busy={busy} onConfirm={() => act(() => removePerson(host, person.name))} />
                </div>
              </div>
            )}
            {person.working && <p className="text-xs text-muted-foreground">{`Making ${person.name}'s own user on this computer, with their own OpenAgent. This takes a minute or two.`}</p>}
            {person.problem !== undefined && !person.working && <p role="alert" className="text-xs text-danger">{`${person.name}'s own user on this computer could not be made: ${person.problem.replace(/\.?$/, '.')} Add a device for them again to try again.`}</p>}
            {/* A person of a server has their devices at that server: none here is none missing. */}
            {person.from === undefined && theirs.length === 0 && <p className="text-xs text-muted-foreground">No device yet.</p>}
            <List aria-label={`Devices of ${person.name}`}>
              {theirs.map(device => (
                <DoorDevice key={device.id} device={device} mine={person.owner === true} busy={busy} onRemove={() => void act(() => removeDevice(host, device.id))} />
              ))}
            </List>
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
  const { value: read, reload } = usePolled<Answer<PersonThere> | undefined>(() => loadMine(), undefined, everyMs, [])
  const [changed, setChanged] = useState<PersonThere | undefined>()
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
    <div className="space-y-8">
      <p className="max-w-180 text-sm text-muted-foreground">{`This computer is shared, and you are on it as ${person}. Your devices are in until you remove them. A new device gets in with a code from the computer's owner.`}</p>
      <Slot of={{ state: read === undefined ? 'unknown' : 'fresh', value: mine }} shape={<RowShapes />}>
        {mine =>
          mine !== undefined && (
            <Section title="Your devices" {...(devices.length > 0 ? { count: devices.length } : {})}>
              {devices.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
              <List aria-label="Your devices">
                {devices.map(device => (
                  <DoorDevice key={device.id} device={device} mine busy={busy} onRemove={() => void remove(device.id)} />
                ))}
              </List>
            </Section>
          )
        }
      </Slot>
      {read !== undefined && !read.ok && <Problem>{`Your devices could not be read: ${read.error}`}</Problem>}
      {error !== undefined && <Problem>{error}</Problem>}
    </div>
  )
}
