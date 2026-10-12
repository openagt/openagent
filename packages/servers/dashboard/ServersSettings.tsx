import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Checkbox, Input, QrCode, SettingsSection, useModuleHost, usePolled, type ModuleMachines } from '@openagt/dashboard/module'
import { askLink, connect, forget, loadServers, login, logout, markAdded, ownGithub, type Answer, type DoorLink, type OwnGithub, type ServerRow, type ServersRead, type StepState } from './servers.js'

// Settings → Servers: "Connect your VPS". A person gives a server's address and a user name, and
// OpenAgent installs itself there over SSH. The install is the `servers` command's own process;
// the section reads how far it is with `servers status` and lists its steps. Once the steps are
// done the section asks the server's door for a link and saves the server among OpenAgent's
// machines with it, as a person would by pasting the link under Machines.
//
// An installed server lists its two logins. GitHub's is this computer's own, copied when the
// person ticks it or presses for it, or one the server gets for itself: GitHub gives the server a
// short code, the row shows it, and the person types it at GitHub. Claude's is made new for the
// server: a press opens this computer's browser, and the person says yes there. Whatever goes to
// the server goes over SSH, from the command's own process: no login ever comes to this page.
//
// An installed server also gives a code for a phone or a browser: a server has no screen to press
// "Add device" on, so this computer asks the server's door for the link over SSH, and the row
// shows it as the Devices section does, as a QR code and a link.

const NOT_READ: Answer<ServersRead> | undefined = undefined
/** How long a door's code is good for. */
const CODE_MS = 5 * 60_000
const NO_MACHINES: ModuleMachines | undefined = undefined
const NOT_ASKED: Answer<OwnGithub> | undefined = undefined

/** A day, as a person reads it. */
const day = (iso: string | undefined): string => (iso === undefined ? '' : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))

/** One login's line on a server's row: what is there, what a person can do about it, and why the last try failed. */
function LoginLine({ label, words, said, children }: { label: string; words: string; said: string | undefined; children: ReactNode }) {
  return (
    <li aria-label={label} className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{words}</span>
        <div className="flex gap-2">{children}</div>
      </div>
      {said !== undefined && (
        <pre role="alert" className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 font-mono text-foreground">
          {said}
        </pre>
      )}
    </li>
  )
}

const MARK: Record<StepState, string> = { waiting: '○', running: '…', done: '✓', failed: '✕' }
const STATE_WORD: Record<StepState, string> = { waiting: 'not started', running: 'running', done: 'done', failed: 'failed' }

const without = (reasons: Record<string, string>, address: string): Record<string, string> => Object.fromEntries(Object.entries(reasons).filter(([at]) => at !== address))

/** Whether version `a` is older than `b`, by their three numbers; false when either is not three numbers. */
export function olderThan(a: string, b: string): boolean {
  const numbers = (version: string): number[] | undefined => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
    return match ? match.slice(1).map(Number) : undefined
  }
  const [x, y] = [numbers(a), numbers(b)]
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]!
  return false
}

export function ServersSettings({ everyMs = 3_000 }: { /** How often the installs are read again. */ everyMs?: number }) {
  const host = useModuleHost()
  const { value: read, reload } = usePolled<Answer<ServersRead> | undefined>(() => loadServers(host), NOT_READ, everyMs, [])
  // What this computer last said it is. A server is connected from a person's own computer: on a
  // server's own page there is no such section, and a read that fails later does not bring it back.
  const isServer = useRef<boolean | undefined>(undefined)
  if (read?.ok) isServer.current = read.value.isServer
  // Nothing shows until this computer said which it is, so the section never shows on a server for a moment.
  if (read === undefined || isServer.current === true) return null
  return <Servers read={read} reload={reload} everyMs={everyMs} />
}

