import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Globe, Loader2, Monitor, Server, Smartphone, Ticket, Waypoints, Wifi } from 'lucide-react'
import { Button, Dialog, buttonVariants, cn, type ModuleMachine } from '@openagt/dashboard/module'
import { addDevice, findComputers, readPersonThere, setSwitch, type Answer, type FoundComputer, type Given } from './devices.js'
import { askLink, installDone } from './servers.js'
import { CodeCard, Joined, NoCodeYet, PhoneCode, RanOut, Waiting, clock, useCode } from './codes.js'
import { ConnectServer } from './ConnectServer.js'
import { JoinDialog } from './Join.js'
import { Connecting } from './Pairing.js'
import { computerName, hasDoor, isComputer } from './model.js'
import { Problem, hostOf } from './parts.js'
import { WARNING } from './ThisComputer.js'
import type { Devices } from './use-devices.js'

// Add device: what is being added, then that one's own way in, each on what OpenAgent does today.
// A phone gets a code to scan: from this computer's door on the Wi-Fi, or from a server of this
// person's, from anywhere. Another computer on the Wi-Fi is found there, and connected once a
// person there allows it; it can be let in here in the same go. A computer somewhere else is
// given a code to type there, through a server. A server is set up over SSH. A code someone gave
// is typed in.

export type Adding = 'choose' | 'phone' | 'computer' | 'server' | 'code'

const KINDS: readonly { id: Exclude<Adding, 'choose'>; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; title: string; words: string }[] = [
  { id: 'phone', icon: Smartphone, title: 'Phone or tablet', words: 'Scan a code with its camera.' },
  { id: 'computer', icon: Monitor, title: 'Computer', words: 'Another Mac or PC that runs OpenAgent.' },
  { id: 'server', icon: Server, title: 'Server', words: 'Install OpenAgent on a VPS, or on a PC that stays on.' },
  { id: 'code', icon: Ticket, title: 'I have a code', words: 'Join a server of yours, or a computer someone shared with you.' },
]

/** A Tailscale address is reached the first time only once its certificate is fetched, which Safari may sit out as a black page. */
const TAILSCALE_FIRST_OPEN = 'The first open of a Tailscale address can take a few seconds. If the page stays black, reload it.'

/**
 * The names of the devices on the list, and whose new one got in: what a code's dialog says once
 * one did. A code from a server's door (`at`, by its address) is watched on that server's own list
 * of devices, as the list of this computer's devices never shows a server at home's.
 */
