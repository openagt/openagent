import { useEffect, useState } from 'react'
import { Server } from 'lucide-react'
import { Button, ConfirmDialog, formatDateTime, formatRelative, usePolled } from '@openagt/dashboard/module'
import { idsOf, readPersonThere, type Answer, type DeviceRow } from './devices.js'
import { loadOther, otherLogin, sharedForget, type OtherLogin, type OtherRow } from './servers.js'
import { hasDoor, throughOf, type JoinedItem, type OtherItem } from './model.js'
import { ComputersThrough } from './ServerPage.js'
import { Head, LoginLine, Part, Problem, State, Tabs, hostOf, useChange } from './parts.js'
import type { Devices } from './use-devices.js'

// The page of a server this person is in at, set up from somewhere else: their own from another
// computer of theirs, or someone else's who invited them. On a server several people use, this
// person has an OpenAgent of their own there, as a user of their own, and their runs there use
// their own logins, which the Permissions page gives it. This page lists the person's devices,
// through the server's door with this computer's key there. What only the server's owner does
// from the computer that set it up (the install, an update, an invite) is not here.
//
// And the page of another person's computer: shared with this person on a server, or shared with
// this person at its own door, added here with a code the owner gave. The logins this person's
// runs use there, and their own devices there.

type Tab = 'overview' | 'devices'

export function JoinedPage({ d, item, onBack }: { d: Devices; item: JoinedItem; onBack: () => void }) {
  const { host } = d
  const { machine, person } = item
  const owner = person.owner
  const [tab, setTab] = useState<Tab>('overview')
  const { busy, setBusy, error, setError, act } = useChange(() => d.reloadShared())
  const here = d.shared.find(row => row.url === machine.url)

  const tabs: { id: Tab; title: string }[] = [{ id: 'overview', title: 'Overview' }, { id: 'devices', title: 'Your devices' }]

  return (
    <div>
      <Head
        icon={Server}
        name={item.name}
        badge="Server"
        facts={[machine.version !== undefined ? <State tone="good">Online</State> : <State tone="quiet">Does not answer right now</State>, hostOf(machine.url), machine.version !== undefined ? `OpenAgent ${machine.version}` : undefined]}
        rename={async name => {
          const renamed = await host.renameMachine(machine.id, name)
          await d.reloadMachines().catch(() => {})
          return renamed
        }}
      />
      <Tabs label={item.name} tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && (
        <>
          <Part>
            <p className="text-sm">{owner ? 'Yours, set up from another computer.' : person.person !== undefined ? `You are in as ${person.person}.` : 'You are in.'}</p>
            <p className="text-xs text-muted-foreground">
              {owner
                ? 'Its install, its updates and its invites are done from the computer that set it up, its logins on the Permissions page. From here, your phone and this computer reach it, and runs go there.'
                : 'Your runs there are yours: they use your own GitHub and Claude logins.'}
            </p>
            {here?.lineRefused && <p className="text-xs text-warning">{`${item.name} no longer lets this computer in for its line: turn on "From anywhere, through ${item.name}" under This computer to set it up again.`}</p>}
          </Part>
          <ComputersThrough host={host} machine={machine} busy={busy} everyMs={30_000} />
          <div className="pt-4">
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline" className="text-danger" disabled={busy} aria-label={`Remove ${item.name}`}>
                  Remove server
                </Button>
              }
              title={`Remove ${item.name}?`}
              body={owner ? 'Takes the server off this list, and this computer out of it. The server itself stays as it is.' : 'Takes the server off this list, and this computer out of it. Your user, your logins and your projects on the server stay until its owner removes you.'}
              confirmLabel="Remove"
              confirmBusyLabel="Removing…"
              onConfirm={async () => {
                const done = await act(async () => {
                  const forgotten = await sharedForget(host, machine.url)
                  if (!forgotten.ok) return forgotten
                  return (await d.removeMachine(machine.id)) ? { ok: true, value: undefined } : { ok: false, error: `${item.name} could not be taken off.` }
                })
                if (done) onBack()
              }}
            />
          </div>
        </>
      )}
      {tab === 'devices' && <DevicesThere d={d} machine={machine} name={item.name} devices={person.devices} line={here?.line} busy={busy} onBusy={setBusy} onError={setError} />}
      {error !== undefined && <Problem>{error}</Problem>}
    </div>
  )
}

