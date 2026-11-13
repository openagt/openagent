import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { GitBranch, Loader2 } from 'lucide-react'
import { onServerLogins, sendAllowLogins, sendSettleLogin, sendUseLoginsOn, type LoginThere, type ServerLogins, type ServerLoginsView } from '../rpc/server-logins.js'
import type { CopiedKind } from '../../src/dashboard/copied-logins.js'
import { Button } from './ui/button.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { ClaudeLogo, CodexLogo } from './driver-logos.js'
import { cn } from '../lib/utils.js'
import { usePolled } from '../lib/use-async.js'
import { CopyButton } from './ui/copy-button.js'

// The servers of the person's that use this computer's logins, on the Permissions page: under each
// account's row, where it works (a chip per server, with its press there), and at the page's top
// only what a server asks of the person: to use their logins there, a yes for a login, an account
// it keeps that this computer no longer has (his pick over a card that listed every account again
// under each server). None on a server: it uses the logins of the person's computers.

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

/**
 * What the person's servers ask of them, at the top of the Permissions page, and only that: a
 * server to use their logins on, a login waiting for their yes, one that did not get there, one a
 * server keeps that this computer no longer has, a server that does not answer. A server where
 * everything is there says nothing here: each account's row says where it works.
 */
export function ServerAsks() {
  const { view, reload } = useServers()
  if (!view) return null
  return (
    <>
      {view.servers.map(server => (
        <ServerAsk key={server.machineId} server={server} computer={view.computer} onChanged={reload} />
      ))}
    </>
  )
}