export function useJoined(d: Devices, waiting: boolean, at?: string): string | undefined {
  const before = useRef<Set<string> | undefined>(undefined)
  const [joined, setJoined] = useState<string | undefined>()
  const listed = (): { key: string; name: string }[] => (at !== undefined ? (d.devices[at]?.devices ?? []).map(device => ({ key: device.id, name: device.name })) : d.items)
  const keys = listed()
    .map(item => item.key)
    .join(' ')
  useEffect(() => {
    if (!waiting) {
      before.current = undefined
      return
    }
    if (before.current === undefined) {
      before.current = new Set(listed().map(item => item.key))
      setJoined(undefined)
      return
    }
    const fresh = listed().find(item => !before.current!.has(item.key))
    if (fresh) setJoined(fresh.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, keys])
  return joined
}

export function AddDevice({ d, start, isServer, onClose, onInvite, onJoined }: { d: Devices; start: Adding; /** This computer is a server: it sets up no server. */ isServer: boolean; onClose: () => void; /** Add people to a server just set up. */ onInvite: (address: string) => void; /** A computer someone shared was joined: its page, by its machine's id. */ onJoined: (machineId: string) => void }) {
  const [adding, setAdding] = useState<Adding>(start)
  if (adding === 'choose') return <Choose kinds={isServer ? KINDS.filter(kind => kind.id !== 'server') : KINDS} onPicked={setAdding} onClose={onClose} />
  if (adding === 'phone') return <AddPhone d={d} onClose={onClose} />
  if (adding === 'computer') return <AddComputer d={d} onClose={onClose} />
  if (adding === 'server') return <ConnectServer d={d} onClose={onClose} onInvite={onInvite} />
  return <JoinDialog d={d} onClose={onClose} onJoined={onJoined} />
}

function Choose({ kinds, onPicked, onClose }: { kinds: typeof KINDS; onPicked: (adding: Adding) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<Exclude<Adding, 'choose'>>('phone')
  return (
    <Dialog open onOpenChange={open => !open && onClose()} title="Add a device">
      <div className="space-y-4">
        <p className="text-sm">What are you adding?</p>
        <div role="radiogroup" aria-label="What are you adding?" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {kinds.map(({ id, icon: Icon, title, words }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={picked === id}
              onClick={() => setPicked(id)}
              onDoubleClick={() => onPicked(id)}
              className={cn('flex gap-3 rounded-lg border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]', picked === id ? 'border-[var(--color-primary)]' : 'border-border')}
            >
              <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{words}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onPicked(picked)}>
            Continue
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/**
 * The servers a device of this person's gets in at from here: each server this computer is in at,
 * installed here or set up elsewhere, done; never another person's computer.
 */
export const serversOf = (d: Devices): ModuleMachine[] =>
  (d.machines?.machines ?? []).filter(machine => hasDoor(machine) && machine.owner === undefined && !d.servers.some(server => server.url === machine.url && !installDone(server)))

/** A code from a server's door, as the dialogs show it. */
const codeAt = async (d: Devices, server: ModuleMachine): Promise<Answer<Given>> => {
  const asked = await d.host.machineCode(server.id)
  return asked.ok ? { ok: true, value: asked.value } : asked
}

/** A place a phone's code comes from, besides this computer's own door: a server of the person's, or a server at home with a door of its own on Tailscale. */
interface Place {
  id: string
  label: string
  /** The address the page waits at for the device that gets in. */
  address: string
  /** A door on Tailscale: the phone must be on it. */
  tailscale?: string
  ask: () => Promise<Answer<Given>>
}

/** Where a phone of this person's gets a code from here: each server this computer is in at, and each server at home it installed whose door opened on Tailscale since, asked over SSH. */
function placesOf(d: Devices): Place[] {
  const servers = serversOf(d).map((server): Place => ({ id: server.id, label: server.label, address: hostOf(server.url), ask: () => codeAt(d, server) }))
  const homes = d.items.flatMap((item): Place[] => {
    if (item.kind !== 'server' || item.server.through === undefined || !installDone(item.server) || item.door?.tailscale === undefined) return []
    const { address } = item.server
    return [{ id: `home:${address}`, label: item.name, address, tailscale: item.door.tailscale, ask: () => askLink(d.host, address) }]
  })
  return [...servers, ...homes]
}

function AddPhone({ d, onClose }: { d: Devices; onClose: () => void }) {
  const { host } = d
  const status = d.door?.ok ? d.door.value : undefined
  const places = placesOf(d)
  // Where the phone works: through a server, by its id, or on this Wi-Fi (''); asked only when there is a server to go through.
  const [where, setWhere] = useState<string | undefined>(places.length && !status?.https ? undefined : '')
  const [picked, setPicked] = useState(places[0]?.id ?? '')
  const [turning, setTurning] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [code, setCode] = useState<Given | undefined>()
  const server = places.find(candidate => candidate.id === where)
  // A code from a server at home is watched on that server's devices; a server on the internet lists its phones here, as this computer's own door does.
  const joined = useJoined(d, code !== undefined, server?.tailscale !== undefined ? server.address : undefined)
  useEffect(() => {
    d.await(server ? server.address : undefined)
    return () => d.await(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where])

  if (where === undefined)
    return (
      <Dialog open onOpenChange={open => !open && onClose()} title="Add phone">
        <div className="space-y-4">
          <p className="text-sm">Where should it work?</p>
          <div role="radiogroup" aria-label="Where should it work?" className="space-y-2">
            {places.map(place =>
              place.tailscale !== undefined ? (
                <Choice key={place.id} on={picked === place.id} icon={Waypoints} title={`On your Tailscale network, through ${place.label}`} words={`It opens ${place.label} at https://${place.tailscale}, with a lock, wherever it is. Tailscale must run on it, signed in as on ${place.label}.`} onPick={() => setPicked(place.id)} />
              ) : (
                <Choice key={place.id} on={picked === place.id} icon={Globe} title={`Anywhere, through ${place.label}`} recommended={place.id === places[0]!.id} words={`It opens ${place.label}, with a lock. From there it starts runs on this computer and on all your devices that are on.`} onPick={() => setPicked(place.id)} />
              ),
            )}
            {status?.tailscale ? (
              <Choice on={picked === ''} icon={Waypoints} title="On your Tailscale network" words={`It opens this computer at https://${status.tailscale.address}, with a lock, wherever it is. Tailscale must run on it, signed in as on this computer.`} onPick={() => setPicked('')} />
            ) : (
              <Choice on={picked === ''} icon={Wifi} title="Only on this Wi-Fi" words="It opens this computer directly. No lock on the link: someone on the same Wi-Fi could listen. Use it at home." onPick={() => setPicked('')} />
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Back
            </Button>
            <Button size="sm" onClick={() => setWhere(picked)}>
              Show the code
            </Button>
          </div>
        </div>
      </Dialog>
    )

  // Behind Tailscale with the door not served yet: what is in the way, and where the person clears it.
  if (where === '' && status?.tailscale && !status.listening)
    return (
      <Dialog open onOpenChange={open => !open && onClose()} title="Add phone">
        <div className="space-y-4 text-sm">
          <p>{status.problem ?? 'The door on your Tailscale network is opening. One moment.'}</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {status.fixAt !== undefined && (
              <a href={status.fixAt} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'sm' })}>
                Turn on Serve
              </a>
            )}
          </div>
        </div>
      </Dialog>
    )

  // On this Wi-Fi with the door shut: turned on first, after its warning.
  if (where === '' && !status?.https && !status?.listening)
    return (
      <Dialog open onOpenChange={open => !open && onClose()} title="Add phone">
        <div className="space-y-4 text-sm">
          <p>{status?.on ? 'The door on this Wi-Fi is opening. One moment.' : 'A phone on this Wi-Fi reaches this computer once "On this Wi-Fi" is on.'}</p>
          {!status?.on && <p className="text-xs text-muted-foreground">{WARNING}</p>}
          {error !== undefined && <Problem>{error}</Problem>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {!status?.on && (
              <Button
                size="sm"
                disabled={turning || !status}
                onClick={() => {
                  setTurning(true)
                  void setSwitch(host, true).then(async answer => {
                    if (!answer.ok) setError(answer.error)
                    await d.reloadDoor().catch(() => {})
                    setTurning(false)
                  })
                }}
              >
                {turning && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                Turn on and show the code
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    )

  return (
    <PhoneCode
      title="Add phone"
      // The person's own phone: at a server through its door, else at this computer's. Someone else's device is added with Add person.
      ask={server ? server.ask : () => addDevice(host)}
      {...(server ? { openHere: true } : {})}
      {...(server?.tailscale !== undefined || (!server && status?.tailscale) ? { hint: TAILSCALE_FIRST_OPEN } : {})}
      joined={joined}
      onCode={setCode}
      onClose={onClose}
    />
  )
}

/** One of a dialog's choices, as a card to pick. */
function Choice({ on, icon: Icon, title, words, recommended = false, onPick }: { on: boolean; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; title: string; words: string; recommended?: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick} className={cn('flex w-full gap-3 rounded-lg border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]', on ? 'border-[var(--color-primary)]' : 'border-border')}>
      <span aria-hidden className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-[var(--color-primary)]' : 'border-muted-foreground/50')}>
        {on && <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />}
      </span>
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span>
        <span className="flex items-center gap-2 text-sm font-medium">
          {title}
          {recommended && <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground">Recommended</span>}
        </span>
        <span className="block text-xs text-muted-foreground">{words}</span>
      </span>
    </button>
  )
}

/** How long the Wi-Fi rests between two looks, while the list is on the page: each look takes a few seconds itself. */
const FIND_REST_MS = 3_000

/** The computers on this Wi-Fi whose door is open there, looked for again and again while `looking`. */
function useFound(d: Devices, looking: boolean): { found: FoundComputer[] | undefined; error: string | undefined } {
  const [found, setFound] = useState<FoundComputer[] | undefined>()
  const [error, setError] = useState<string | undefined>()
  useEffect(() => {
    if (!looking) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const look = async (): Promise<void> => {
      const answer = await findComputers(d.host)
      if (stopped) return
      if (answer.ok) setFound(answer.value)
      setError(answer.ok ? undefined : answer.error)
      timer = setTimeout(() => void look(), FIND_REST_MS)
    }
    void look()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looking])
  return { found, error }
}

function AddComputer({ d, onClose }: { d: Devices; onClose: () => void }) {
  const status = d.door?.ok ? d.door.value : undefined
  const [giving, setGiving] = useState(false)
  const [connecting, setConnecting] = useState<FoundComputer | undefined>()
  const { found, error } = useFound(d, !giving && connecting === undefined)
  const server = serversOf(d)[0]

  if (giving && server) return <GiveCode d={d} server={server} onClose={onClose} />
  // The other computer starts runs here too, when this computer's door can let it in.
  if (connecting) return <Connecting d={d} computer={connecting} canBoth={status?.listening === true} onBack={() => setConnecting(undefined)} onClose={onClose} />

  return (
    <Dialog open onOpenChange={next => !next && onClose()} title="Add computer">
      <div className="space-y-3">
        <Waiting>Looking on this Wi-Fi…</Waiting>
        {error !== undefined && <Problem>{error}</Problem>}
        {found !== undefined && found.length > 0 && (
          <ul aria-label="On this Wi-Fi" className="divide-y divide-border border-y border-border">
            {found.map((computer, at) => (
              <li key={computer.url} className="flex items-center gap-3 py-2.5">
                <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{computer.name}</span>
                  {computer.version !== undefined && <span className="block text-xs text-muted-foreground">{`OpenAgent ${computer.version}`}</span>}
                </span>
                <Button size="sm" variant={at === 0 ? 'default' : 'outline'} aria-label={`Connect ${computer.name}`} onClick={() => setConnecting(computer)}>
                  Connect
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Not in the list? Open OpenAgent on it, on the same Wi-Fi, with "On this Wi-Fi" on there.</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-sm">
            Somewhere else?
            <span className="block text-xs text-muted-foreground">{server ? `At the office, at a friend's: it joins through ${server.label}.` : "At the office, at a friend's: it joins through a server. Add a server first."}</span>
          </span>
          <Button size="sm" type="button" variant="outline" disabled={!server} onClick={() => setGiving(true)}>
            <Ticket className="h-3.5 w-3.5" aria-hidden />
            Give it a code
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/** How often a server is asked whether the computer got in, while its code is on the page: one call to the server's door. */
const JOIN_POLL_MS = 3_000

/**
 * Another computer of this person's, somewhere else, gets in at their server with a code typed
 * there: where and the code. Once it is in and keeps its line there, it is saved here, through the
 * server, so runs go both ways in one go.
 */
export function GiveCode({ d, server, onClose }: { d: Devices; server: ModuleMachine; onClose: () => void }) {
  const { host } = d
  const [joined, setJoined] = useState<{ name: string; saved: boolean } | undefined>()
  const { code, asking, error, left, expired, again } = useCode(() => codeAt(d, server), true, undefined, joined?.saved === true)
  // What was at the server when the code came: what is new after it is the computer that used it.
  const before = useRef<{ devices: Set<string>; computers: Set<string> } | undefined>(undefined)
  // This computer keeps its line at the server: then the new one starts runs here too.
  const line = d.shared.find(row => row.url === server.url)?.reach === 'full' || d.servers.some(row => row.url === server.url && row.reach === 'full')

  useEffect(() => {
    before.current = undefined
    setJoined(undefined)
    if (!code) return
    let stopped = false
    const look = async (): Promise<void> => {
      const [person, there] = await Promise.all([host.machinePerson(server.id), host.computersThrough(server.id)])
      const devices = (person.ok ? readPersonThere(person.said)?.devices : undefined) ?? []
      const computers = there.ok ? there.computers.filter(computer => computer.owner === undefined) : []
      if (stopped) return
      if (!before.current) {
        before.current = { devices: new Set(devices.map(device => device.id)), computers: new Set(computers.map(computer => computer.id)) }
        return
      }
      const fresh = computers.find(computer => !before.current!.computers.has(computer.id) && !computer.added)
      if (fresh) {
        const saved = await host.addComputerThrough(server.id, fresh.id)
        await d.reloadMachines().catch(() => {})
        if (!stopped) setJoined({ name: fresh.name, saved: saved.ok })
        return
      }
      const entered = devices.find(device => !before.current!.devices.has(device.id) && isComputer(device))
      if (entered) setJoined(was => was ?? { name: computerName(entered.name), saved: false })
    }
    void look()
    const timer = setInterval(() => void look(), JOIN_POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])
  const done = joined?.saved === true

  return (
    <Dialog open onOpenChange={open => !open && onClose()} title="Give it a code">
      <div className="space-y-4">
        {done ? (
          <Joined words={line ? 'Runs go both ways, through ' + server.label + '. The code is spent.' : `Your runs can go there. Turn on "From anywhere, through ${server.label}" for its runs to come here.`}>{`${joined!.name} is in.`}</Joined>
        ) : asking || error !== undefined || !code?.where || !code.code ? (
          <NoCodeYet asking={asking} error={error ?? (code ? 'the server gives no code to type yet: update it first' : undefined)} />
        ) : expired && joined === undefined ? (
          <RanOut />
        ) : (
          <>
            <p className="text-sm">
              On the other computer, open <span className="font-medium">Settings › Devices › Add device › I have a code</span>, and type:
            </p>
            <CodeCard where={code.where} code={code.code} />
            {joined !== undefined ? (
              <Waiting>{`${joined.name} is in. Waiting for it to keep its line at ${server.label}, so runs go both ways…`}</Waiting>
            ) : (
              <Waiting>{`Waiting… the code works once, for ${clock(left)}. It joins as yours, through ${server.label}.`}</Waiting>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          {!asking && !done && (expired || error !== undefined || !code) && joined === undefined && (
            <Button size="sm" variant="outline" onClick={() => void again()}>
              New code
            </Button>
          )}
          <Button size="sm" variant={done ? 'default' : 'ghost'} onClick={onClose}>
            {done ? 'Done' : 'Cancel'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
