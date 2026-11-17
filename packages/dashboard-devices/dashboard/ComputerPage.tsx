import { useState } from 'react'
import { Monitor, Server } from 'lucide-react'
import { Button, ConfirmDialog, Input, SettingsRow, Switch, useOpenAgentDown } from '@openagt/dashboard/module'
import { addDevice, removeDevice } from './devices.js'
import { hasDoor, reachedAt, type ComputerItem } from './model.js'
import { ComputersThrough } from './ServerPage.js'
import { Head, Part, Problem, Removal, State, useChange } from './parts.js'
import type { Devices } from './use-devices.js'

// A computer's own page in Settings › Devices: whether this computer's runs go there, whether it
// starts runs here, and who can use it. The two ways are two things OpenAgent keeps apart: a
// machine saved here, and a device in at this computer's door; the page shows them as one computer.

export function ComputerPage({ d, item, onBack, onSetUp }: { d: Devices; item: ComputerItem; onBack: () => void; /** Set this computer up as a server. */ onSetUp: () => void }) {
  const down = useOpenAgentDown()
  const { host } = d
  const { machine, door, through } = item
  const status = d.door?.ok ? d.door.value : undefined
  const { busy, error, act } = useChange(() => Promise.all([d.reloadMachines(), d.reloadDoor()]))
  const [pasting, setPasting] = useState(false)
  const [link, setLink] = useState('')

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
        facts={[state, where, runs, machine?.version !== undefined ? `OpenAgent ${machine.version}` : undefined]}
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
          <p className="text-sm text-muted-foreground">Your computer. It keeps a line open to this server. Removed here, it is back when it calls again: to take it out, remove its device from the people's devices.</p>
        </Part>
      ) : (
      <Part title="Runs">
        <SettingsRow
          label={`Your runs can go to ${item.name}`}
          description={`Pick it under "Run on". They use ${item.name}'s logins.`}
          control={
            <Switch
              aria-label={`Your runs can go to ${item.name}`}
              checked={machine !== undefined}
              disabled={busy || down}
              onCheckedChange={on => {
                if (on) setPasting(true)
                else if (machine) void act(async () => ((await d.removeMachine(machine.id)) ? { ok: true } : { ok: false, error: `${item.name} could not be taken off.` }))
              }}
            />
          }
        />
        {pasting && !machine && (
          <form
            className="flex flex-wrap items-end gap-2 pl-0"
            onSubmit={event => {
              event.preventDefault()
              void act(() => host.addMachine(link.trim(), item.name)).then(done => done && setPasting(false))
            }}
          >
            <label className="min-w-60 flex-1 space-y-1 text-xs text-muted-foreground">
              <span>{`On ${item.name}, open Settings › Devices and press Add a phone, or Add device › Phone or tablet. Under the code it shows, press Copy the link, and paste that link here:`}</span>
              <Input name="computer-link" autoFocus aria-label={`${item.name}'s link`} value={link} onChange={event => setLink(event.target.value)} />
            </label>
            <Button type="submit" disabled={busy || !link.trim() || down}>
              Save
            </Button>
          </form>
        )}
        {/* A computer reached through a server is reached from that server: its runs come here that way. */}
        {!through && (
          <SettingsRow
            label={`${item.name} can start runs here`}
            description={door ? "They use this computer's logins." : machine ? `Off. Turn it on: ${item.name} is told this computer's link, and saves it.` : "They use this computer's logins."}
            control={
              <Switch aria-label={`${item.name} can start runs here`} checked={door !== undefined} disabled={busy || down} onCheckedChange={on => void act(on ? letIn : removeHere)} />
            }
          />
        )}
      </Part>
      )}
      {machine && hasDoor(machine) && <ComputersThrough host={host} machine={machine} busy={busy} everyMs={30_000} />}
      {!through && !item.line && (
        <Part title="Who can use it">
          {/* The fact first; sharing it beside the press that does it. */}
          <p className="text-sm">{`Only you: on a personal computer, someone else's runs would run as you, with your logins.`}</p>
          <SettingsRow
            label="Share it"
            description="Set it up as a server: each person then gets a user of their own on it. Linux for now."
            control={
              <Button variant="secondary" onClick={onSetUp}>
                <Server className="size-4" aria-hidden />
                Set it up as a server
              </Button>
            }
          />
        </Part>
      )}
      <Removal label="Remove computer" said="Both computers forget each other. Nothing is deleted.">
        <ConfirmDialog
          trigger={
            <Button variant="secondary" className="text-danger" disabled={busy} aria-label={`Remove ${item.name}`}>
              Remove
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
      </Removal>
      {error !== undefined && <Problem>{error}</Problem>}
    </div>
  )
}