function ServerAsk({ server, computer, onChanged }: { server: ServerLogins; computer: string; onChanged: () => Promise<void> }) {
  const { tone, body } = useStanding(server, computer, onChanged)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  if (tone === 'quiet' && server.reachable && server.left.length === 0) return null
  const settle = async (row: RowOf, keep: boolean) => {
    setPending(true)
    setError(undefined)
    try {
      const done = await sendSettleLogin(server.machineId, { kind: row.kind, ...(row.host !== undefined ? { host: row.host } : {}), source: row.source }, keep)
      if (!done.ok) setError(done.error)
      await onChanged()
    } finally {
      setPending(false)
    }
  }
  return (
    <section aria-label={`Your logins on ${server.label}`} className="space-y-1.5">
      <Bar tone={tone === 'quiet' ? 'ask' : tone}>{body}</Bar>
      {server.left.length > 0 && (
        <ul className="px-1">
          {server.left.map(login => (
            <LoginLine key={`left ${login.kind} ${login.host ?? ''} ${login.source}`} row={login} name={login.name} on={server.label} words={`On ${server.label}, no longer on ${computer}`}>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => void settle(login, true)}>
                Keep it there
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={pending} onClick={() => void settle(login, false)}>
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

/** Which of this computer's accounts a row under an account is: a coding agent's, by its own login or its name; a git host's, by its login there. */
export type AccountOf = { kind: 'claude' | 'codex'; own: boolean; name: string } | { kind: 'git'; host: string; login: string }

/** The account as the servers' rows name it (`logins-sync.ts`): the person's own login is `own`. */
function rowOf(account: AccountOf): RowOf {
  return account.kind === 'git' ? { kind: 'git', host: account.host, source: account.login } : { kind: account.kind, source: account.own ? 'own' : account.name }
}

const sameRow = (a: RowOf, b: RowOf): boolean => a.kind === b.kind && (a.host ?? '') === (b.host ?? '') && a.source === b.source

/** A chip's colour by how the account stands there. */
const DOT: Record<'there' | 'waits' | 'failed' | 'off', string> = { there: 'bg-success', waits: 'bg-warning', failed: 'bg-danger', off: 'bg-muted-foreground/40' }

/**
 * Where an account works, under its row on the Permissions page: this computer, then each of the
 * person's servers, a chip each, its dot green where the account is there, amber where it waits
 * for the person, red where it did not get there, grey where the server does not use these logins
 * or does not answer. A chip with a press there opens it (Allow, Take off, the pick of a switched
 * account); the others say how it stands. Nothing with no server: there is nowhere else to say.
 */
export function AccountWhere({ account }: { account: AccountOf }) {
  const { view, reload } = useServers()
  const [pending, setPending] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  if (!view || view.servers.length === 0) return null
  const row = rowOf(account)
  const act = async (machineId: string, go: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setPending(machineId)
    setError(undefined)
    try {
      const done = await go()
      if (!done.ok) setError(done.error)
      await reload()
    } finally {
      setPending(undefined)
    }
  }
  return (
    <div className="space-y-1 pb-1">
      <ul aria-label="Where it works" className="flex flex-wrap items-center gap-1.5">
        <Chip label="This computer" dot="there" title={`On ${view.computer}`} />
        {view.servers.map(server => {
          const login = server.on && server.reachable ? server.logins.find(each => sameRow(each, row)) : undefined
          // The login being made for the server spins until the browser's yes is in, as the press that started it did.
          const busy = pending === server.machineId || (login !== undefined && server.allowing?.name === login.name)
          const words = !server.on ? `${server.label} does not use your logins` : !server.reachable ? `${server.label} does not answer` : login ? standingWords(login, view.computer).words : `Not on ${server.label}`
          const dot = !login ? 'off' : login.state === 'there' ? 'there' : login.state === 'failed' ? 'failed' : 'waits'
          const presses: { label: string; go: () => Promise<{ ok: true } | { ok: false; error: string }> }[] = []
          if (login?.state === 'allow' || (login?.state === 'switched' && !server.allowing)) presses.push({ label: login.state === 'switched' ? `Use ${login.name} there` : 'Allow', go: () => sendAllowLogins(server.machineId) })
          if (login?.state === 'switched' && !server.allowing) presses.push({ label: `Keep ${login.was}`, go: () => sendSettleLogin(server.machineId, row, true) })
          // One that goes as it is would be handed over again at once: only one made anew for the server is taken off.
          if (login?.state === 'there' && login.anew) presses.push({ label: 'Take off', go: () => sendSettleLogin(server.machineId, row, false) })
          if (presses.length === 0 && !busy) return <Chip key={server.machineId} label={server.label} dot={dot} title={words} />
          return (
            <li key={server.machineId}>
              <DropdownMenu>
                <DropdownMenuTrigger className={cn(CHIP_CLASS, 'hover:bg-muted')} disabled={busy} title={words}>
                  {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <span aria-hidden className={cn('size-1.5 rounded-full', DOT[dot])} />}
                  {server.label}
                </DropdownMenuTrigger>
                <DropdownMenuContent className="min-w-[12rem]">
                  <p className="px-2 py-1 text-xs text-muted-foreground">{words}</p>
                  {presses.map(press => (
                    <DropdownMenuItem key={press.label} onClick={() => void act(server.machineId, press.go)}>
                      {press.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          )
        })}
      </ul>
      {error !== undefined && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}

const CHIP_CLASS = 'inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground'

function Chip({ label, dot, title }: { label: string; dot: keyof typeof DOT; title: string }) {
  return (
    <li title={title} aria-label={`${label}: ${title}`} className={CHIP_CLASS}>
      <span aria-hidden className={cn('size-1.5 rounded-full', DOT[dot])} />
      {label}
    </li>
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
          <Button disabled={busy} onClick={() => void act(() => sendUseLoginsOn(server.machineId))}>
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
          <Button disabled={busy} onClick={() => void act(() => sendAllowLogins(server.machineId))}>
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
 * stand there, and the press, as the Permissions page says them. A machine that does not take this
 * computer's logins (another person's) is sent to the Permissions page.
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
      <Button variant="outline" onClick={onAccounts}>
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
    <div className="min-w-0 grow basis-60">
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
      <div className="min-w-0 grow basis-40">
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
