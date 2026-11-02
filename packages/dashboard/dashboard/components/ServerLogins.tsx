import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { GitBranch, Loader2, Server as ServerIcon } from 'lucide-react'
import { onServerLogins, sendAllowLogins, sendSettleLogin, sendUseLoginsOn, type LoginThere, type ServerLogins, type ServerLoginsView } from '../rpc/server-logins.js'
import type { CopiedKind } from '../../src/dashboard/copied-logins.js'
import { Button } from './ui/button.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { ClaudeLogo, CodexLogo } from './driver-logos.js'
import { cn } from '../lib/utils.js'
import { usePolled } from '../lib/use-async.js'
import { CopyButton } from './ui/copy-button.js'

// The servers of the person's that use this computer's logins, in Settings › Accounts: a card with
// each server, offering this computer's logins or saying how they stand there with the press that
// makes the server a login of its own in this computer's browser; a row for each login saying whether
// the server has it, with its press; and the person's answer when a server has an account of theirs
// that they left here. None on a server: it uses the logins of the person's computers.

/** How often the servers are asked: often while a press is under way, the sign-in being the person's. */
const OFTEN_MS = 2_000
const SELDOM_MS = 30_000

interface Servers {
  view: ServerLoginsView | undefined
  reload: () => Promise<void>
}

const ServersContext = createContext<Servers>({ view: undefined, reload: async () => {} })

/** The servers that use this computer's logins, as the page last read them. */
export function useServers(): Servers {
  return useContext(ServersContext)
}

/** The servers as read for the page, asked often while a press is under way. */
export function ServersProvider({ children }: { children: ReactNode }) {
  const [often, setOften] = useState(false)
  // The pace changes, the servers do not: what was read stays on the page until the next read.
  const { value, reload } = usePolled<ServerLoginsView | undefined>(onServerLogins, undefined, often ? OFTEN_MS : SELDOM_MS, [often], 'previous')
  const busy = value?.servers.some(server => server.allowing) ?? false
  useEffect(() => {
    if (busy !== often) setOften(busy)
  }, [busy, often])
  return <ServersContext.Provider value={{ view: value, reload }}>{children}</ServersContext.Provider>
}

/** The card of the servers that use this computer's logins: nothing where there are none. */
export function ServersCard() {
  const { view, reload } = useServers()
  const servers = view?.servers ?? []
  if (servers.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <span className="inline-flex items-center gap-2">
            <ServerIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
            On your servers
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {servers.map(server => (
          <ServerLoginsThere key={server.machineId} server={server} computer={view!.computer} onChanged={reload} />
        ))}
      </CardContent>
    </Card>
  )
}

/** How many of this computer's logins wait for the press there. */
const waiting = (server: ServerLogins): LoginThere[] => server.logins.filter(login => login.state === 'allow' || login.state === 'switched')

/**
 * How this computer's logins stand on a server, in words, with the press that moves them on: the
 * bar's tone, and what it holds. The same words and press wherever a page says them.
 */
