import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Check, Loader2, Server as ServerIcon } from 'lucide-react'
import { onServerLogins, sendAllowLogins, sendSettleLogin, sendUseLoginsOn, type LoginThere, type ServerLogins, type ServerLoginsView } from '../rpc/server-logins.js'
import type { CopiedKind } from '../../src/dashboard/copied-logins.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { Pill } from './Logins.js'
import { CopyButton } from './ui/copy-button.js'

// The servers of the person's that use this computer's logins, in Settings › Accounts: a bar for
// each above the accounts, offering this computer's logins or saying how they stand there, with
// the press that makes the server a login of its own in this computer's browser; under each
// account's row, a row for each server saying whether it has it, with its press; and the person's answer when a server has an account of theirs
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

/** A bar for each server, above the accounts. */
export function ServerBars() {
  const { view, reload } = useServers()
  return (
    <>
      {(view?.servers ?? []).map(server => (
        <ServerBar key={server.machineId} server={server} computer={view!.computer} onChanged={reload} />
      ))}
    </>
  )
}

/** How many of this computer's logins wait for the press there. */
const waiting = (server: ServerLogins): LoginThere[] => server.logins.filter(login => login.state === 'allow' || login.state === 'switched')

/** A server of the person's, above the accounts: offered this computer's logins, or how they stand there, and the press. */
function ServerBar({ server, computer, onChanged }: { server: ServerLogins; computer: string; onChanged: () => Promise<void> }) {
  const { tone, body } = useStanding(server, computer, onChanged)
  if (body === null) return null
  return (
    <Bar label={server.label} tone={tone}>
      {body}
    </Bar>
  )
}

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
          <BarWords title={`${server.label} uses your logins: ${there} of ${server.logins.length} there`} words={missed.length > 0 ? `${missed.join(' and ')} did not get there: see ${missed.length === 1 ? 'its row' : 'their rows'} below. Tried again every minute.` : 'These did not get there. They are tried again every minute.'} />
          <Failed error={failed} />
        </>
      ),
    }
  }
  // All there: each account's row says where it is, so the bar says nothing more, unless something failed for the server.
  if (failed === undefined) return { tone: 'quiet', body: null }
  return {
    tone: 'quiet',
    body: (
      <>
        <p className="flex flex-1 items-center gap-1.5 text-sm">
          <Check className="size-3.5 text-success" aria-hidden />
          {`${server.label} uses your logins: all ${server.logins.length} there`}
        </p>
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

function Bar({ label, tone, children }: { label: string; tone: 'ask' | 'quiet'; children: ReactNode }) {
  return (
    <section aria-label={`Your logins on ${label}`} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5', tone === 'ask' ? 'border-warning/40 bg-warning/10' : 'border-border')}>
      {children}
    </section>
  )
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
export interface RowOf {
  kind: CopiedKind
  host?: string
  source: string
}

const sameRow = (login: RowOf, row: RowOf): boolean => login.kind === row.kind && (login.host ?? '') === (row.host ?? '') && login.source === row.source

/** What a server's row under an account says of it there. */
const THERE_PILL: Record<'there' | 'allow' | 'failed', { words: string; tone: string; dot: string }> = {
  there: { words: 'Connected', tone: 'bg-success/10 text-success', dot: 'bg-success' },
  allow: { words: 'Needs your yes', tone: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  failed: { words: 'Not connected', tone: 'bg-danger/10 text-danger', dot: 'bg-danger' },
}

/**
 * Under an account's name: a row for each server that uses this computer's logins, saying how the
 * account stands there, with its press: Allow where it waits for the person's yes, Take off where
 * it was made anew for the server. Why it did not get to a server is said under the rows, once for
 * every server it failed on alike.
 */
export function ServerNotes({ row }: { row: RowOf }) {
  const { view, reload } = useServers()
  // The press under way, on which server: its button says so until the answer.
  const [pending, setPending] = useState<{ machineId: string; press: 'allow' | 'off' } | undefined>()
  const [error, setError] = useState<string | undefined>()
  const notes = (view?.servers ?? []).flatMap(server => {
    const login = server.on && server.reachable ? server.logins.find(other => sameRow(other, row)) : undefined
    return login && login.state !== 'switched' ? [{ server, login }] : []
  })
  if (notes.length === 0) return null
  const failed = new Map<string, string[]>()
  for (const { server, login } of notes) if (login.state === 'failed') failed.set(login.error ?? 'it did not get there', [...(failed.get(login.error ?? 'it did not get there') ?? []), server.label])
  const pressable = notes.some(({ login }) => login.state === 'allow' || (login.state === 'there' && login.anew))
  const act = async (machineId: string, press: 'allow' | 'off', go: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setPending({ machineId, press })
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
    <div className="space-y-1">
      <ul className="rounded-md bg-muted/50 py-1">
        {notes.map(({ server, login }) => {
          // The login being made for the server keeps its press busy until the browser's yes is in.
          const allowing = (pending?.machineId === server.machineId && pending.press === 'allow') || server.allowing?.name === login.name
          const takingOff = pending?.machineId === server.machineId && pending.press === 'off'
          return (
            <li key={server.machineId} aria-label={`${login.name} on ${server.label}`} className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1 text-xs">
              <ServerIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {/* The name stays whole: on a narrow page the state and the press go under it, to the right. */}
              <span className="max-w-[calc(100%-1.5rem)] flex-[1_0_auto] truncate">{server.label}</span>
              <div className="ml-auto flex items-center gap-2">
                <Pill {...THERE_PILL[login.state as keyof typeof THERE_PILL]} />
                {/* The pills line up whichever row has a press. */}
                {pressable && (
                  <div className="flex w-24 shrink-0 justify-end max-sm:w-auto">
                    {login.state === 'allow' && (
                      <Button size="xs" disabled={pending !== undefined || allowing} onClick={() => void act(server.machineId, 'allow', () => sendAllowLogins(server.machineId))}>
                        {allowing && <Loader2 className="size-3 animate-spin" aria-hidden />}
                        {allowing ? 'Allowing…' : 'Allow'}
                      </Button>
                    )}
                    {/* One that goes as it is would be handed over again at once: only one made anew for the server is taken off. */}
                    {login.state === 'there' && login.anew && (
                      <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={pending !== undefined} title={`${server.label} no longer has it; it waits for your yes again.`} onClick={() => void act(server.machineId, 'off', () => sendSettleLogin(server.machineId, row, false))}>
                        {takingOff && <Loader2 className="size-3 animate-spin" aria-hidden />}
                        {takingOff ? 'Taking off…' : 'Take off'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {[...failed].map(([why, on]) => (
        <p key={why} className="text-xs text-danger">{`Not on ${on.join(' · ')}: ${why}`}</p>
      ))}
      {error !== undefined && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}

/** Under an account's row: a server that has another account of this one's, which the person left here. Their answer: this one there, or the old one kept. */
export function SwitchNotice({ row }: { row: RowOf }) {
  const { view, reload } = useServers()
  const [error, setError] = useState<string | undefined>()
  const switched = (view?.servers ?? []).flatMap(server => {
    const login = server.on && !server.allowing ? server.logins.find(other => sameRow(other, row) && other.state === 'switched') : undefined
    return login ? [{ server, login }] : []
  })
  const act = async (go: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(undefined)
    const done = await go()
    if (!done.ok) setError(done.error)
    await reload()
  }
  return (
    <>
      {switched.map(({ server, login }) => (
        <div key={server.machineId} role="status" className="mx-3 mb-3 space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm">{`${server.label} still runs on ${login.was}, the account you left on ${view!.computer}.`}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void act(() => sendAllowLogins(server.machineId))}>{`Use ${login.name} there`}</Button>
            <Button size="sm" variant="outline" onClick={() => void act(() => sendSettleLogin(server.machineId, row, true))}>{`Keep ${login.was}`}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{`Use ${login.name} there opens your browser once. Runs go on until you pick.`}</p>
          {error !== undefined && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
      ))}
    </>
  )
}

/** At a card's foot: what a server has of this computer's of this kind that this computer no longer has. The person keeps it there or takes it off. */
export function LeftNotices({ kind, host }: { kind: CopiedKind; host?: string }) {
  const { view, reload } = useServers()
  const [error, setError] = useState<string | undefined>()
  const left = (view?.servers ?? []).flatMap(server => server.left.filter(login => login.kind === kind && (login.host ?? '') === (host ?? '')).map(login => ({ server, login })))
  if (left.length === 0) return null
  const act = async (machineId: string, { kind, host, source }: RowOf, keep: boolean) => {
    setError(undefined)
    const done = await sendSettleLogin(machineId, { kind, ...(host !== undefined ? { host } : {}), source }, keep)
    if (!done.ok) setError(done.error)
    await reload()
  }
  return (
    <div className="space-y-2 border-t border-border px-3 py-2.5">
      {left.map(({ server, login }) => (
        <div key={`${server.machineId} ${login.source}`} role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="min-w-0 flex-1 basis-60 text-sm">{`${server.label} still has ${login.name}, which is no longer on ${view!.computer}.`}</p>
          <Button size="xs" variant="outline" onClick={() => void act(server.machineId, login, true)}>
            Keep it there
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void act(server.machineId, login, false)}>
            Take it off
          </Button>
        </div>
      ))}
      {error !== undefined && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}
