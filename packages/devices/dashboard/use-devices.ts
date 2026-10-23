import { useEffect, useRef, useState } from 'react'
import { useModuleHost, usePolled, type ModuleHost, type ModuleMachines } from '@openagt/dashboard/module'
import { loadStatus, type DoorStatus } from './devices.js'
import { addThrough, askLink, connect, forget, loadDevices, loadServers, loadShared, markAdded, ownGithub, reach, readPersonThere, type Answer, type DevicesRead, type OwnGithub, type PersonThere, type ServerRow, type ServersRead, type SharedRow } from './servers.js'
import { hasDoor, itemsOf, type Item, type Sources } from './model.js'

// What Settings › Devices reads, read once for the list and every page of it: this computer's
// door, the servers it installed and what each is doing, the saved machines, what each server's
// door says of this computer's person, and who is in at each server. And what a person does that
// takes more than one command: an install, its last step (the server is saved among the machines),
// a server's removal.

/**
 * How often a server is asked who is in while a code is on the page: a device that just got in
 * shows soon. Each time is a login over SSH, and a server may shut out an address that logs in
 * too often: not more often than this.
 */
export const WITH_A_CODE_MS = 10_000
/** How long a read of a server's devices is waited for: one that never answers is not left in the way of the next. */
const DEVICES_ANSWER_MS = 45_000

const without = (reasons: Record<string, string>, address: string): Record<string, string> => Object.fromEntries(Object.entries(reasons).filter(([at]) => at !== address))

export interface Paces {
  /** How often the door and the installs are read again. */
  everyMs: number
  /** How often a server is asked who is in: each time is a login over SSH. */
  devicesEveryMs: number
  /** How long one such read is waited for. */
  devicesAnswerMs?: number
}

export interface Devices {
  host: ModuleHost
  /** The door as last read, or why it could not be. */
  door: Answer<DoorStatus> | undefined
  /** The servers as last read; a read that failed once takes none off. */
  servers: ServerRow[]
  /** Why the servers could not be read the last time. */
  serversError: string | undefined
  /** This computer is itself a server OpenAgent was installed on: it offers no server to set up. */
  isServer: boolean
  machines: ModuleMachines | undefined
  people: Record<string, PersonThere | undefined>
  /** Who is in at each server this computer installed, by address; and why the last read failed. */
  devices: Record<string, DevicesRead | undefined>
  devicesError: Record<string, string | undefined>
  /** What this computer keeps for each server installed elsewhere: its line there. */
  shared: SharedRow[]
  items: Item[]
  /** The GitHub account this computer is logged in to, and why there is none. */
  account: string | undefined
  noLogin: string | undefined
  busy: boolean
  error: string | undefined
  setError: (error: string | undefined) => void
  /** Why a server whose install ended is not among the machines, by address. */
  notAdded: Record<string, string>
  /** The server whose Update or Try again was pressed, until its command answered. */
  pressed: string | undefined
  reloadDoor: () => Promise<unknown>
  /**
   * Change the door with one of its commands: its answer is the door from then on, until the read
   * made after it has landed (a read on its way before the change tells the door as it was).
   */
  changeDoor: (change: () => Promise<Answer<DoorStatus>>) => Promise<Answer<DoorStatus>>
  reloadServers: () => Promise<unknown>
  reloadMachines: () => Promise<unknown>
  reloadDevices: () => Promise<unknown>
  reloadShared: () => Promise<unknown>
  /** Set a server whose devices are awaited (a code is on the page): it is asked more often. */
  await: (address: string | undefined) => void
  /** Put what a change answered in place of the last read of a server's devices. */
  setDevices: (address: string, read: DevicesRead) => void
  /** Run a change, and read the servers again; whether it went. */
  act: (change: () => Promise<Answer<unknown>>) => Promise<boolean>
  /** Install OpenAgent at a server, or update it there; whether the install started. */
  install: (address: string, user: string, github?: boolean, through?: string) => Promise<boolean>
  /** Save a server whose install ended among the machines. */
  addToMachines: (server: ServerRow) => Promise<void>
  removeServer: (server: ServerRow) => Promise<void>
  /** Take a saved machine off, and this computer out of it; whether it went. */
  removeMachine: (id: string) => Promise<boolean>
}