function useStanding(server: ServerLogins, computer: string, onChanged: () => Promise<void>): { tone: 'ask' | 'quiet'; body: ReactNode } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const act = async (go: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(true)
    setError(undefined)
    try {
      const done = await go()
      if (!done.ok) setError(done.error)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }
  // What failed for the server is said here; a login that did not get there says why on its own row, once for every server.
  const failed = error ?? server.failed
  const missed = server.logins.filter(login => login.state === 'failed').map(login => login.name)
  const wait = waiting(server)
  const there = server.logins.filter(login => login.state === 'there').length
  if (!server.on) {
    return {
      tone: 'ask',
      body: (
        <>
          <BarWords title={`Use your logins on ${server.label}?`} words={`Runs there use the accounts you're logged into on ${computer}, and its page follows your settings. The server gets logins of its own: nothing here is logged out.`} />
          <Button size="sm" disabled={busy} onClick={() => void act(() => sendUseLoginsOn(server.machineId))}>
            Use them
          </Button>
          <Failed error={failed} />
        </>
      ),
    }
  }
  if (server.allowing) {
    return {
      tone: 'ask',
      body: (
        <>
          <BarWords title={`Making ${server.allowing.name}'s login for ${server.label}`} words="Say yes in the page your browser opened. If it is signed in to another account, copy the link into a private window." />
          {server.allowing.url !== undefined && <CopyButton text={server.allowing.url} label="Copy link" />}
        </>
      ),
    }
  }
  if (!server.reachable) {
    return { tone: 'quiet', body: <BarWords title={`${server.label} does not answer`} words="Its logins are brought up to date once it does." /> }
  }
  if (wait.length > 0) {
    return {
      tone: 'ask',
      body: (
        <>
          <BarWords title={`${server.label} uses your logins: ${there} of ${server.logins.length} there`} words={`${wait.map(login => login.name).join(' and ')} ${wait.length === 1 ? 'needs' : 'need'} your yes once: your browser opens, you press Allow or Continue.`} />
          <Button size="sm" disabled={busy} onClick={() => void act(() => sendAllowLogins(server.machineId))}>
            {wait.length === 1 ? 'Allow 1 login' : `Allow ${wait.length} logins`}
          </Button>
          <Failed error={failed} />
        </>
      ),
    }
  }
  if (there < server.logins.length) {
    return {
      tone: 'ask',
      body: (
        <>
          <BarWords title={`${server.label} uses your logins: ${there} of ${server.logins.length} there`} words={missed.length > 0 ? `${missed.join(' and ')} did not get there: ${missed.length === 1 ? 'its row says' : 'their rows say'} why. Tried again every minute.` : 'These did not get there. They are tried again every minute.'} />
          <Failed error={failed} />
        </>
      ),
    }
  }
  return {
    tone: 'quiet',
    body: (
      <>
        <BarWords title={server.label} words={`Uses your logins: all ${server.logins.length} there`} />
        <Failed error={failed} />
      </>
    ),
  }
}

/**
 * Where a run sent to a machine of the person's would find no login: how this computer's logins
 * stand there, and the press, as Settings › Accounts says them. A machine that does not take this
 * computer's logins (another person's) is sent to Settings › Accounts.
 */
export function MachineLogins({ machineId, onAccounts }: { machineId: string; onAccounts: () => void }) {
  return (
    <ServersProvider>
      <MachineStanding machineId={machineId} onAccounts={onAccounts} />
    </ServersProvider>
  )
}

function MachineStanding({ machineId, onAccounts }: { machineId: string; onAccounts: () => void }) {
  const { view, reload } = useServers()
  const server = view?.servers.find(candidate => candidate.machineId === machineId)
  if (!view) return null
  if (!server) {
    return (
      <Button size="sm" variant="outline" onClick={onAccounts}>
        Open Accounts
      </Button>
    )
  }
  return <Standing server={server} computer={view.computer} onChanged={reload} />
}

function Standing({ server, computer, onChanged }: { server: ServerLogins; computer: string; onChanged: () => Promise<void> }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-foreground">{useStanding(server, computer, onChanged).body}</div>
}

function Bar({ tone, children }: { tone: 'ask' | 'quiet'; children: ReactNode }) {
  return <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', tone === 'ask' && 'rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5')}>{children}</div>
}

function BarWords({ title, words }: { title: string; words: string }) {
  return (
    <div className="min-w-0 flex-1 basis-60">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{words}</p>
    </div>
  )
}

function Failed({ error }: { error: string | undefined }) {
  if (error === undefined) return null
  return (
    <p role="alert" className="basis-full text-xs whitespace-pre-line text-danger">
      {error}
    </p>
  )
}

/** Which of this computer's accounts a row is. */
type RowOf = Pick<LoginThere, 'kind' | 'host' | 'source'>

/** The mark of what a login is of. */
const KIND_LOGOS: Record<CopiedKind, ComponentType<{ className?: string }>> = { claude: ClaudeLogo, codex: CodexLogo, git: GitBranch }

/** A login's row on a server: its mark, its name, a line on how it stands, and its presses. */
function LoginLine({ row, name, on, words, tone = 'text-muted-foreground', children }: { row: RowOf; name: string; on: string; words: string; tone?: string; children?: ReactNode }) {
  const Logo = KIND_LOGOS[row.kind]
  return (
    <li aria-label={`${name} on ${on}`} className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 py-1">
      <Logo className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className={cn('text-xs', tone)}>{words}</p>
      </div>
      {children !== undefined && <div className="ml-auto flex shrink-0 items-center gap-1">{children}</div>}
    </li>
  )
}

