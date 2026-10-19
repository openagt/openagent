import { useEffect, useState } from 'react'
import { Laptop, Monitor, Plus, Smartphone, Tablet, UserRound } from 'lucide-react'
import { Button, InviteDialog, SettingsRow, SettingsSection, Switch, formatDateTime, formatRelative, useModuleHost, usePolled, type InviteCode } from '@openagt/dashboard/module'
import { addDevice, idsOf, loadMine, loadStatus, nameOwner, ownGithub, removeDevice, removeMine, removePerson, setSwitch, type Answer, type DeviceRow, type DoorStatus, type Mine } from './devices.js'

// Settings → Devices: the phones and browsers that are in, and the one switch that lets them
// reach this computer on the Wi-Fi it is on. Read with `remote-access status`; the switch, a new
// device's code and a removal are the same command's `on`, `off`, `add` and `remove`. On a server
// there is no switch: its door is open to every network, over HTTPS, and the section says where.
//
// Add device is always in sight, so what to do first is plain: with the switch off it says to turn
// it on. It opens a dialog that asks who the device is for, then shows the code, and says so once
// a device got in with it. Once the computer has persons, the devices are listed by person.

/** What turning the switch on says first: the link is not locked, and what that means. */
export const WARNING =
  'The link between the phone and this computer is plain HTTP, with no lock. Someone else on the same Wi-Fi who listens can read what passes, and can then start agents on this computer. Use it on a Wi-Fi you trust, like the one at home, and turn it off on any other.'

const NOT_READ: Answer<DoorStatus> | undefined = undefined

/** What a device is, by the name it gave as it got in: "iPhone, Safari". */
function DeviceIcon({ device }: { device: DeviceRow }) {
  const Icon = device.line ? Laptop : /iphone|android|phone/i.test(device.name) ? Smartphone : /ipad|tablet/i.test(device.name) ? Tablet : Monitor
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
}

const MINE_NOT_READ: Answer<Mine> | undefined = undefined

/**
 * Devices on the OpenAgent of one person on a computer several people use: the devices that are
 * theirs, as the computer's door lists them, each removable. Nothing more: only the computer's
 * owner invites, the door is the owner's, and the other persons' devices are theirs.
 */
