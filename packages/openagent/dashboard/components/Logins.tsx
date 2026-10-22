import { useEffect, useState, type ReactNode } from 'react'
import { DRIVER_LABELS, type DriverName } from '../../src/client.js'
import { onAgentState, onGitHosts, sendAgentFix, sendGitHostInstall, sendGitHostLogin, type AgentState, type GitHostRow, type GitHostsView } from '../rpc/logins.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { CopyButton } from './ui/copy-button.js'

// What runs log in with, and what is missing for them to (#2194's accounts, a step further): the
// coding agent's CLI, installed and logged in, and the tool of each git host the projects are on.
// Each is drawn from its own package's answers; a press runs the command that package declared.
// Four places show it: Settings' Agent accounts and Git hosts cards, the Overview's "Get ready"
// step, the start form's red line, and the dot on the person's picture.

/** The Settings entry of the git hosts: what "Add account…" in the person's menu opens. */
export const GIT_HOSTS_ENTRY = 'git-hosts'

/** How often a page asks again: often while something is under way (an install, the browser's yes), less while something is missing, seldom once all is there. */
const BUSY_MS = 2_000
const MISSING_MS = 8_000
const SELDOM_MS = 30_000

/** A read asked again at the pace its last answer calls for. */
function usePaced<T>(load: (() => Promise<T>) | null, pace: (value: T | undefined) => number, deps: unknown[]): { value: T | undefined; reload: () => Promise<void> } {
  const [every, setEvery] = useState(SELDOM_MS)
  const { value, reload } = usePolled<T | undefined>(load, undefined, every, [...deps, every], 'previous')
  const next = pace(value)
  useEffect(() => {
    if (next !== every) setEvery(next)
  }, [next, every])
  return { value, reload }
}

/** The coding agent's CLI as this computer has it: `driver`, else the one picked in Settings. Not asked while `on` is false. */
export function useAgentState(driver?: DriverName, on = true): { state: AgentState | undefined; reload: () => Promise<void> } {
  const { value, reload } = usePaced(on ? () => onAgentState(driver) : null, state => (state?.fixing ? BUSY_MS : state && !state.ready ? MISSING_MS : SELDOM_MS), [driver, on])
  return { state: value, reload }
}

export function useGitHosts(): { view: GitHostsView | undefined; reload: () => Promise<void> } {
  const { value, reload } = usePaced(onGitHosts, view => (view?.hosts.some(h => h.provider?.installing || h.provider?.loggingIn) ? BUSY_MS : view?.hosts.some(h => hostLoginState(h) === 'step' || hostLoginState(h) === 'not-installed') ? MISSING_MS : SELDOM_MS), [])
  return { view: value, reload }
}

/** A card's state: green when there is nothing to do, amber for a step to take, grey for a tool that is not here. */
export type LoginState = 'connected' | 'step' | 'not-installed'

export function agentLoginState(state: AgentState | undefined): LoginState | undefined {
  if (!state) return undefined
  if (state.ready) return 'connected'
  return state.fix?.kind === 'install' || / not found/.test(state.problem ?? '') ? 'not-installed' : 'step'
}

export function hostLoginState(row: GitHostRow): LoginState | undefined {
  const p = row.provider
  if (!p) return undefined
  if (!p.installed) return 'not-installed'
  return p.accounts.length > 0 && p.accounts.every(a => a.ok) ? 'connected' : 'step'
}

const PILL: Record<LoginState, { words: string; tone: string; dot: string }> = {
  connected: { words: 'Connected', tone: 'bg-success/10 text-success', dot: 'bg-success' },
  step: { words: 'Log in', tone: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  'not-installed': { words: 'Not installed', tone: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
}

export function StatePill({ state }: { state: LoginState }) {
  const pill = PILL[state]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', pill.tone)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', pill.dot)} />
      {pill.words}
    </span>
  )
}

/** A package's logo, an SVG it gave: drawn as a mask in the text's colour, never put in the page as markup. */
export function PackageLogo({ svg, className }: { svg: string | undefined; className?: string }) {
  if (!svg) return <span aria-hidden className={cn('size-4 shrink-0 rounded-sm bg-muted-foreground/30', className)} />
  const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
  return <span aria-hidden className={cn('size-4 shrink-0 bg-current', className)} style={{ maskImage: url, WebkitMaskImage: url, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }} />
}

/** The command a press runs, under its button, so the person sees what is done on their computer. */
export function CommandLine({ command }: { command: string }) {
  return (
    <div className="flex min-w-0 items-start gap-1">
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-muted-foreground">{command}</code>
      <CopyButton text={command} label="Copy the command" />
    </div>
  )
}

/** A press that fixes one thing: its button, what it is doing while it does, the command it runs, why it failed. */
export function FixAction({ label, busy, busyWords, command, failed, onPress, size = 'sm' }: { label: string; busy: boolean; busyWords: string; command?: string; failed?: string; onPress: () => void; size?: 'sm' | 'xs' | undefined }) {
  return (
    <div className="min-w-0 space-y-1">
      {busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          {busyWords}
        </p>
      ) : (
        <Button size={size} onClick={onPress}>
          {label}
        </Button>
      )}
      {command && <CommandLine command={command} />}
      {failed && (
        <p role="alert" className="whitespace-pre-line text-xs text-danger">
          {failed}
        </p>
      )}
    </div>
  )
}

