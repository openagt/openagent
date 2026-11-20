import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Monitor, Server, Ticket } from 'lucide-react'
import { Button, RadioGroup, SettingsItem, SettingsItems, SettingsRow, buttonVariants, useOpenAgentDown, type ModuleMachine } from '@openagt/ui/module'
import { addDevice, findComputers, readPersonThere, setSwitch, type Answer, type FoundComputer, type Given } from './devices.js'
import { askLink, installDone } from './servers.js'
import { CodeCard, Joined, NoCodeYet, PhoneCode, RanOut, Waiting, clock, useCode } from './codes.js'
import { ConnectServer } from './ConnectServer.js'
import { Join } from './Join.js'
import { Connecting } from './Pairing.js'
import { computerName, hasDoor, isComputer } from './model.js'
import { Choice, Presses, Problem, hostOf } from './parts.js'
import { WARNING } from './ThisComputer.js'
import type { Devices } from './use-devices.js'

// Add device: what is being added, then that one's own way in, each on what OpenAgent does today.
// A phone gets a code to scan: from this computer's door on the Wi-Fi, or from a server of this
// person's, from anywhere. Another computer on the Wi-Fi is found there, and connected once a
// person there allows it; it can be let in here in the same go. A computer somewhere else is
// given a code to type there, through a server. A server is set up over SSH. A code someone gave
// is typed in. Each is a page of Settings › Devices, which the address keeps: a reload stays on it.

/** A way of adding, by the word the address keeps it under. */
export type Adding = 'add' | 'add-phone' | 'add-computer' | 'give-code' | 'set-up-server' | 'join'

/** Each way of adding, by the word the address keeps its page of Settings › Devices under, with the page's title. */
export const ADDING: Record<Adding, string> = {
  add: 'Add a device',
  'add-phone': 'Add a phone',
  'add-computer': 'Add a computer',
  'give-code': 'Give it a code',
  'set-up-server': 'Set up a server',
  join: 'Join with a code',
}

/** Whether the page the address names inside Settings › Devices is a way of adding. */
export const isAdding = (item: string | undefined): item is Adding => item !== undefined && Object.hasOwn(ADDING, item)

const KINDS: readonly { id: Adding; title: string; words: string }[] = [
  { id: 'add-phone', title: 'Phone or tablet', words: 'Scan a code with its camera.' },
  { id: 'add-computer', title: 'Computer', words: 'Another computer that runs OpenAgent.' },
  { id: 'set-up-server', title: 'Server', words: 'Install OpenAgent on a VPS, or on a PC that stays on.' },
  { id: 'join', title: 'Join with a code', words: 'Join a server of yours, or a computer someone shared with you.' },
]

/** A Tailscale address is reached the first time only once its certificate is fetched, which Safari may sit out as a black page. */
const TAILSCALE_FIRST_OPEN = 'The first open of a Tailscale address can take a few seconds. If the page stays black, reload it.'

/**
 * The names of the devices on the list, and whose new one got in: what a code's page says once
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

export function AddDevice({ d, adding, isServer, onAdd, onClose, onInvite, onJoined }: { d: Devices; adding: Adding; /** This computer is a server: it sets up no server. */ isServer: boolean; /** Go on to another way of adding. */ onAdd: (adding: Adding) => void; onClose: () => void; /** Add people to a server just set up. */ onInvite: (address: string) => void; /** A computer someone shared was joined: its page, by its machine's id. */ onJoined: (machineId: string) => void }) {
  if (adding === 'add') return <Choose kinds={isServer ? KINDS.filter(kind => kind.id !== 'set-up-server') : KINDS} onPicked={onAdd} onClose={onClose} />
  if (adding === 'add-phone') return <AddPhone d={d} onClose={onClose} />
  // With no server, a computer somewhere else has nothing to join through: Add a computer offers to set one up, but not on a server.
  const addComputer = <AddComputer d={d} onGive={() => onAdd('give-code')} {...(isServer ? {} : { onSetUpServer: () => onAdd('set-up-server') })} onClose={onClose} />
  if (adding === 'add-computer') return addComputer
  if (adding === 'give-code') {
    // A code for a computer somewhere else goes through a server: with none, the computers on this Wi-Fi.
    const server = serversOf(d)[0]
    return server ? <GiveCode d={d} server={server} onClose={onClose} /> : addComputer
  }
  if (adding === 'set-up-server') return <ConnectServer d={d} onClose={onClose} onInvite={onInvite} />
  return <Join d={d} onClose={onClose} onJoined={onJoined} />
}