/**
 * This person's own devices at a server or a shared computer, as its door lists them, each
 * removable there but this computer: taken out as a device, its page here would go on asking with
 * a key that opens nothing.
 */
function DevicesThere({ d, machine, name, devices, line, busy, onBusy, onError }: { d: Devices; machine: JoinedItem['machine']; name: string; devices: DeviceRow[]; /** The id this computer's line has there, when it keeps one. */ line: string | undefined; busy: boolean; onBusy: (busy: boolean) => void; onError: (error: string | undefined) => void }) {
  const { host } = d
  const [changed, setChanged] = useState<DeviceRow[] | undefined>()
  const listed = changed ?? devices
  const remove = async (device: DeviceRow): Promise<void> => {
    onBusy(true)
    onError(undefined)
    const removed = await host.removeMachineDevice(machine.id, device.id)
    if (!removed.ok) onError(removed.error)
    else {
      const after = readPersonThere(removed.said)
      if (after) setChanged(after.devices)
    }
    await d.reloadShared().catch(() => {})
    onBusy(false)
  }
  return (
    <Part>
      <p className="text-sm">{`Your devices on ${name} (${listed.length})`}</p>
      <ul aria-label={`Your devices on ${name}`} className="space-y-2 text-xs">
        {listed.map(device => {
          const own = (line !== undefined && idsOf(device).includes(line)) || (machine.device !== undefined && idsOf(device).includes(machine.device))
          return (
            <li key={device.id} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm">{device.name}</p>
                <p className="text-muted-foreground" title={formatDateTime(device.seen ?? device.added)}>
                  {`Added ${formatRelative(device.added)}`}
                  {device.seen !== undefined ? `, last seen ${formatRelative(device.seen)}` : ''}
                </p>
                {own && <p className="text-muted-foreground">This computer. To take it out, remove the server.</p>}
              </div>
              {!own && (
                <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${device.name} from ${name}`} onClick={() => void remove(device)}>
                  Remove
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </Part>
  )
}

/** The words for one of this person's logins on another person's computer: a copy, one made there, or none yet. */
function otherWords(label: 'GitHub' | 'Claude', login: OtherLogin | undefined, name: string): string {
  if (login?.source === 'copied') return `${label}: copied from ${login.from ?? 'your server'}.`
  if (login?.source === 'made') return `${label}: made here.`
  return `${label}: not on ${name} yet.`
}

/**
 * Another person's computer: set up as a server and shared with this person on a server both
 * are in at, or shared with this person at its own door, with a code its owner gave. This person has an OpenAgent of their own there, as a user of their own, and their runs
 * there use their own logins: copies from their OpenAgent on the server, made the first time they
 * start a run there, or made here. This page says which logins it has, and makes one here in
 * place of a copy: GitHub's copied from this computer, Claude's made in this computer's browser.
 * A login made here is no copy, and no copy from the server takes its place. At its own door, the
 * person's own devices there are listed too.
 */
export function OtherPage({ d, item, onBack }: { d: Devices; item: OtherItem; onBack: () => void }) {
  const { host, account, noLogin } = d
  const { machine, owner, person } = item
  const [tab, setTab] = useState<Tab>('overview')
  const [working, setWorking] = useState(false)
  const pace = working ? 3_000 : 30_000
  const { value: read, reload } = usePolled<Answer<OtherRow[]> | undefined>(() => loadOther(host, [machine.url]), undefined, pace, [machine.url, pace], 'previous')
  const { busy, setBusy, error, setError, act } = useChange(reload)
  const row = read?.ok ? read.value.find(candidate => candidate.url === machine.url) : undefined
  const making = row?.making ?? { working: false }
  useEffect(() => setWorking(making.working), [making.working])
  const name = item.name
  // Shared on a server both are in at, where copies come from; or shared with this person at its own door.
  const via = throughOf(machine) !== undefined
  const server = via ? hostOf(machine.url) : undefined
  const copies = via ? ` A copy from ${server} no longer takes its place.` : ''
  const here = d.shared.find(kept => kept.url === machine.url)
  const tabs: { id: Tab; title: string }[] = person ? [{ id: 'overview', title: 'Overview' }, { id: 'devices', title: 'Your devices' }] : [{ id: 'overview', title: 'Overview' }]
  return (
    <div>
      <Head icon={Server} name={name} badge={`${owner}'s`} facts={[machine.version !== undefined ? <State tone="good">Online</State> : <State tone="quiet">Offline</State>, via ? `shared with you on ${server}` : 'shared with you', person?.person !== undefined ? `you are ${person.person}` : undefined]} />
      {tabs.length > 1 && <Tabs label={name} tabs={tabs} value={tab} onChange={setTab} />}
      {tab === 'overview' && (
        <>
          <Part>
            <p className="text-xs text-muted-foreground">{via ? `${owner}'s server, shared with you on ${server}. Your runs there use your own logins.` : `${owner}'s computer, shared with you. A run there runs as you, in your own OpenAgent on it, with your own logins.`}</p>
          </Part>
          <Part title="Logins">
            {/* What a run from this computer needs first: from here, nothing is copied by itself. */}
            {read?.ok && (row?.github === undefined || row?.claude === undefined) && (
              <p className="mb-3 text-xs text-muted-foreground">{via ? `Log them in here before your first run there. A run you start from your page on ${server} copies yours from there instead.` : 'Log them in here before your first run there.'}</p>
            )}
            {row?.error !== undefined && <p className="text-xs text-muted-foreground">{`${name} did not say: ${row.error}`}</p>}
            {read !== undefined && !read.ok && <p className="text-xs text-muted-foreground">{`${name} did not say: ${read.error}`}</p>}
            <ul aria-label={`Your logins on ${name}`} className="space-y-3 text-xs">
              <LoginLine label="GitHub" words={otherWords('GitHub', row?.github, name)} said={undefined}>
                <Button size="sm" variant="outline" disabled={busy || account === undefined} aria-label={`Log in to GitHub on ${name} instead`} title={account !== undefined ? `Copies the login of ${account} from this computer to your own OpenAgent on ${name}.${copies}` : noLogin} onClick={() => void act(() => otherLogin(host, machine.url, 'github'))}>
                  {row?.github === undefined ? 'Log in here' : 'Log in here instead'}
                </Button>
              </LoginLine>
              <LoginLine label="Claude" words={making.asking ? "Claude: say yes in the page this computer's browser opened." : making.working ? `Claude: one moment, ${name} is being told.` : otherWords('Claude', row?.claude, name)} said={making.working ? undefined : making.said}>
                <Button size="sm" variant="outline" disabled={busy || (making.working && making.asking !== true)} aria-label={`Log in to Claude on ${name} instead`} title={`Opens this computer's browser, where you say yes once. The login is made for your OpenAgent on ${name} alone and lasts a year.${copies}`} onClick={() => void act(() => otherLogin(host, machine.url, 'claude'))}>
                  {making.asking ? 'Start over' : row?.claude === undefined ? 'Log in here' : 'Log in here instead'}
                </Button>
              </LoginLine>
            </ul>
          </Part>
          <div className="pt-4">
            <Button
              size="sm"
              variant="outline"
              className="text-danger"
              disabled={busy}
              aria-label={`Remove ${name}`}
              onClick={() =>
                void (async () => {
                  // A line this computer keeps there as this person goes with it.
                  if (hasDoor(machine)) await sharedForget(host, machine.url)
                  if (await d.removeMachine(machine.id)) onBack()
                })()
              }
            >
              {`Remove ${name}`}
            </Button>
          </div>
        </>
      )}
      {tab === 'devices' && person && <DevicesThere d={d} machine={machine} name={name} devices={person.devices} line={here?.line} busy={busy} onBusy={setBusy} onError={setError} />}
      {error !== undefined && <Problem>{error}</Problem>}
    </div>
  )
}
