import { useEffect, useState } from 'react'
import { Button, SettingsRow, SettingsSection, Switch, formatDateTime, formatRelative, useModuleHost, usePolled, type ModuleSettingsProps } from '@openagt/dashboard/module'
import { addDevice, loadStatus, removeDevice, setSwitch, type AddLink, type Answer, type DoorStatus } from './devices.js'
import { QrCode } from './QrCode.js'

// Settings → Devices: the phones and browsers that are in, and the one switch that lets them
// reach this computer on the Wi-Fi it is on. Read with `remote-access status`; the switch, a new
// device's code and a removal are the same command's `on`, `off`, `add` and `remove`.

/** What turning the switch on says first: the link is not locked, and what that means. */
export const WARNING =
  'The link between the phone and this computer is plain HTTP, with no lock. Someone else on the same Wi-Fi who listens can read what passes, and can then start agents on this computer. Use it on a Wi-Fi you trust, like the one at home, and turn it off on any other.'

const NOT_READ: Answer<DoorStatus> | undefined = undefined

export function DevicesSettings({ projects, everyMs = 5_000 }: ModuleSettingsProps & { /** How often the status is read again. */ everyMs?: number }) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const { value: read, reload } = usePolled<Answer<DoorStatus> | undefined>(() => loadStatus(host, projects), NOT_READ, everyMs, [key])
  // The answer of the last change, shown until the read made after it has landed: a read that was
  // already on its way when the change was made tells the state before it.
  const [changed, setChanged] = useState<DoorStatus | undefined>()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  // The code on the page, with the devices that were in when it was made.
  const [link, setLink] = useState<(AddLink & { before: string[] }) | undefined>()
  const [byNumber, setByNumber] = useState(false)

  const status = changed ?? (read?.ok ? read.value : undefined)

  // A code is good for five minutes: it leaves the page when its time is up, and when a device got in with it.
  const ids = status?.devices.map(device => device.id).join(',') ?? ''
  useEffect(() => {
    if (!link) return
    if (ids.split(',').some(id => id && !link.before.includes(id))) return setLink(undefined)
    const left = Date.parse(link.expires) - Date.now()
    const timer = setTimeout(() => setLink(undefined), Math.max(0, left))
    return () => clearTimeout(timer)
  }, [link, ids])

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
    setLink(undefined)
    void act(() => setSwitch(host, projects, on))
  }

  const add = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const answer = await addDevice(host, projects)
    if (answer.ok) {
      setLink({ ...answer.value, before: status?.devices.map(device => device.id) ?? [] })
      setByNumber(false)
    } else setError(answer.error)
    setBusy(false)
  }

  if (projects.length === 0) return null
  return (
    <SettingsSection title="Devices" description="Open OpenAgent on a phone or in another browser. A device gets in by scanning a code once, and stays in until it is removed here.">
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
      {status?.on && status.problem !== undefined && !busy && (
        <p role="alert" className="py-3 text-xs text-danger">
          {status.problem}
        </p>
      )}
      {status?.listening && (
        <div className="space-y-3 py-3">
          {link ? (
            <div className="space-y-2">
              <QrCode text={byNumber && link.numberUrl ? link.numberUrl : link.url} label="The code a new device scans" />
              <p className="text-xs text-muted-foreground">Scan it with the device's camera, on the same Wi-Fi as this computer. The code works once, for five minutes.</p>
              {link.numberUrl !== undefined && !byNumber && (
                <button type="button" className="text-xs underline" onClick={() => setByNumber(true)}>
                  Phone does not open it? Use the number.
                </button>
              )}
              <div>
                <Button size="sm" variant="outline" onClick={() => setLink(undefined)}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void add()}>
              Add device
            </Button>
          )}
        </div>
      )}
      {status !== undefined && status.devices.length > 0 && (
        <ul aria-label="Devices that are in" className="divide-y divide-border">
          {status.devices.map(device => (
            <li key={device.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm">{device.name}</p>
                <p className="text-xs text-muted-foreground" title={formatDateTime(device.seen ?? device.added)}>
                  {`Added ${formatRelative(device.added)}`}
                  {device.seen !== undefined ? `, last seen ${formatRelative(device.seen)}` : ''}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={busy} aria-label={`Remove ${device.name}`} onClick={() => void act(() => removeDevice(host, projects, device.id))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {read !== undefined && !read.ok && (
        <p role="alert" className="py-3 text-xs text-danger">{`The devices could not be read: ${read.error}`}</p>
      )}
      {error !== undefined && (
        <p role="alert" className="py-3 text-xs text-danger">
          {error}
        </p>
      )}
    </SettingsSection>
  )
}
