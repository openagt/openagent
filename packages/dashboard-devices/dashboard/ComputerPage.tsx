import { useState } from 'react'
import { Monitor, Server } from 'lucide-react'
import { Button, ConfirmDialog, Input, Switch } from '@openagt/dashboard/module'
import { addDevice, removeDevice } from './devices.js'
import { hasDoor, reachedAt, type ComputerItem } from './model.js'
import { ComputersThrough } from './ServerPage.js'
import { Head, Part, Problem, State, SwitchLine } from './parts.js'
import type { Devices } from './use-devices.js'

// A computer's own page in Settings › Devices: whether this computer's runs go there, whether it
// starts runs here, and who can use it. The two ways are two things OpenAgent keeps apart: a
// machine saved here, and a device in at this computer's door; the page shows them as one computer.

export function ComputerPage({ d, item, onBack, onSetUp }: { d: Devices; item: ComputerItem; onBack: () => void; /** Set this computer up as a server: the setup dialog. */ onSetUp: () => void }) {
  const { host } = d
  const { machine, door, through } = item
  const status = d.door?.ok ? d.door.value : undefined
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [pasting, setPasting] = useState(false)
  const [link, setLink] = useState('')

  const act = async (change: () => Promise<{ ok: true } | { ok: false; error: string }>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    const answer = await change()
    if (!answer.ok) setError(answer.error)
    await Promise.all([d.reloadMachines(), d.reloadDoor()]).catch(() => {})
    setBusy(false)
    return answer.ok
  }
  const removeHere = (): Promise<{ ok: true } | { ok: false; error: string }> => (door ? d.changeDoor(() => removeDevice(host, door.id)).then(answer => (answer.ok ? { ok: true as const } : answer)) : Promise.resolve({ ok: true as const }))
  const letIn = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!machine) return { ok: false, error: 'Save it here first.' }
    if (!status?.listening) return { ok: false, error: 'Turn on "On this Wi-Fi" first: the other computer gets in here through it.' }
    const mine = await addDevice(host)
    return mine.ok ? host.letMachineIn(machine.id, mine.value.url) : mine
  }

  const where = item.line ? 'keeps a line open here' : through ? `through ${through.label}` : reachedAt(machine)
  const runs = item.line ? undefined : machine && door ? 'runs go both ways' : machine ? 'your runs go there' : 'starts runs here'
  const state = machine ? (machine.version !== undefined ? <State tone="good">Online</State> : <State tone="quiet">Offline</State>) : undefined

  return (
    <div>
      <Head
        icon={Monitor}
        name={item.name}
        facts={[state, 'Computer', where, runs, machine?.version !== undefined ? `OpenAgent ${machine.version}` : undefined]}
        // Its name is its own: renamed on it, and read from it everywhere. One that only got in here is renamed on it.
        {...(machine
          ? {
              rename: async (name: string) => {
                const renamed = await host.renameMachine(machine.id, name)
                await Promise.all([d.reloadMachines(), d.reloadDoor()]).catch(() => {})
                return renamed
              },
            }
          : {})}
      />
      {item.line ? (
        <Part>
          <p className="text-xs text-muted-foreground">Your computer. It keeps a line open to this server. Removed here, it is back when it calls again: to take it out, remove its device from the people's devices.</p>
        </Part>
      ) : (
      <Part title="Runs">
        <SwitchLine label={`Your runs can go to ${item.name}`} words={`Pick it under "Run on". They use ${item.name}'s logins.`}>
          <Switch
            aria-label={`Your runs can go to ${item.name}`}
            checked={machine !== undefined}
            disabled={busy}
            onCheckedChange={on => {
              if (on) setPasting(true)
              else if (machine) void act(async () => ((await d.removeMachine(machine.id)) ? { ok: true } : { ok: false, error: `${item.name} could not be taken off.` }))
            }}
          />
        </SwitchLine>
        {pasting && !machine && (
          <form
            className="flex flex-wrap items-end gap-2 pl-0"
            onSubmit={event => {
              event.preventDefault()
              void act(() => host.addMachine(link.trim(), item.name)).then(done => done && setPasting(false))
            }}
          >
            <label className="min-w-60 flex-1 space-y-1 text-xs text-muted-foreground">
              <span>{`On ${item.name}, open Settings › Devices › Add device › Computer › Give it this computer's link, and paste that link here:`}</span>
              <Input autoFocus aria-label={`${item.name}'s link`} value={link} onChange={event => setLink(event.target.value)} />
            </label>
            <Button size="sm" type="submit" disabled={busy || !link.trim()}>
              Save
            </Button>
          </form>
        )}
        {/* A computer reached through a server is reached from that server: its runs come here that way. */}
        {!through && (
          <SwitchLine label={`${item.name} can start runs here`} words={door ? "They use this computer's logins." : machine ? `Off. Turn it on: ${item.name} is told this computer's link, and saves it.` : "They use this computer's logins."}>
            <Switch aria-label={`${item.name} can start runs here`} checked={door !== undefined} disabled={busy} onCheckedChange={on => void act(on ? letIn : removeHere)} />
          </SwitchLine>
        )}
      </Part>
      )}
      {machine && hasDoor(machine) && <ComputersThrough host={host} machine={machine} busy={busy} everyMs={30_000} />}
      {!through && !item.line && (
        <Part title="Who can use it">
          <p className="text-sm">Only you.</p>
          <p className="text-xs text-muted-foreground">{`Other people cannot start runs on ${item.name}: on a personal computer they would run as you, with your logins. To share it, set it up as a server: each person then gets a user of their own on it. Linux for now.`}</p>
          <Button size="sm" variant="outline" onClick={onSetUp}>
            <Server className="h-3.5 w-3.5" aria-hidden />
            Set it up as a server
          </Button>
        </Part>
      )}
      <div className="space-y-1 pt-4">
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="outline" className="text-danger" disabled={busy}>
              {`Remove ${item.name}`}
            </Button>
          }
          title={`Remove ${item.name}?`}
          body="Both computers forget each other. Nothing is deleted."
          confirmLabel="Remove"
          confirmBusyLabel="Removing…"
          onConfirm={async () => {
            const done = await act(async () => {
              if (machine && !(await d.removeMachine(machine.id))) return { ok: false, error: `${item.name} could not be taken off.` }
              return removeHere()
            })
            if (done) onBack()
          }}
        />
        <p className="text-xs text-muted-foreground">Both computers forget each other. Nothing is deleted.</p>
      </div>
      {error !== undefined && <Problem>{error}</Problem>}
    </div>
  )
}