export function useDevices({ everyMs, devicesEveryMs, devicesAnswerMs = DEVICES_ANSWER_MS }: Paces): Devices {
  const host = useModuleHost()
  const { value: read0, reload: reloadDoor } = usePolled<Answer<DoorStatus> | undefined>(() => loadStatus(host), undefined, everyMs, [])
  const [doorChanged, setDoorChanged] = useState<DoorStatus | undefined>()
  const door: Answer<DoorStatus> | undefined = doorChanged ? { ok: true, value: doorChanged } : read0
  const changeDoor = async (change: () => Promise<Answer<DoorStatus>>): Promise<Answer<DoorStatus>> => {
    const answer = await change()
    if (answer.ok) setDoorChanged(answer.value)
    await reloadDoor().catch(() => {})
    setDoorChanged(undefined)
    return answer
  }
  const { value: read, reload: reloadServers } = usePolled<Answer<ServersRead> | undefined>(() => loadServers(host), undefined, everyMs, [])
  const { value: machines, reload: reloadMachines } = usePolled<ModuleMachines | undefined>(() => host.machines(), undefined, Math.max(everyMs, 10_000), [])

  // What this computer last said it is: a read that fails later does not make it offer a server to set up.
  const isServer = useRef<boolean | undefined>(undefined)
  if (read?.ok) isServer.current = read.value.isServer
  const lastServers = useRef<ServerRow[]>([])
  if (read?.ok) lastServers.current = read.value.servers
  // A server lists no servers of its own: what its file may hold from before it was one is not shown.
  const servers = isServer.current ? [] : lastServers.current
  const installed = (url: string): boolean => servers.some(server => server.url === url)

  // Whose GitHub login a copy would be: asked of this computer's own gh, which asks GitHub, so not often.
  // Not before this computer said whether it is a server itself: a server copies no login of its own anywhere.
  const known = read !== undefined
  const { value: own } = usePolled<Answer<OwnGithub> | undefined>(known && !isServer.current ? () => ownGithub(host) : null, undefined, Math.max(everyMs, 5 * 60_000), [known, isServer.current])
  const account = own?.ok && 'account' in own.value ? own.value.account : undefined
  const noLogin = own === undefined || account !== undefined ? undefined : own.ok ? ('problem' in own.value ? own.value.problem : undefined) : own.error

  // What each server with a door of its own, set up elsewhere, says of this computer's person there.
  const doors = (machines?.machines ?? []).filter(machine => hasDoor(machine) && !installed(machine.url))
  const doorIds = doors.map(machine => machine.id).join(' ')
  const { value: people } = usePolled<Record<string, PersonThere | undefined>>(
    doors.length
      ? async () => {
          const said = await Promise.all(doors.map(async machine => [machine.id, await host.machinePerson(machine.id).then(asked => (asked.ok ? readPersonThere(asked.said) : undefined))] as const))
          return Object.fromEntries(said)
        }
      : null,
    {},
    Math.max(devicesEveryMs, 30_000),
    [doorIds],
    'previous',
  )
  // And this computer's line to each of them.
  const { value: sharedRead, reload: reloadShared } = usePolled<Answer<SharedRow[]> | undefined>(doors.length ? () => loadShared(host, doors.map(machine => machine.url)) : null, undefined, Math.max(everyMs, 10_000), [doorIds], 'previous')
  const shared = sharedRead?.ok ? sharedRead.value : []

  // Who is in at each server this computer installed: asked over SSH, one read at a time each.
  const [awaited, setAwaited] = useState<string | undefined>()
  const asked = servers.filter(server => server.through === undefined && !server.working && server.steps.every(step => step.state === 'done')).map(server => server.address)
  const lastDevices = useRef<Record<string, DevicesRead | undefined>>({})
  const [devicesError, setDevicesError] = useState<Record<string, string | undefined>>({})
  const [, setDevicesTick] = useState(0)
  const asking = useRef<Record<string, Promise<void> | undefined>>({})
  // Until a server answers, over SSH in seconds, the list as last told on this computer: read at once, once.
  const keptAsked = useRef(new Set<string>())
  const askOne = (address: string): Promise<void> => {
    if (!lastDevices.current[address] && !keptAsked.current.has(address)) {
      keptAsked.current.add(address)
      void loadDevices(host, address, true).then(kept => {
        if (!kept.ok || lastDevices.current[address]) return
        lastDevices.current = { ...lastDevices.current, [address]: kept.value }
        setDevicesTick(tick => tick + 1)
      })
    }
    asking.current[address] ??= new Promise<Answer<DevicesRead>>(resolve => {
      const late = setTimeout(() => resolve({ ok: false, error: 'The server did not say in time which devices are in.' }), devicesAnswerMs)
      void loadDevices(host, address).then(answer => {
        clearTimeout(late)
        resolve(answer)
      })
    })
      .then(answer => {
        if (answer.ok) lastDevices.current = { ...lastDevices.current, [address]: answer.value }
        setDevicesError(errors => ({ ...errors, [address]: answer.ok ? undefined : answer.error }))
        setDevicesTick(tick => tick + 1)
      })
      .finally(() => (asking.current[address] = undefined))
    return asking.current[address]!
  }
  const { reload: reloadDevices } = usePolled<number>(
    asked.length ? async () => (typeof document !== 'undefined' && document.hidden ? 0 : (await Promise.all(asked.map(askOne))).length) : null,
    0,
    awaited !== undefined ? Math.min(devicesEveryMs, WITH_A_CODE_MS) : devicesEveryMs,
    [asked.join(' '), awaited],
    'previous',
  )

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [notAdded, setNotAdded] = useState<Record<string, string>>({})
  const [pressed, setPressed] = useState<string | undefined>()
  const adding = useRef(new Set<string>())

  const act = async (change: () => Promise<Answer<unknown>>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    const answer = await change()
    if (!answer.ok) setError(answer.error)
    await reloadServers().catch(() => {})
    setBusy(false)
    return answer.ok
  }

  const install = async (at: string, as: string, github = false, through?: string): Promise<boolean> => {
    if (!machines || machines.version === 'unknown') {
      setError('This computer could not say which OpenAgent it runs.')
      return false
    }
    setNotAdded(reasons => without(reasons, at))
    setPressed(at)
    const started = await act(() => connect(host, at, as, machines.version, github, through))
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
        await Promise.all([reloadServers(), reloadMachines()]).catch(() => {})
        return
      }
      // Read now, not as the page last saw them: the machines change from the launcher, too.
      if ((await host.machines()).machines.find(machine => machine.url === server.url)?.version === undefined) {
        const link = await askLink(host, server.address)
        const added = link.ok ? await host.addMachine(link.value.url, server.address) : link
        if (!added.ok) return stopped(added.error)
        // At once: this computer has a new key there, and the page names its own entry among the server's devices by it.
        await reloadMachines().catch(() => {})
      }
      const told = await markAdded(host, server.address)
      if (!told.ok) return stopped(told.error)
      // A server just connected can start runs on this computer, until the person says otherwise:
      // the switch under This computer. One that could not be given its line shows the switch off.
      if (told.value.find(row => row.address === server.address)?.reach === undefined) await reach(host, server.address, 'full')
      await Promise.all([reloadServers(), reloadMachines()]).catch(() => {})
    } catch (err) {
      // Told, so the page does not try by itself again at its next look.
      stopped(err instanceof Error ? err.message : String(err))
    } finally {
      adding.current.delete(server.address)
    }
  }

  // A server whose install just ended is added by itself, once: a failure is told, and tried again on a press.
  useEffect(() => {
    if (!machines) return
    for (const server of servers) if (server.adding && !server.working && server.steps.every(step => step.state === 'done') && notAdded[server.address] === undefined) void addToMachines(server)
  })

  const removeMachine = async (id: string): Promise<boolean> => {
    const removed = await host.removeMachine(id).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    if (!removed.ok) setError(removed.error)
    await reloadMachines().catch(() => {})
    return removed.ok
  }

  /**
   * Take a server off the list: this computer's key there, the line it keeps to it, and its row.
   * A server a run is at work on stays as it is, and the page says why.
   */
  const removeServer = async (server: ServerRow): Promise<void> => {
    // From the press on: the machines are asked first, and a second press meanwhile is no second removal.
    setBusy(true)
    setError(undefined)
    const machine = (await host.machines().catch(() => machines))?.machines.find(saved => saved.url === server.url)
    if (!machine || (await removeMachine(machine.id))) {
      const forgotten = await forget(host, server.address)
      if (!forgotten.ok) setError(forgotten.error)
      await reloadServers().catch(() => {})
    }
    setBusy(false)
  }

  const status = door?.ok ? door.value : undefined
  const sources: Sources = { door: status, servers, machines: machines?.machines ?? [], people: people ?? {}, devices: lastDevices.current }
  return {
    host,
    door,
    servers,
    serversError: read !== undefined && !read.ok ? read.error : undefined,
    isServer: isServer.current === true,
    machines,
    people: people ?? {},
    devices: lastDevices.current,
    devicesError,
    shared,
    items: itemsOf(sources),
    account,
    noLogin,
    busy,
    error,
    setError,
    notAdded,
    pressed,
    reloadDoor,
    changeDoor,
    reloadServers,
    reloadMachines,
    reloadDevices,
    reloadShared,
    await: setAwaited,
    setDevices: (address, value) => {
      lastDevices.current = { ...lastDevices.current, [address]: value }
      setDevicesTick(tick => tick + 1)
    },
    act,
    install,
    addToMachines,
    removeServer,
    removeMachine,
  }
}
