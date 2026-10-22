import { useEffect, useRef, useState, type ComponentType, type FormEvent } from 'react'
import { Globe, Loader2, Monitor, Server, Smartphone, Ticket, Wifi } from 'lucide-react'
import { AddMachineDialog, Button, Checkbox, Dialog, Input, InviteDialog, cn, type InviteCode } from '@openagt/dashboard/module'
import { addDevice, nameOwner, ownGithub, setSwitch } from './devices.js'
import { askLink } from './servers.js'
import { ConnectServer } from './ConnectServer.js'
import { hasServer } from './model.js'
import { Problem } from './parts.js'
import { WARNING } from './ThisComputer.js'
import type { Devices } from './use-devices.js'

// Add device: what is being added, then that one's own way in, each on what OpenAgent does today.
// A phone gets a code to scan: from this computer's door on the Wi-Fi, or from a server of this
// person's, from anywhere. Another computer is saved by the link it gives, and is let in here in
// the same press; or it is given this computer's link. A server is set up over SSH. A link someone
// gave is pasted.

export type Adding = 'choose' | 'phone' | 'computer' | 'server' | 'code'

const KINDS: readonly { id: Exclude<Adding, 'choose'>; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; title: string; words: string }[] = [
  { id: 'phone', icon: Smartphone, title: 'Phone or tablet', words: 'Scan a code with its camera.' },
  { id: 'computer', icon: Monitor, title: 'Computer', words: 'Another Mac or PC that runs OpenAgent.' },
  { id: 'server', icon: Server, title: 'Server', words: 'Install OpenAgent on a VPS, or on a PC that stays on.' },
  { id: 'code', icon: Ticket, title: 'I have a code', words: 'Join a server, or a computer someone set up for you.' },
]