/** What the agent's fix says while it goes on. */
function agentBusyWords(state: AgentState): string {
  const name = DRIVER_LABELS[state.driver]
  return state.fixing === 'install' ? `Installing ${name}…` : `Say yes in the page this computer's browser opened to log ${name} in.`
}

/** The agent's fix as one press: [Install Claude Code] or [Log in to Claude Code], with the command; nothing when no press fixes it. */
export function AgentFix({ state, onChanged, size }: { state: AgentState; onChanged: () => void; size?: 'sm' | 'xs' | undefined }) {
  const [error, setError] = useState<string | undefined>()
  if (state.ready || !state.fix) return null
  const name = DRIVER_LABELS[state.driver]
  const press = async () => {
    setError(undefined)
    const done = await sendAgentFix(state.driver)
    if (!done.ok) setError(done.error)
    onChanged()
  }
  return (
    <FixAction
      size={size}
      label={state.fix.kind === 'install' ? `Install ${name}` : `Log in to ${name}`}
      busy={state.fixing !== undefined}
      busyWords={agentBusyWords(state)}
      command={state.fix.command}
      {...((error ?? state.failed) !== undefined ? { failed: (error ?? state.failed)! } : {})}
      onPress={() => void press()}
    />
  )
}

/** A login at the git host under way: the code, with a copy, and the page to type it at. */
export function DeviceCode({ code, url }: { code: string; url: string }) {
  return (
    <div role="status" className="space-y-1.5 text-xs">
      <p className="text-muted-foreground">Type this code at the page below, signed in to the account to add:</p>
      <div className="flex items-center gap-2">
        <code className="rounded bg-muted px-2 py-1 font-mono text-sm font-medium tracking-wider">{code}</code>
        <CopyButton text={code} label="Copy the code" />
        <a href={url} target="_blank" rel="noreferrer" className="text-[var(--color-primary)] underline-offset-2 hover:underline">
          {url.replace(/^https:\/\//, '')}
        </a>
      </div>
    </div>
  )
}

/** The press that logs another account in at a host: it asks the package for a code, and the card shows it while the login waits. */
export function useHostLogin(reload: () => Promise<void>): { start: (host: string) => Promise<void>; error: string | undefined; busy: boolean } {
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const start = async (host: string) => {
    setBusy(true)
    setError(undefined)
    try {
      const done = await sendGitHostLogin(host)
      if (!done.ok) setError(done.error)
      await reload()
    } finally {
      setBusy(false)
    }
  }
  return { start, error, busy }
}

/** The host's fix as one press, with no account or no tool: install it, else log in. */
export function HostFix({ row, onChanged, size }: { row: GitHostRow; onChanged: () => Promise<void>; size?: 'sm' | 'xs' | undefined }) {
  const [error, setError] = useState<string | undefined>()
  const login = useHostLogin(onChanged)
  const p = row.provider
  if (!p) return null
  if (!p.installed) {
    const install = async () => {
      setError(undefined)
      const done = await sendGitHostInstall(row.host)
      if (!done.ok) setError(done.error)
      await onChanged()
    }
    return <FixAction size={size} label={`Install ${p.tool}`} busy={p.installing === true} busyWords={`Installing ${p.tool}…`} command={p.install} {...((error ?? p.installFailed) !== undefined ? { failed: (error ?? p.installFailed)! } : {})} onPress={() => void install()} />
  }
  if (p.loggingIn) return <DeviceCode code={p.loggingIn.code} url={p.loggingIn.url} />
  if (p.accounts.length > 0) return null
  return <FixAction size={size} label={`Log in to ${p.name}`} busy={login.busy} busyWords="Asking for a code…" {...(login.error !== undefined ? { failed: login.error } : {})} onPress={() => void login.start(row.host)} />
}

/** One thing missing before runs can start, and the Settings entry that shows it whole. */
export interface Missing {
  key: string
  /** What it is: "Claude Code", "GitHub". */
  name: string
  /** What is missing, in words. */
  words: string
  entry: string
  /** The press that fixes it. */
  fix: ReactNode
}

/** What is missing, in the order a person sets things up: the coding agent first, then the git hosts. Nothing while it is not read yet. */
export function useMissing(): { missing: Missing[]; reload: () => Promise<void> } {
  const { state, reload: reloadAgent } = useAgentState()
  const { view, reload: reloadHosts } = useGitHosts()
  const reload = async () => {
    await Promise.all([reloadAgent(), reloadHosts()])
  }
  const missing: Missing[] = []
  if (state && !state.ready) {
    const name = DRIVER_LABELS[state.driver]
    missing.push({
      key: 'agent',
      name,
      words: state.fix?.kind === 'install' || / not found/.test(state.problem ?? '') ? `${name} is not installed.` : `${name} is not logged in.`,
      entry: 'agent-accounts',
      fix: <AgentFix state={state} onChanged={() => void reloadAgent()} />,
    })
  }
  for (const row of view?.hosts ?? []) {
    const p = row.provider
    if (!p || hostLoginState(row) === 'connected') continue
    missing.push({
      key: `host:${row.host}`,
      name: p.name,
      words: !p.installed ? `${p.tool}, what ${p.name} is reached through, is not installed.` : p.accounts.length === 0 ? `No ${p.name} account is logged in.` : `${p.name} no longer takes a login: log it in again.`,
      entry: GIT_HOSTS_ENTRY,
      fix: <HostFix row={row} onChanged={reloadHosts} />,
    })
  }
  return { missing, reload }
}