function Choose({ kinds, onPicked, onClose }: { kinds: typeof KINDS; onPicked: (adding: Adding) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<Adding>('add-phone')
  return (
    <div className="space-y-4">
      <p className="text-sm">What are you adding?</p>
      <RadioGroup aria-label="What are you adding?" value={picked} onValueChange={next => setPicked(next as Adding)} className="-mx-3 gap-0">
        {kinds.map(({ id, title, words }) => (
          <div key={id} onDoubleClick={() => onPicked(id)}>
            <Choice value={id} title={title} words={words} />
          </div>
        ))}
      </RadioGroup>
      <Presses>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onPicked(picked)}>
          Continue
        </Button>
      </Presses>
    </div>
  )
}

/**
 * The servers a device of this person's gets in at from here: each server this computer is in at,
 * installed here or set up elsewhere, done; never another person's computer.
 */
export const serversOf = (d: Devices): ModuleMachine[] =>
  (d.machines?.machines ?? []).filter(machine => hasDoor(machine) && machine.owner === undefined && !d.servers.some(server => server.url === machine.url && !installDone(server)))

/** A code from a server's door, as the pages show it. */
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
  const down = useOpenAgentDown()
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
      <div className="space-y-4">
        <p className="text-sm">Where should it work?</p>
        <RadioGroup aria-label="Where should it work?" value={picked} onValueChange={next => setPicked(next as string)} className="-mx-3 gap-0">
          {places.map(place =>
            place.tailscale !== undefined ? (
              <Choice key={place.id} value={place.id} title={`On your Tailscale network, through ${place.label}`} words={`It opens ${place.label} at https://${place.tailscale}, with a lock, wherever it is. Tailscale must run on it, signed in as on ${place.label}.`} />
            ) : (
              <Choice key={place.id} value={place.id} title={`Anywhere, through ${place.label}`} badge={place.id === places[0]!.id ? 'Recommended' : undefined} words={`It opens ${place.label}, with a lock. From there it starts runs on this computer and on all your devices that are on.`} />
            ),
          )}
          {status?.tailscale ? (
            <Choice value="" title="On your Tailscale network" words={`It opens this computer at https://${status.tailscale.address}, with a lock, wherever it is. Tailscale must run on it, signed in as on this computer.`} />
          ) : (
            <Choice value="" title="Only on this Wi-Fi" words="It opens this computer directly. No lock on the link: someone on the same Wi-Fi could listen. Use it at home." />
          )}
        </RadioGroup>
        <Presses>
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button onClick={() => setWhere(picked)}>
            Show the code
          </Button>
        </Presses>
      </div>
    )

  // Behind Tailscale with the door not served yet: what is in the way, and where the person clears it.
  if (where === '' && status?.tailscale && !status.listening)
    return (
      <div className="space-y-4 text-sm">
        <p>{status.problem ?? 'The door on your Tailscale network is opening. One moment.'}</p>
        <Presses>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {status.fixAt !== undefined && (
            <a href={status.fixAt} target="_blank" rel="noreferrer" className={buttonVariants()}>
              Turn on Serve
            </a>
          )}
        </Presses>
      </div>
    )

  // On this Wi-Fi with the door shut: turned on first, after its warning.
  if (where === '' && !status?.https && !status?.listening)
    return (
      <div className="space-y-4 text-sm">
        <p>{status?.on ? 'The door on this Wi-Fi is opening. One moment.' : 'Turning this on opens this computer to the phones on this Wi-Fi.'}</p>
        {!status?.on && <p className="text-xs text-muted-foreground">{WARNING}</p>}
        {error !== undefined && <Problem>{error}</Problem>}
        <Presses>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!status?.on && (
            <Button
              loading={turning}
              disabled={!status || down}
              onClick={() => {
                setTurning(true)
                void setSwitch(host, true).then(async answer => {
                  if (!answer.ok) setError(answer.error)
                  await d.reloadDoor().catch(() => {})
                  setTurning(false)
                })
              }}
            >
              Turn on and show the code
            </Button>
          )}
        </Presses>
      </div>
    )

  return (
    <PhoneCode
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

/** How long the Wi-Fi is looked on before it is said that nothing was found yet: a look takes a few seconds itself. */
const NONE_YET_MS = 10_000

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

function AddComputer({ d, onGive, onSetUpServer, onClose }: { d: Devices; /** Give a computer somewhere else a code, through a server. */ onGive: () => void; /** Set up a server, in place of this page: what a computer somewhere else joins through. None on a server. */ onSetUpServer?: () => void; onClose: () => void }) {
  const down = useOpenAgentDown()
  const status = d.door?.ok ? d.door.value : undefined
  const [connecting, setConnecting] = useState<FoundComputer | undefined>()
  const { found, error } = useFound(d, connecting === undefined)
  const [noneYet, setNoneYet] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setNoneYet(true), NONE_YET_MS)
    return () => clearTimeout(timer)
  }, [])
  const server = serversOf(d)[0]

  // The other computer starts runs here too, when this computer's door can let it in.
  if (connecting) return <Connecting d={d} computer={connecting} canBoth={status?.listening === true} onBack={() => setConnecting(undefined)} onClose={onClose} />

  return (
    <div className="flex flex-col gap-6">
      <Waiting>{noneYet && !found?.length ? 'No computer found on this Wi-Fi yet. Still looking…' : 'Looking on this Wi-Fi…'}</Waiting>
      {error !== undefined && <Problem>{error}</Problem>}
      {found !== undefined && found.length > 0 && (
        <SettingsItems aria-label="On this Wi-Fi">
          {found.map(computer => (
            // The row is the press, as a device's row that opens its page is: "Connect" at its right at rest, at every width, in the words of the list's own press.
            <SettingsItem
              key={computer.url}
              icon={Monitor}
              title={
                <>
                  <span className="sr-only">Connect</span> {computer.name}
                </>
              }
              {...(computer.version !== undefined ? { detail: `OpenAgent ${computer.version}` } : {})}
              {...(down
                ? {}
                : {
                    end: (
                      <>
                        <span className="text-sm font-medium text-foreground">Connect</span>
                        <ChevronRight aria-hidden />
                      </>
                    ),
                    onClick: () => setConnecting(computer),
                  })}
            />
          ))}
        </SettingsItems>
      )}
      <p className="max-w-xl text-xs text-faint-foreground">Don't see it? Open OpenAgent on it, on the same Wi-Fi, and turn on "On this Wi-Fi" in its Settings › Devices.</p>
      {/* A way of its own, a part 32 under the list, and quieter than its rows' Connect. */}
      <div className="mt-2">
        <SettingsRow
          label="Somewhere else?"
          description={server ? `At the office, at a friend's: it joins through ${server.label}.` : "At the office, at a friend's: it joins through a server. Add a server first."}
          control={
            server || !onSetUpServer ? (
              <Button type="button" variant="ghost" className="max-md:-ml-3 md:-mr-3" disabled={!server} onClick={onGive}>
                <Ticket className="size-4" aria-hidden />
                Give it a code
              </Button>
            ) : (
              <Button type="button" variant="ghost" className="max-md:-ml-3 md:-mr-3" onClick={onSetUpServer}>
                <Server className="size-4" aria-hidden />
                Set up a server
              </Button>
            )
          }
        />
      </div>
      {/* Its way out, where every other way of adding keeps one: the dialog it was had only its ×. */}
      <Presses>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </Presses>
    </div>
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
  const down = useOpenAgentDown()
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
            On the other computer, open <span className="font-medium">Settings › Devices</span>, press <span className="font-medium">Join with a code</span> (or <span className="font-medium">Add device › Join with a code</span>), and type:
          </p>
          <CodeCard where={code.where} code={code.code} />
          {joined !== undefined ? (
            <Waiting>{`${joined.name} is in. Waiting for it to keep its line at ${server.label}, so runs go both ways…`}</Waiting>
          ) : (
            <Waiting>{`Waiting… the code works once, for ${clock(left)}. It joins as yours, through ${server.label}.`}</Waiting>
          )}
        </>
      )}
      <Presses>
        <Button variant={done ? 'default' : 'ghost'} onClick={onClose}>
          {done ? 'Done' : 'Cancel'}
        </Button>
        {!asking && !done && (expired || error !== undefined || !code) && joined === undefined && (
          <Button variant="secondary" disabled={down} onClick={() => void again()}>
            New code
          </Button>
        )}
      </Presses>
    </div>
  )
}
