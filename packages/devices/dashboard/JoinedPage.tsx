import { useEffect, useState } from 'react'
import { Server } from 'lucide-react'
import { Button, ConfirmDialog, formatDateTime, formatRelative, usePolled } from '@openagt/dashboard/module'
import { idsOf, loadOther, otherLogin, readPersonThere, sharedForget, type Answer, type DeviceRow, type OtherLogin, type OtherRow } from './servers.js'
import type { JoinedItem, OtherItem } from './model.js'
import { ComputersThrough } from './ServerPage.js'
import { Head, LoginLine, Part, Problem, State, Tabs, hostOf } from './parts.js'
import type { Devices } from './use-devices.js'

// The page of a server this person is in at, set up from somewhere else: their own from another
// computer of theirs, or someone else's who invited them. On a server several people use, this
// person has an OpenAgent of their own there, as a user of their own, and their runs there use
// their own logins, which Settings › Accounts gives it. This page lists the person's devices,
// through the server's door with this computer's key there. What only the server's owner does
// from the computer that set it up (the install, an update, an invite) is not here.
//
// And the page of another person's computer, shared with everyone on a server: the logins this
// person's runs use there.

type Tab = 'overview' | 'devices'

export function JoinedPage({ d, item, onBack }: { d: Devices; item: JoinedItem; onBack: () => void }) {
  const { host } = d
  const { machine, person } = item
  const owner = person.owner
  const [tab, setTab] = useState<Tab>('overview')
  const [devices, setDevices] = useState<DeviceRow[] | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const here = d.shared.find(row => row.url === machine.url)
  const listed = devices ?? person.devices

  const act = async (change: () => Promise<Answer<unknown>>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    const answer = await change()
    if (!answer.ok) setError(answer.error)
    await d.reloadShared().catch(() => {})
    setBusy(false)
    return answer.ok
  }
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
                ? 'Its install, its updates and its invites are done from the computer that set it up, its logins in Settings › Accounts. From here, your phone and this computer reach it, and runs go there.'
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
      {tab === 'devices' && (
        <Part>
          <p className="text-sm">{`Your devices on ${item.name} (${listed.length})`}</p>
          <ul aria-label={`Your devices on ${item.name}`} className="space-y-2 text-xs">
            {listed.map(device => {
              const own = (here?.line !== undefined && idsOf(device).includes(here.line)) || (machine.device !== undefined && idsOf(device).includes(machine.device))
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
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Remove ${device.name} from ${item.name}`}
                      onClick={() =>
                        void act(async () => {
                          const removed = await host.removeMachineDevice(machine.id, device.id)
                          if (!removed.ok) return removed
                          const after = readPersonThere(removed.said)
                          if (after) setDevices(after.devices)
                          return { ok: true, value: undefined }
                        })
                      }
                    >
                      Remove
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </Part>
      )}
      {error !== undefined && <Problem>{error}</Problem>}
    </div>
  )
}

/** The words for one of this person's logins on another person's computer: a copy, one made there, or none yet. */
function otherWords(label: 'GitHub' | 'Claude', login: OtherLogin | undefined, name: string): string {
  if (login?.source === 'copied') return `${label}: copied from ${login.from ?? 'your server'}.`
  if (login?.source === 'made') return `${label}: made here.`
  return `${label}: not on ${name} yet.`
}

/**
 * Another person's computer, set up as a server and shared with everyone on a server this
 * computer's person is in at. This person has an OpenAgent of their own there, as a user of their
 * own, and their runs there use their own logins: copies from their OpenAgent on the server, made
 * the first time they start a run there. This page says which logins it has, and makes one here in
 * place of a copy: GitHub's copied from this computer, Claude's made in this computer's browser.
 * A login made here is no copy, and no copy from the server takes its place.
 */
export function OtherPage({ d, item, onBack }: { d: Devices; item: OtherItem; onBack: () => void }) {
  const { host, account, noLogin } = d
  const { machine, owner } = item
  const [working, setWorking] = useState(false)
  const pace = working ? 3_000 : 30_000
  const { value: read, reload } = usePolled<Answer<OtherRow[]> | undefined>(() => loadOther(host, [machine.url]), undefined, pace, [machine.url, pace], 'previous')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const row = read?.ok ? read.value.find(candidate => candidate.url === machine.url) : undefined
  const making = row?.making ?? { working: false }
  useEffect(() => setWorking(making.working), [making.working])
  const name = item.name
  // The server both computers are in at: where the copies come from.
  const server = machine.url.includes('/_devices/via/') ? hostOf(machine.url) : 'this server'

  const act = async (change: () => Promise<Answer<unknown>>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const answer = await change()
    if (!answer.ok) setError(answer.error)
    await reload().catch(() => {})
    setBusy(false)
  }
  return (
    <div>
      <Head icon={Server} name={name} badge={`${owner}'s`} facts={[machine.version !== undefined ? <State tone="good">Online</State> : <State tone="quiet">Offline</State>, `for everyone on ${server}`]} />
      <Part>
        <p className="text-xs text-muted-foreground">{`${owner}'s server, for everyone on ${server}. Your runs there use your own logins.`}</p>
      </Part>
      <Part title="Logins">
        {/* What a run from this computer needs first: from here, nothing is copied by itself. */}
        {read?.ok && (row?.github === undefined || row?.claude === undefined) && (
          <p className="mb-3 text-xs text-muted-foreground">{`Log them in here before your first run there. A run you start from your page on ${server} copies yours from there instead.`}</p>
        )}
        {row?.error !== undefined && <p className="text-xs text-muted-foreground">{`${name} did not say: ${row.error}`}</p>}
        {read !== undefined && !read.ok && <p className="text-xs text-muted-foreground">{`${name} did not say: ${read.error}`}</p>}
        <ul aria-label={`Your logins on ${name}`} className="space-y-3 text-xs">
          <LoginLine label="GitHub" words={otherWords('GitHub', row?.github, name)} said={undefined}>
            <Button size="sm" variant="outline" disabled={busy || account === undefined} aria-label={`Log in to GitHub on ${name} instead`} title={account !== undefined ? `Copies the login of ${account} from this computer to your own OpenAgent on ${name}. A copy from ${server} no longer takes its place.` : noLogin} onClick={() => void act(() => otherLogin(host, machine.url, 'github'))}>
              {row?.github === undefined ? 'Log in here' : 'Log in here instead'}
            </Button>
          </LoginLine>
          <LoginLine label="Claude" words={making.asking ? "Claude: say yes in the page this computer's browser opened." : making.working ? `Claude: one moment, ${name} is being told.` : otherWords('Claude', row?.claude, name)} said={making.working ? undefined : making.said}>
            <Button size="sm" variant="outline" disabled={busy || (making.working && making.asking !== true)} aria-label={`Log in to Claude on ${name} instead`} title={`Opens this computer's browser, where you say yes once. The login is made for your OpenAgent on ${name} alone and lasts a year. A copy from ${server} no longer takes its place.`} onClick={() => void act(() => otherLogin(host, machine.url, 'claude'))}>
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
          onClick={() => void d.removeMachine(machine.id).then(done => done && onBack())}
        >
          {`Remove ${name}`}
        </Button>
      </div>
      {error !== undefined && <Problem>{error}</Problem>}
    </div>
  )
}