function PersonDevices({ person, everyMs }: { person: string; everyMs: number }) {
  const { value: read, reload } = usePolled<Answer<Mine> | undefined>(() => loadMine(), MINE_NOT_READ, everyMs, [])
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
    <SettingsSection description={`This computer is shared, and you are on it as @${person}. Your devices are in until you remove them. A new device gets in with a code from the computer's owner.`}>
      {mine !== undefined && (
        <div className="space-y-1 py-3">
          <p className="text-sm">{devices.length > 0 ? `Your devices (${devices.length})` : 'Your devices'}</p>
          {devices.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
          <ul aria-label="Your devices" className="divide-y divide-border">
            {devices.map(device => (
              <li key={device.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <DeviceIcon device={device} />
                  <div className="min-w-0">
                    <p className="truncate text-sm">{device.name}</p>
                    <p className="text-xs text-muted-foreground" title={formatDateTime(device.seen ?? device.added)}>
                      {device.seen !== undefined ? `Last seen ${formatRelative(device.seen)}, added ${formatRelative(device.added)}` : `Added ${formatRelative(device.added)}`}
                    </p>
                    {device.line && <p className="text-xs text-muted-foreground">A computer of yours: your runs can be started on it from here. Remove it and it is no longer in "Run on".</p>}
                  </div>
                </div>
                <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${device.name}`} onClick={() => void remove(device.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {read !== undefined && !read.ok && (
        <p role="alert" className="py-3 text-xs text-danger">{`Your devices could not be read: ${read.error}`}</p>
      )}
      {error !== undefined && (
        <p role="alert" className="py-3 text-xs text-danger">
          {error}
        </p>
      )}
    </SettingsSection>
  )
}

export function DevicesSettings({ everyMs = 5_000 }: { /** How often the status is read again. */ everyMs?: number }) {
  const host = useModuleHost()
  const { value: read, reload } = usePolled<Answer<DoorStatus> | undefined>(() => loadStatus(host), NOT_READ, everyMs, [])
  // The answer of the last change, shown until the read made after it has landed: a read that was
  // already on its way when the change was made tells the state before it.
  const [changed, setChanged] = useState<DoorStatus | undefined>()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [adding, setAdding] = useState(false)
  // The code on the page, with the devices that were in when it was made; and who got in with it.
  const [waiting, setWaiting] = useState<string[] | undefined>()
  const [joined, setJoined] = useState<string | undefined>()

  const status = changed ?? (read?.ok ? read.value : undefined)

  // A device that got in while a code was on the page got in with it: the dialog says so, and the code is spent.
  // Every id under every row: a computer that gets in again is a new id under the row it had.
  const ids = status?.devices.flatMap(idsOf).join(',') ?? ''
  useEffect(() => {
    if (!waiting || !status) return
    const fresh = status.devices.find(device => idsOf(device).some(id => !waiting.includes(id)))
    if (!fresh) return
    setJoined(fresh.name)
    setWaiting(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, ids])

  const act = async (change: () => Promise<Answer<DoorStatus>>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const answer = await change()
    if (answer.ok) setChanged(answer.value)
    else setError(answer.error)
    await reload().catch(() => {})
    setChanged(undefined)
    setBusy(false)
  }

  const turn = (on: boolean): void => {
    setConfirming(false)
    setAdding(false)
    void act(() => setSwitch(host, on))
  }

  const onCode = (code: InviteCode | undefined): void => {
    setJoined(undefined)
    setWaiting(code ? (status?.devices.flatMap(idsOf) ?? []) : undefined)
  }

  // One person's own OpenAgent on a computer several people use: their devices are the door's, and only they are shown.
  if (status?.person !== undefined) return <PersonDevices person={status.person} everyMs={everyMs} />

  const devices = status?.devices ?? []
  const persons = status?.persons ?? []
  // The devices by person, the owner first; one list with no heading while nobody else is invited.
  const groups = persons.length ? persons.map(person => ({ person, devices: devices.filter(device => (device.person ?? persons[0]!.account) === person.account) })) : [{ person: undefined, devices }]
  const where = status?.https ? `https://${status.https.address.includes(':') ? `[${status.https.address}]` : status.https.address}` : undefined
  return (
    <SettingsSection description="Open OpenAgent on your phone or in another browser, or let another computer's OpenAgent send its runs here. A device gets in once with a code, and stays in until you remove it.">
      {where !== undefined ? (
        <SettingsRow label="Open on the internet" description={`This computer is a server. A device that is in opens OpenAgent at ${where} from anywhere, and sees and does what this computer's own browser does.`} control={null} />
      ) : (
        <SettingsRow
          label="Phone on Wi-Fi"
          description="Lets a device on the same Wi-Fi as this computer open OpenAgent. A device that is in sees and does what this computer's own browser does."
          control={
            <Switch
              aria-label="Phone on Wi-Fi"
              checked={status?.on ?? false}
              disabled={busy || !status}
              onCheckedChange={on => {
                if (on) setConfirming(true)
                else turn(false)
              }}
            />
          }
        />
      )}
      {confirming && (
        <div role="alertdialog" aria-label="Turn on Phone on Wi-Fi" className="space-y-3 py-3">
          <p className="text-sm">{WARNING}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => turn(true)}>
              Turn on
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {/* Not while a change is on its way: the door's process has not followed the switch yet. */}
      {(status?.on || status?.https) && status.problem !== undefined && !busy && (
        <p role="alert" className="py-3 text-xs text-danger">
          {status.problem}
        </p>
      )}
      {status !== undefined && (
        <div className="space-y-1 py-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm">{devices.length > 0 ? `Devices that are in (${devices.length})` : 'Devices that are in'}</p>
            <Button size="sm" variant="outline" disabled={busy || !status.listening} onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add device
            </Button>
          </div>
          {!status.listening && (
            <p className="text-xs text-muted-foreground">
              {where !== undefined ? 'The door is not open yet: a device can be added once it is.' : 'Turn on Phone on Wi-Fi first: a device gets in on the same Wi-Fi as this computer.'}
            </p>
          )}
          {devices.length === 0 && persons.length < 2 ? (
            status.listening && <p className="text-xs text-muted-foreground">None yet. Add device gives a code: scan it with your phone's camera.</p>
          ) : (
            groups.map(({ person, devices: theirs }) => (
              <div key={person?.account ?? ''} className={person !== undefined ? 'pt-2' : undefined}>
                {person !== undefined && (
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <p className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                      <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{person.owner ? `@${person.account}, the owner` : `@${person.account}`}</span>
                    </p>
                    {!person.owner && (
                      <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove @${person.account}`} onClick={() => void act(() => removePerson(host, person.account))}>
                        Remove person
                      </Button>
                    )}
                  </div>
                )}
                {person?.working && <p className="pt-1 text-xs text-muted-foreground">{`Making @${person.account}'s own user on this computer, with their own OpenAgent. This takes a minute or two.`}</p>}
                {person?.problem !== undefined && !person.working && (
                  <p role="alert" className="pt-1 text-xs text-danger">{`@${person.account}'s own user on this computer could not be made: ${person.problem.replace(/\.?$/, '.')} Add a device for them again to try again.`}</p>
                )}
                {person !== undefined && theirs.length === 0 && <p className="py-2 text-xs text-muted-foreground">No device yet.</p>}
                <ul aria-label={person !== undefined ? `Devices of @${person.account}` : 'Devices that are in'} className="divide-y divide-border">
                  {theirs.map(device => (
                    <li key={device.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <DeviceIcon device={device} />
                        <div className="min-w-0">
                          <p className="truncate text-sm">{device.name}</p>
                          <p className="text-xs text-muted-foreground" title={formatDateTime(device.seen ?? device.added)}>
                            {device.seen !== undefined ? `Last seen ${formatRelative(device.seen)}, added ${formatRelative(device.added)}` : `Added ${formatRelative(device.added)}`}
                          </p>
                          {device.line && <p className="text-xs text-muted-foreground">{`${device.person !== undefined && !person?.owner ? `A computer of @${device.person}` : 'A computer of yours'}: runs can be started on it from here. Remove it and it is no longer in "Run on".`}</p>}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${device.name}`} onClick={() => void act(() => removeDevice(host, device.id))}>
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
      {read !== undefined && !read.ok && (
        <p role="alert" className="py-3 text-xs text-danger">{`The devices could not be read: ${read.error}`}</p>
      )}
      {error !== undefined && (
        <p role="alert" className="py-3 text-xs text-danger">
          {error}
        </p>
      )}
      {adding && (
        <InviteDialog
          title="Add a device"
          ask={person => addDevice(host, person)}
          persons={{
            owner: persons.find(person => person.owner)?.account,
            whoAmI: () => ownGithub(host),
            nameOwner: async account => {
              const named = await nameOwner(host, account)
              // Read again, so the list shows the owner from here on.
              await reload().catch(() => {})
              return named.ok ? { ok: true } : named
            },
          }}
          scan={where !== undefined ? "Scan it with the device's camera: it opens OpenAgent here, from anywhere." : "Scan it with the device's camera, on the same Wi-Fi as this computer."}
          note="Another computer that runs OpenAgent? Paste the link there, in Settings › Machines › Add machine."
          joined={joined}
          onCode={onCode}
          onClose={() => {
            setAdding(false)
            setJoined(undefined)
          }}
        />
      )}
    </SettingsSection>
  )
}
