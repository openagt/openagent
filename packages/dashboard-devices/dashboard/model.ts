import { reachedByLine, type ModuleMachine } from '@openagt/dashboard/module'
import { idsOf, type DeviceRow, type DoorStatus, type PersonThere } from './devices.js'
import type { DevicesRead, ServerRow } from './servers.js'

// Settings › Devices lists every device once, whatever this computer knows it by: a phone in at
// this computer's door, a phone of this person's in at one of their servers, another computer
// (which may be both a machine runs go to and a device in at this door), a server this computer
// installed, a server this person was invited to, another person's computer. This is where those
// are put together, from what each part of OpenAgent says: no page reads the parts apart.

/** Where a computer reached through a server is, after the server's address. */
const THROUGH = '/_devices/via/'

/** The name a computer's OpenAgent is listed under at a door it got in at by itself. */
const AGENT_NAME = /^OpenAgent on /

/** A phone or a browser, in at this computer's door or at a server of this person's. */
export interface PhoneItem {
  kind: 'phone'
  key: string
  name: string
  /** Where it reaches this computer: on its Wi-Fi, at this server's own address, or through a server. */
  via: { wifi: true } | { internet: true } | { tailscale: true } | { server: string; label: string }
  added: string
  seen?: string
  /** In at this computer's door, by its id there. */
  door?: DeviceRow
  /** In at a server this computer installed, by its address. */
  at?: { address: string; device: DeviceRow }
  /** In at a server this person is in at (installed elsewhere, or invited to), by the machine. */
  on?: { machine: ModuleMachine; device: DeviceRow }
}

/** Another computer that runs OpenAgent: runs go there, it starts runs here, or both. */
export interface ComputerItem {
  kind: 'computer'
  key: string
  name: string
  /** Saved here: this computer's runs can go there. */
  machine?: ModuleMachine
  /** In at this computer's door: it starts runs here. */
  door?: DeviceRow
  /** Reached through a server: that server's address, and its name. */
  through?: { url: string; label: string }
  /** On a server: a person's own computer, reached by the line it keeps open to this one. */
  line?: true
}

/** A server this computer installed OpenAgent on: on the internet, or a computer at home reached through one. */
export interface ServerItem {
  kind: 'server'
  key: string
  name: string
  server: ServerRow
  machine?: ModuleMachine
  /** How many people its door lists, once read. */
  people?: number
  /** Where its door is open, as it said when its devices were read: on the internet, on Tailscale, or both ways a computer is reached. */
  door?: { https?: string; tailscale?: string }
}

/** A server this person is in at, set up from somewhere else: theirs from another computer, or someone's who invited them. */
export interface JoinedItem {
  kind: 'joined'
  key: string
  name: string
  machine: ModuleMachine
  person: PersonThere
}

/** Another person's computer, shared with everyone on a server this person is in at. */
export interface OtherItem {
  kind: 'other'
  key: string
  name: string
  machine: ModuleMachine
  owner: string
  /** What its door says of this person there, once asked: a computer shared with them at its own door. */
  person?: PersonThere
}

export type Item = PhoneItem | ComputerItem | ServerItem | JoinedItem | OtherItem

/** What each part says, as the page last read it. */
export interface Sources {
  /** This computer's door. */
  door: DoorStatus | undefined
  /** The servers this computer installed OpenAgent on. */
  servers: readonly ServerRow[]
  /** The saved machines, with what each says of itself. */
  machines: readonly ModuleMachine[]
  /** What the door of each server with a door of its own says of this person, by the machine's id, once asked. */
  people: Readonly<Record<string, PersonThere | undefined>>
  /** Who is in at each server this computer installed, by its address, once asked. */
  devices: Readonly<Record<string, DevicesRead | undefined>>
}

/** A computer reached over the person's Tailscale network, at its name there: its door is its own, and it keeps no line for anyone. Its door says who this person is there, as a server's does. */
export const onTailscale = (machine: Pick<ModuleMachine, 'url'>): boolean => /^https:\/\/[^/]+\.ts\.net(:\d+)?$/i.test(machine.url)

/** A server with a door of its own on the internet: one that can say who this computer's person is there. */
export const hasDoor = (machine: Pick<ModuleMachine, 'url'>): boolean => machine.url.startsWith('https://') && !machine.url.includes(THROUGH) && !onTailscale(machine)

/** Where a saved computer is reached from here, in the words its row says it with. */
export const reachedAt = (machine: Pick<ModuleMachine, 'url'> | undefined): string => (machine && onTailscale(machine) ? 'on your Tailscale network' : machine?.url.startsWith('https://') ? 'on the internet' : 'on this Wi-Fi')

/** The server a machine reached through one is reached through, by its address. */
export const throughOf = (machine: Pick<ModuleMachine, 'url'>): string | undefined => (machine.url.includes(THROUGH) ? machine.url.slice(0, machine.url.indexOf(THROUGH)) : undefined)