/** The section itself, on a person's own computer: nothing of it runs on a server. */
function Servers({ read, reload, everyMs }: { read: Answer<ServersRead>; reload: () => Promise<unknown>; everyMs: number }) {
  const host = useModuleHost()
  const { value: known, reload: reloadMachines } = usePolled<ModuleMachines | undefined>(() => host.machines(), NO_MACHINES, Math.max(everyMs, 10_000), [])
  // Whose GitHub login a copy would be: asked of this computer's own gh, which asks GitHub, so not often.
  const { value: own } = usePolled<Answer<OwnGithub> | undefined>(() => ownGithub(host), NOT_ASKED, Math.max(everyMs, 5 * 60_000), [])
  const account = own?.ok && 'account' in own.value ? own.value.account : undefined
  /** Why there is no GitHub login to copy, once this computer said so. */
  const noLogin = own === undefined || account !== undefined ? undefined : own.ok ? ('problem' in own.value ? own.value.problem : undefined) : own.error
  const [address, setAddress] = useState('')
  const [user, setUser] = useState('root')
  const [copy, setCopy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  // Why a server whose install ended is not among the machines, by its address.
  const [notAdded, setNotAdded] = useState<Record<string, string>>({})
  const adding = useRef(new Set<string>())
  // The code on the page, and the server whose door made it.
  const [code, setCode] = useState<(DoorLink & { address: string }) | undefined>()

  const servers = read.ok ? read.value.servers : []
  const inMachines = (server: ServerRow, among = known) => among?.machines.find(machine => machine.url === server.url)
  const installed = (server: ServerRow): boolean => !server.working && server.steps.every(step => step.state === 'done')

  const act = async (change: () => Promise<Answer<unknown>>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    const answer = await change()
    if (!answer.ok) setError(answer.error)
    await reload().catch(() => {})
    setBusy(false)
    return answer.ok
  }

  const install = async (at: string, as: string, github = false): Promise<boolean> => {
    if (!known || known.version === 'unknown') {
      setError('This computer could not say which OpenAgent it runs.')
      return false
    }
    setNotAdded(reasons => without(reasons, at))
    return act(() => connect(host, at, as, known.version, github))
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
      // Read now, not as the page last saw them: the machines change under Machines, too.
      if (inMachines(server, await host.machines())?.version === undefined) {
        const link = await askLink(host, server.address)
        const added = link.ok ? await host.addMachine(link.value.url, server.address) : link
        if (!added.ok) return stopped(added.error)
      }
      const told = await markAdded(host, server.address)
      if (!told.ok) return stopped(told.error)
      await Promise.all([reload(), reloadMachines()]).catch(() => {})
    } catch (err) {
      // Told, so the page does not try by itself again at its next look.
      stopped(err instanceof Error ? err.message : String(err))
    } finally {
      adding.current.delete(server.address)
    }
  }

  // A server whose install just ended is added by itself, once: a failure is told, and tried again on a press.
  useEffect(() => {
    if (!known) return
    for (const server of servers) if (server.adding && installed(server) && notAdded[server.address] === undefined) void addToMachines(server)
  })

  // A code is good for five minutes: it leaves the page when its time is up.
  useEffect(() => {
    if (!code) return
    // Never longer than a code lives, whatever the server said its time is.
    const timer = setTimeout(() => setCode(undefined), Math.min(CODE_MS, Math.max(0, Date.parse(code.expires) - Date.now())))
    return () => clearTimeout(timer)
  }, [code])

  /** Ask the server's door for a code a phone or a browser gets in with, and show it. */
  const addDevice = async (server: ServerRow): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setCode(undefined)
    const link = await askLink(host, server.address)
    if (link.ok) setCode({ ...link.value, address: server.address })
    else setError(link.error)
    setBusy(false)
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!address.trim() || !user.trim()) return
    // The server is in the list below from here on: the field is free for the next one.
    void install(address.trim(), user.trim(), copy && account !== undefined).then(started => started && setAddress(''))
  }

  return (
    <SettingsSection
      title="Servers"
      description="Connect your VPS: give its address and a user name, and OpenAgent installs itself there over SSH, with this computer's own SSH keys. The server then runs OpenAgent by itself, and is one of your machines."
    >
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 py-3">
        <label className="min-w-40 flex-1 space-y-1 text-xs text-muted-foreground">
          <span>The server's address</span>
          <Input aria-label="The server's address" placeholder="203.0.113.5" value={address} onChange={event => setAddress(event.target.value)} />
        </label>
        <label className="w-32 space-y-1 text-xs text-muted-foreground">
          <span>User name</span>
          <Input aria-label="User name" value={user} onChange={event => setUser(event.target.value)} />
        </label>
        {/* Not before this computer has said which OpenAgent it runs: that is the one the server gets. */}
        <Button size="sm" type="submit" disabled={busy || !known || !address.trim() || !user.trim()}>
          Connect
        </Button>
      </form>
      <div className="space-y-2 pb-3">
        <label className="flex items-start gap-2 text-xs">
          <Checkbox checked={copy && account !== undefined} onCheckedChange={checked => setCopy(checked === true)} disabled={busy || account === undefined} className="mt-0.5" aria-label="Copy my GitHub login to the server" />
          <span>
            {account !== undefined ? `Copy my GitHub login (${account}) to the server.` : 'Copy my GitHub login to the server.'}{' '}
            <span className="text-muted-foreground">
              {noLogin ?? "It can do there all it can do here, and every agent that runs on the server works with it. It goes there at the install's end, to a server met for the first time too, whose key is taken as it is."}
            </span>
          </span>
        </label>
        <p className="text-xs text-muted-foreground">
          The user is root, or one that becomes root without a password. It is only used to install, to update and to give the server its logins: what runs on the server afterwards runs as a user of its own, openagent.
        </p>
      </div>
      {servers.length > 0 && (
        <ul aria-label="Servers" className="divide-y divide-border">
          {servers.map(server => {
            const machine = inMachines(server)
            const failed = !server.working && server.steps.some(step => step.state === 'failed')
            const behind = machine?.version !== undefined && known !== undefined && olderThan(machine.version, known.version)
            // A step this computer's OpenAgent brings and the server's install never ran: the same press as an update runs it.
            const unfinished = !server.working && !failed && server.steps.some(step => step.state === 'waiting')
            const reason = notAdded[server.address]
            const { github, claude } = server.logins
            return (
              <li key={server.address} aria-label={server.address} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{server.address}</p>
                    <p className="text-xs text-muted-foreground">
                      {server.working
                        ? 'OpenAgent is being installed.'
                        : machine?.version !== undefined
                          ? behind
                            ? `OpenAgent ${machine.version}: behind this computer, which runs ${known!.version}.`
                            : `OpenAgent ${machine.version}.`
                          : machine
                            ? 'Does not answer right now.'
                            : installed(server) && !server.adding
                              ? 'Installed, and not among your machines.'
                              : `Logs in as ${server.user}.`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {(behind || unfinished) && !server.working && !failed && (
                      <Button size="sm" disabled={busy} aria-label={`Update ${server.address}`} onClick={() => void install(server.address, server.user)}>
                        Update
                      </Button>
                    )}
                    {failed && (
                      <Button size="sm" disabled={busy} aria-label={`Try ${server.address} again`} onClick={() => void install(server.address, server.user, github.wanted === true)}>
                        Try again
                      </Button>
                    )}
                    {installed(server) && machine?.version === undefined && (reason !== undefined || !server.adding) && (
                      <Button size="sm" variant="outline" disabled={busy} aria-label={`Add ${server.address} to Machines`} onClick={() => void addToMachines(server)}>
                        {machine ? 'Add again' : 'Add to Machines'}
                      </Button>
                    )}
                    {installed(server) && (
                      <Button size="sm" variant="outline" disabled={busy} aria-label={`Add a device to ${server.address}`} onClick={() => void addDevice(server)}>
                        Add device
                      </Button>
                    )}
                    {!server.working && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={`Remove ${server.address}`}
                        title="Takes the server off this list. Nothing is changed on the server: its logins stay there until you remove them."
                        onClick={() => void act(() => forget(host, server.address))}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                {code?.address === server.address && (
                  <div className="space-y-2">
                    <QrCode text={code.url} label={`The code a new device scans to get into ${server.address}`} />
                    <p className="text-xs text-muted-foreground">
                      Scan it with the device's camera: it opens OpenAgent on the server, from anywhere. The code works once, for five minutes.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      {/* The code is spent by the tab it opens: it leaves the page with the press. */}
                      <a href={code.url} target="_blank" rel="noreferrer" className="text-xs underline" onClick={() => setCode(undefined)}>
                        Let this browser in instead
                      </a>
                      <Button size="sm" variant="outline" onClick={() => setCode(undefined)}>
                        Done
                      </Button>
                    </div>
                  </div>
                )}
                <ol aria-label={`The install on ${server.address}`} className="space-y-1 text-xs">
                  {server.steps.map(step => (
                    <li key={step.id} aria-label={`${step.label}: ${STATE_WORD[step.state]}`}>
                      <span className={step.state === 'failed' ? 'text-danger' : step.state === 'waiting' ? 'text-muted-foreground' : undefined}>
                        <span aria-hidden className="inline-block w-4">
                          {MARK[step.state]}
                        </span>
                        {step.label}
                      </span>
                      {step.id === 'login' && step.state === 'done' && server.fingerprint !== undefined && (
                        <span className="ml-2 font-mono text-muted-foreground">{`The server's key: ${server.fingerprint}`}</span>
                      )}
                      {step.said !== undefined && step.state === 'failed' && (
                        <pre role="alert" className="mt-1 ml-4 overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 font-mono text-foreground">
                          {step.said}
                        </pre>
                      )}
                    </li>
                  ))}
                  {server.logins.github.working && (
                    <li aria-label="Your GitHub login: not copied yet" className="text-muted-foreground">
                      <span aria-hidden className="inline-block w-4">
                        {MARK[server.steps.every(step => step.state === 'done') ? 'running' : 'waiting']}
                      </span>
                      Your GitHub login
                    </li>
                  )}
                  {installed(server) && (
                    <li aria-label={`Among your machines: ${machine ? 'done' : reason !== undefined ? 'failed' : server.adding ? 'running' : 'not started'}`}>
                      <span className={machine ? undefined : reason !== undefined ? 'text-danger' : 'text-muted-foreground'}>
                        <span aria-hidden className="inline-block w-4">
                          {MARK[machine ? 'done' : reason !== undefined ? 'failed' : server.adding ? 'running' : 'waiting']}
                        </span>
                        Among your machines
                      </span>
                      {reason !== undefined && !machine && (
                        <pre role="alert" className="mt-1 ml-4 overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 font-mono text-foreground">
                          {reason}
                        </pre>
                      )}
                    </li>
                  )}
                </ol>
                {installed(server) && (
                  <ul aria-label={`The logins on ${server.address}`} className="space-y-2 border-t border-border pt-2 text-xs">
                    <LoginLine
                      label="GitHub"
                      words={
                        github.asking && github.code !== undefined
                          ? `GitHub: type the code ${github.code} at github.com/login/device, and say yes there.`
                          : github.working
                          ? 'GitHub: one moment, the server is being told.'
                          : github.there
                            ? `GitHub: logged in as ${github.account ?? 'you'} since ${day(github.since)}.`
                            : github.said !== undefined
                              ? 'GitHub: the last try did not go through.'
                              : 'GitHub: no login on the server.'
                      }
                      said={github.working ? undefined : github.said}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || github.working || account === undefined}
                        aria-label={`Copy my GitHub login to ${server.address}`}
                        title={account !== undefined ? `Copies the login of ${account} from this computer to the server, over SSH.` : noLogin}
                        onClick={() => void act(() => login(host, server.address, 'github'))}
                      >
                        {github.there ? 'Copy again' : 'Copy my login'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || (github.working && github.asking !== true)}
                        aria-label={`Log in to GitHub for ${server.address}`}
                        title="The server asks GitHub for a login of its own. GitHub gives a short code: you type it at github.com/login/device and say yes there. This computer's own GitHub login is not touched, and the login the server had is replaced."
                        onClick={() => void act(() => login(host, server.address, 'github', true))}
                      >
                        {github.asking ? 'Start over' : 'Log in to GitHub'}
                      </Button>
                      {github.asking && github.code !== undefined && (
                        <a href="https://github.com/login/device" target="_blank" rel="noreferrer" className="self-center underline">
                          Open GitHub
                        </a>
                      )}
                      {/* After a try that failed too: what it left on the server is not always known here. */}
                      {(github.there || github.said !== undefined) && !github.working && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Remove the GitHub login from ${server.address}`}
                          title="Deletes the login on the server. The login itself is not ended by this: a copied one is this computer's own and stays good. To end one everywhere, take it back on github.com."
                          onClick={() => void act(() => logout(host, server.address, 'github'))}
                        >
                          Remove
                        </Button>
                      )}
                    </LoginLine>
                    <LoginLine
                      label="Claude"
                      words={
                        claude.asking
                          ? "Claude: say yes in the page this computer's browser opened."
                          : claude.working
                            ? 'Claude: one moment, the server is being told.'
                            : claude.there
                              ? `Claude: logged in since ${day(claude.since)}, good until about ${day(claude.ends)}.`
                              : claude.said !== undefined
                                ? 'Claude: the last try did not go through.'
                                : 'Claude: not logged in on the server.'
                      }
                      said={claude.working ? undefined : claude.said}
                    >
                      <Button
                        size="sm"
                        variant={claude.there || claude.working ? 'outline' : 'default'}
                        disabled={busy || (claude.working && claude.asking !== true)}
                        aria-label={`Log in to Claude for ${server.address}`}
                        title="Opens this computer's browser, where you say yes once. The login is made for this server alone and lasts a year; this computer's own Claude login is not touched."
                        onClick={() => void act(() => login(host, server.address, 'claude'))}
                      >
                        {claude.asking ? 'Start over' : claude.there ? 'Log in again' : 'Log in to Claude'}
                      </Button>
                      {(claude.there || claude.said !== undefined) && !claude.working && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Remove the Claude login from ${server.address}`}
                          title="Deletes the login on the server and starts OpenAgent there again without it. An agent at work there keeps it until it ends. The login itself stays good until its year is over."
                          onClick={() => void act(() => logout(host, server.address, 'claude'))}
                        >
                          Remove
                        </Button>
                      )}
                    </LoginLine>
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!read.ok && (
        <p role="alert" className="py-3 text-xs text-danger">{`The servers could not be read: ${read.error}`}</p>
      )}
      {error !== undefined && (
        <p role="alert" className="py-3 text-xs text-danger">
          {error}
        </p>
      )}
    </SettingsSection>
  )
}