/** What a login's row says of how it stands, by its state. */
function standingWords(login: LoginThere, computer: string): { words: string; tone: string } {
  if (login.state === 'there') return { words: 'Connected', tone: 'text-success' }
  if (login.state === 'allow') return { words: 'Needs your yes', tone: 'text-warning' }
  if (login.state === 'switched') return { words: `Still runs on ${login.was}, the account you left on ${computer}. Runs go on until you pick.`, tone: 'text-warning' }
  return { words: `Not connected: ${login.error ?? 'it did not get there'}`, tone: 'text-danger' }
}

/**
 * One server in the card: how this computer's logins stand there and the press that moves them on,
 * then a row for each login with its own press: Allow where it waits for the person's yes, Take off
 * where it was made anew for the server, the pick where the person left the account it has, and
 * Keep or Take off for what this computer no longer has.
 */
function ServerLoginsThere({ server, computer, onChanged }: { server: ServerLogins; computer: string; onChanged: () => Promise<void> }) {
  const { tone, body } = useStanding(server, computer, onChanged)
  // The press under way, on which login: its button says so until the answer.
  const [pending, setPending] = useState<{ source: string; press: 'allow' | 'off' | 'keep' } | undefined>()
  const [error, setError] = useState<string | undefined>()
  const act = async (source: string, press: 'allow' | 'off' | 'keep', go: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setPending({ source, press })
    setError(undefined)
    try {
      const done = await go()
      if (!done.ok) setError(done.error)
      await onChanged()
    } finally {
      setPending(undefined)
    }
  }
  const logins = server.on && server.reachable ? server.logins : []
  const settle = (row: RowOf, keep: boolean) => void act(row.source, keep ? 'keep' : 'off', () => sendSettleLogin(server.machineId, { kind: row.kind, ...(row.host !== undefined ? { host: row.host } : {}), source: row.source }, keep))
  const allow = (source: string) => void act(source, 'allow', () => sendAllowLogins(server.machineId))
  return (
    <section aria-label={`Your logins on ${server.label}`} className="space-y-1.5">
      <Bar tone={tone}>{body}</Bar>
      {(logins.length > 0 || server.left.length > 0) && (
        <ul>
          {logins.map(login => {
            // The login being made for the server keeps its press busy until the browser's yes is in.
            const allowing = (pending?.press === 'allow' && pending.source === login.source) || server.allowing?.name === login.name
            const takingOff = pending?.press === 'off' && pending.source === login.source
            return (
              <LoginLine key={`${login.kind} ${login.host ?? ''} ${login.source}`} row={login} name={login.name} on={server.label} {...standingWords(login, computer)}>
                {login.state === 'allow' && (
                  <Button size="xs" disabled={pending !== undefined || allowing} onClick={() => allow(login.source)}>
                    {allowing && <Loader2 className="size-3 animate-spin" aria-hidden />}
                    {allowing ? 'Allowing…' : 'Allow'}
                  </Button>
                )}
                {/* One that goes as it is would be handed over again at once: only one made anew for the server is taken off. */}
                {login.state === 'there' && login.anew && (
                  <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={pending !== undefined} title={`${server.label} no longer has it; it waits for your yes again.`} onClick={() => settle(login, false)}>
                    {takingOff && <Loader2 className="size-3 animate-spin" aria-hidden />}
                    {takingOff ? 'Taking off…' : 'Take off'}
                  </Button>
                )}
                {login.state === 'switched' && !server.allowing && (
                  <>
                    <Button size="xs" disabled={pending !== undefined} title="Opens your browser once." onClick={() => allow(login.source)}>{`Use ${login.name} there`}</Button>
                    <Button size="xs" variant="ghost" disabled={pending !== undefined} onClick={() => settle(login, true)}>{`Keep ${login.was}`}</Button>
                  </>
                )}
              </LoginLine>
            )
          })}
          {server.left.map(login => (
            <LoginLine key={`left ${login.kind} ${login.host ?? ''} ${login.source}`} row={login} name={login.name} on={server.label} words={`No longer on ${computer}`}>
              <Button size="xs" variant="ghost" disabled={pending !== undefined} onClick={() => settle(login, true)}>
                Keep it there
              </Button>
              <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={pending !== undefined} onClick={() => settle(login, false)}>
                Take it off
              </Button>
            </LoginLine>
          ))}
        </ul>
      )}
      {error !== undefined && <p role="alert" className="text-xs text-danger">{error}</p>}
    </section>
  )
}