/** The names of the devices on the list, and whose new one got in: what a code's dialog says once one did. */
function useJoined(d: Devices, waiting: boolean): string | undefined {
  const before = useRef<Set<string> | undefined>(undefined)
  const [joined, setJoined] = useState<string | undefined>()
  const keys = d.items.map(item => item.key).join(' ')
  useEffect(() => {
    if (!waiting) {
      before.current = undefined
      return
    }
    if (before.current === undefined) {
      before.current = new Set(d.items.map(item => item.key))
      setJoined(undefined)
      return
    }
    const fresh = d.items.find(item => !before.current!.has(item.key))
    if (fresh) setJoined(fresh.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, keys])
  return joined
}

export function AddDevice({ d, start, isServer, onClose }: { d: Devices; start: Adding; /** This computer is a server: it sets up no server. */ isServer: boolean; onClose: () => void }) {
  const [adding, setAdding] = useState<Adding>(start)
  if (adding === 'choose') return <Choose kinds={isServer ? KINDS.filter(kind => kind.id !== 'server') : KINDS} onPicked={setAdding} onClose={onClose} />
  if (adding === 'phone') return <AddPhone d={d} onClose={onClose} />
  if (adding === 'computer') return <AddComputer d={d} onClose={onClose} />
  if (adding === 'server') return <ConnectServer d={d} onClose={onClose} onStarted={onClose} />
  return <AddMachineDialog onClose={onClose} onAdded={() => void d.reloadMachines()} />
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

/** The servers a phone can be let in at from here: installed from here, done, and saved. */
const phoneServers = (d: Devices) =>
  d.servers
    .filter(server => server.through === undefined && !server.working && server.steps.every(step => step.state === 'done'))
    .flatMap(server => {
      const machine = d.machines?.machines.find(saved => saved.url === server.url)
      return machine ? [{ address: server.address, label: machine.label }] : []
    })

function AddPhone({ d, onClose }: { d: Devices; onClose: () => void }) {
  const { host } = d
  const status = d.door?.ok ? d.door.value : undefined
  const servers = phoneServers(d)
  // Where the phone works: through a server, by its address, or on this Wi-Fi (''); asked only when there is a server to go through.
  const [where, setWhere] = useState<string | undefined>(servers.length && !status?.https ? undefined : '')
  const [picked, setPicked] = useState(servers[0]?.address ?? '')
  const [turning, setTurning] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [code, setCode] = useState<InviteCode | undefined>()
  const joined = useJoined(d, code !== undefined)
  useEffect(() => {
    d.await(where ? where : undefined)
    return () => d.await(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where])

  if (where === undefined)
    return (
      <Dialog open onOpenChange={open => !open && onClose()} title="Add phone">
        <div className="space-y-4">
          <p className="text-sm">Where should it work?</p>
          <div role="radiogroup" aria-label="Where should it work?" className="space-y-2">
            {servers.map(server => (
              <Choice key={server.address} on={picked === server.address} icon={Globe} title={`Anywhere, through ${server.label}`} recommended={server.address === servers[0]!.address} words={`It opens ${server.label}, with a lock. From there it starts runs on this computer and on all your devices that are on.`} onPick={() => setPicked(server.address)} />
            ))}
            <Choice on={picked === ''} icon={Wifi} title="Only on this Wi-Fi" words="It opens this computer directly. No lock on the link: someone on the same Wi-Fi could listen. Use it at home." onPick={() => setPicked('')} />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => setWhere(picked)}>
              Show the code
            </Button>
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

  const server = servers.find(candidate => candidate.address === where)
  return (
    <InviteDialog
      title="Add phone"
      ask={where ? () => askLink(host, where) : person => addDevice(host, person)}
      // A computer several people use asks who a device is for: on a personal one, a device is its owner's.
      {...(status?.https || status?.persons.length
        ? {
            persons: {
              owner: status.persons.find(person => person.owner)?.account,
              whoAmI: () => ownGithub(host),
              nameOwner: async account => {
                const named = await nameOwner(host, account)
                await d.reloadDoor().catch(() => {})
                return named.ok ? { ok: true } : named
              },
            },
          }
        : {})}
      scan={server ? `Scan it with the phone's camera: it opens OpenAgent on ${server.label}, from anywhere.` : status?.https ? "Scan it with the device's camera: it opens OpenAgent here, from anywhere." : "Scan it with the phone's camera, on the same Wi-Fi as this computer."}
      {...(server ? { openHere: true } : {})}
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
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span>
        <span className="flex items-center gap-2 text-sm">
          {title}
          {recommended && <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground">Recommended</span>}
        </span>
        <span className="block text-xs text-muted-foreground">{words}</span>
      </span>
    </button>
  )
}

/** The origin of a pasted link: the address a machine is saved under. */
const originOf = (link: string): string | undefined => {
  try {
    return new URL(link.trim()).origin
  } catch {
    return undefined
  }
}

function AddComputer({ d, onClose }: { d: Devices; onClose: () => void }) {
  const { host } = d
  const status = d.door?.ok ? d.door.value : undefined
  const [link, setLink] = useState('')
  // The other computer starts runs here too: on by default, when this computer's door can let it in.
  const open = status?.listening === true
  const [both, setBoth] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [giving, setGiving] = useState(false)
  const [code, setCode] = useState<InviteCode | undefined>()
  const joined = useJoined(d, code !== undefined)
  const server = hasServer({ servers: d.servers, machines: d.machines?.machines ?? [] })

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setError(undefined)
    const added = await host.addMachine(link.trim())
    if (!added.ok) {
      setError(added.error)
      setSaving(false)
      return
    }
    const machine = originOf(link)
    let failed = false
    if (both && open && machine !== undefined) {
      // This computer's own link, handed to the other one, which saves it: its runs can come here too.
      const mine = await addDevice(host)
      const letIn = mine.ok ? await host.letMachineIn(machine, mine.value.url) : mine
      if (!letIn.ok) {
        failed = true
        setError(`Saved: your runs can go there. It could not be let in here: ${letIn.error}`)
      }
    }
    await Promise.all([d.reloadMachines(), d.reloadDoor()]).catch(() => {})
    setSaving(false)
    if (!failed) onClose()
  }

  if (giving)
    return (
      <InviteDialog
        title="Give it this computer's link"
        ask={() => addDevice(host)}
        scan="On the other computer, open Settings › Devices › Add device › I have a code, and paste it there."
        joined={joined}
        onCode={setCode}
        onClose={onClose}
      />
    )

  return (
    <Dialog open onOpenChange={next => !next && onClose()} title="Add computer">
      <form className="space-y-4" onSubmit={event => void save(event)}>
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>On the other computer, open Settings › Devices › Add device › Computer › Give it this computer's link, and paste that link here:</span>
          <Input autoFocus aria-label="The other computer's link" placeholder={server ? 'https://…' : 'http://studio.local:4201/…'} value={link} onChange={event => setLink(event.target.value)} />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={both && open} disabled={!open} onCheckedChange={checked => setBoth(checked === true)} aria-label="It can start runs on this computer too" />
          <span>
            It can start runs on this computer too
            <span className="block text-xs text-muted-foreground">{open ? 'Then runs go both ways.' : 'Turn on "On this Wi-Fi" first: then runs can go both ways.'}</span>
          </span>
        </label>
        {error !== undefined && <Problem>{error}</Problem>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">At the other computer instead?</span>
          <Button size="sm" type="button" variant="outline" disabled={!open} title={open ? undefined : 'Turn on "On this Wi-Fi" first.'} onClick={() => setGiving(true)}>
            <Ticket className="h-3.5 w-3.5" aria-hidden />
            Give it this computer's link
          </Button>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={saving || originOf(link) === undefined}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Connect
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