/** A server by its name, when it is among the saved machines; by its address otherwise. */
export const labelOf = (machines: readonly Pick<ModuleMachine, 'url' | 'label'>[], url: string): string => machines.find(machine => machine.url === url)?.label ?? url.replace(/^https?:\/\//, '')

/** Whether a device in at a door is another computer's OpenAgent, by what it holds or how it named itself. */
export const isComputer = (device: Pick<DeviceRow, 'name' | 'line'>): boolean => device.line === true || AGENT_NAME.test(device.name)

/** A computer's own name, as a door lists the OpenAgent on it that got in by itself. */
export const computerName = (listed: string): string => listed.replace(AGENT_NAME, '')

/**
 * Every device, once, in the order the list shows them: phones first, then computers, then
 * servers. A computer saved here and also in at this computer's door is one item: the machine says
 * the ids it is listed under at the doors it saved, and one of them is that device's here.
 */
export function itemsOf(sources: Sources): Item[] {
  const { door, servers, machines, people, devices } = sources
  const items: Item[] = []
  const doorDevices = door?.devices ?? []
  const installed = (machine: ModuleMachine): ServerRow | undefined => servers.find(server => server.url === machine.url)
  const here: PhoneItem['via'] = door?.https ? { internet: true } : door?.tailscale ? { tailscale: true } : { wifi: true }

  // This computer's door: phones and browsers, and computers that start runs here.
  const matched = new Set<string>()
  const computerOf = (device: DeviceRow): ModuleMachine | undefined => machines.find(machine => machine.listed?.some(id => idsOf(device).includes(id)))
  for (const device of doorDevices) {
    if (isComputer(device)) continue
    items.push({ kind: 'phone', key: `door:${device.id}`, name: device.name, via: here, added: device.added, ...(device.seen !== undefined ? { seen: device.seen } : {}), door: device })
  }

  // This person's own phones at the servers they are in at: not this computer, not a computer on a line there.
  const mineAt = (listed: readonly DeviceRow[], persons: readonly { name: string; owner?: true }[], own: string | undefined): DeviceRow[] => {
    const owner = persons.find(person => person.owner)?.name
    return listed.filter(device => !isComputer(device) && !device.own && !(own !== undefined && idsOf(device).includes(own)) && (device.person === undefined || device.person === owner))
  }
  for (const server of servers) {
    const read = devices[server.address]
    if (!read || server.through !== undefined) continue
    const machine = machines.find(candidate => candidate.url === server.url)
    for (const device of mineAt(read.devices, read.persons, machine?.device))
      items.push({ kind: 'phone', key: `at:${server.address}:${device.id}`, name: device.name, via: { server: server.url, label: machine?.label ?? server.address }, added: device.added, ...(device.seen !== undefined ? { seen: device.seen } : {}), at: { address: server.address, device } })
  }
  for (const machine of machines) {
    const person = people[machine.id]
    if (!person || installed(machine)) continue
    for (const device of person.devices.filter(device => !isComputer(device) && !(machine.device !== undefined && idsOf(device).includes(machine.device))))
      items.push({ kind: 'phone', key: `on:${machine.id}:${device.id}`, name: device.name, via: { server: machine.url, label: machine.label }, added: device.added, ...(device.seen !== undefined ? { seen: device.seen } : {}), on: { machine, device } })
  }

  // Other computers: each saved machine that is no server, with its device here when it is in here too.
  for (const machine of machines) {
    if (installed(machine) || people[machine.id] !== undefined) continue
    if (machine.owner !== undefined) continue
    const device = doorDevices.find(candidate => isComputer(candidate) && computerOf(candidate) === machine)
    if (device) matched.add(device.id)
    const through = throughOf(machine)
    items.push({ kind: 'computer', key: `machine:${machine.id}`, name: machine.label, machine, ...(device ? { door: device } : {}), ...(through !== undefined ? { through: { url: through, label: labelOf(machines, through) } } : {}), ...(reachedByLine(machine.url) ? { line: true as const } : {}) })
  }
  // And each computer of this person's in at this door that is no saved machine: it starts runs here, and runs do not go there.
  // Another person's computer, in at a server's door as theirs, is theirs alone: it is listed under them, never offered here.
  for (const device of doorDevices) if (isComputer(device) && device.person === undefined && !matched.has(device.id)) items.push({ kind: 'computer', key: `door:${device.id}`, name: computerName(device.name), door: device })

  // Servers: installed here; set up elsewhere or shared by someone; another person's computer.
  for (const server of servers) {
    const machine = machines.find(candidate => candidate.url === server.url)
    const read = devices[server.address]
    items.push({ kind: 'server', key: `server:${server.address}`, name: machine?.label ?? server.address, server, ...(machine ? { machine } : {}), ...(read && read.persons.length ? { people: read.persons.length } : {}), ...(read?.door ? { door: read.door } : {}) })
  }
  for (const machine of machines) {
    const person = people[machine.id]
    if (person && !installed(machine) && machine.owner === undefined) items.push({ kind: 'joined', key: `joined:${machine.id}`, name: machine.label, machine, person })
  }
  for (const machine of machines) {
    if (machine.owner === undefined || installed(machine)) continue
    const person = people[machine.id]
    items.push({ kind: 'other', key: `other:${machine.id}`, name: machine.label, machine, owner: machine.owner, ...(person ? { person } : {}) })
  }

  return items
}

/** Whether this person has a server: until then the words say "on this Wi-Fi", never "anywhere". */
export const hasServer = (sources: Pick<Sources, 'servers' | 'machines'>): boolean => sources.servers.some(server => server.through === undefined) || sources.machines.some(hasDoor)
