import { useEffect, useState, type ReactNode } from 'react'
import { DRIVER_LABELS, type DriverName } from '../../src/client.js'
import { onAgentState, onGitHosts, sendAgentFix, type AgentState, type GitHostRow, type GitHostsView } from '../rpc/logins.js'
import { useAskOn, usePolled, type ReadState } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { CopyButton } from './ui/copy-button.js'
import { useMountedModules } from '../lib/use-modules.js'
import { ModuleSlot } from './ModulePageView.js'

// What runs log in with, and what is missing for them to (#2194's accounts, a step further): the
// coding agent's CLI, installed and logged in, and the tool of each git host the projects are on.
// Each is drawn from its own package's answers; a press runs the command that package declared.
// A coding agent with no account gets one in its package's own window (`agent.connect`).
// An account at a git host is added in a dialog of its own (`AddGitAccount.tsx`).
// Four places show it: the cards of the Permissions page, the Overview's "Discover OpenAgent"
// steps, the start form's red line, and the dot on the person's picture.


/** How often a page asks again: often while something is under way (an install, the browser's yes), less while something is missing, seldom once all is there. */
const BUSY_MS = 2_000
const MISSING_MS = 8_000
const SELDOM_MS = 30_000

/**
 * A read asked again at the pace its last answer calls for. Its answer is kept under `key`, in this
 * browser too: a place that opens later (the person's menu, the next load's Permissions) shows it
 * from its first frame, never empty while the same question is asked again.
 */
function usePaced<T>(key: string, load: (() => Promise<T>) | null, pace: (value: T | undefined) => number, deps: unknown[]): { value: T | undefined; state: ReadState; reload: () => Promise<void> } {
  const [every, setEvery] = useState(SELDOM_MS)
  const { value, state, reload, refresh } = usePolled<T | undefined>(load, undefined, every, deps, { remember: key, stored: true })
  useAskOn(every, refresh)
  const next = pace(value)
  useEffect(() => {
    if (next !== every) setEvery(next)
  }, [next, every])
  return { value, state, reload }
}

/** The coding agent's CLI as this computer has it: `driver`, else the one picked in Settings. Not asked while `on` is false. */
export function useAgentState(driver?: DriverName, on = true): { state: AgentState | undefined; reload: () => Promise<void> } {
  const { value, reload } = usePaced(`agent-state:${driver ?? ''}`, on ? () => onAgentState(driver) : null, state => (state?.fixing ? BUSY_MS : state && !state.ready ? MISSING_MS : SELDOM_MS), [driver, on])
  return { state: value, reload }
}

export function useGitHosts(): { view: GitHostsView | undefined; state: ReadState; reload: () => Promise<void> } {
  const { value, state, reload } = usePaced('git-hosts', onGitHosts, view => (view?.hosts.some(h => h.provider?.installing || h.provider?.loggingIn) ? BUSY_MS : view?.hosts.some(h => hostLoginState(h) === 'step' || hostLoginState(h) === 'not-installed') ? MISSING_MS : SELDOM_MS), [])
  return { view: value, state, reload }
}

/** A login's state, said by its colour: green when there is nothing to do, amber for a step to take, grey for a tool that is not here. */
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

/** A package's logo, an SVG it gave: drawn as a mask in the text's colour, never put in the page as markup. */
export function PackageLogo({ svg, className }: { svg: string | undefined; className?: string }) {
  if (!svg) return <span aria-hidden className={cn('size-4 shrink-0 rounded-sm bg-muted-foreground/30', className)} />
  const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
  return <span aria-hidden className={cn('size-4 shrink-0 bg-current', className)} style={{ maskImage: url, WebkitMaskImage: url, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }} />
}

/**
 * The command a press runs, under its button, so the person sees what is done on their computer: one line, which scrolls sideways when it
 * is longer than its room. On a phone the copy press is a finger's size, its glyph 16 in from the right: the command starts 16 in too.
 */
export function CommandLine({ command }: { command: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2 max-md:pl-4">
      {/* Where it has no room it ends with "…" on a whole character, and scrolls to its end. */}
      <code className="min-w-0 flex-1 overflow-x-auto py-1 font-mono text-xs text-ellipsis whitespace-nowrap text-muted-foreground">{command}</code>
      <CopyButton text={command} label="Copy the command" className="justify-center md:size-6 max-md:size-11" />
    </div>
  )
}

/** Whether what is in the way of the agent is its own login. */
export function loggedOut(state: AgentState): boolean {
  return / logged in/.test(state.problem ?? '')
}

/** What is in the way of the agent, in words. */
export function agentWords(state: AgentState): string {
  const name = DRIVER_LABELS[state.driver]
  return agentLoginState(state) === 'not-installed' ? `${name} is not installed.` : loggedOut(state) ? `${name} is not logged in.` : (state.problem ?? `${name} cannot start.`)
}

/** What is missing at a host, in words. */
export function hostWords(row: GitHostRow): string {
  const p = row.provider!
  return !p.installed ? `${p.tool}, the tool for ${p.name}, is not installed.` : p.accounts.length === 0 ? `OpenAgent has no ${p.name} account yet.` : `${p.name} no longer takes a login: add it again.`
}

/** How a fix's press is drawn: the page's primary by default, or a quieter press beside another's. */
export type FixVariant = 'secondary' | undefined

/** A press that fixes one thing: its button, what it is doing while it does, the command it runs, why it failed. */
export function FixAction({ label, busy, busyWords, command, failed, onPress, size = 'default', variant }: { label: string; busy: boolean; busyWords: string; command?: string; failed?: string; onPress: () => void; size?: 'default' | 'sm' | undefined; variant?: FixVariant }) {
  return (
    <div className="min-w-0 space-y-2">
      {/* The command beside its press where both fit, so the two take one line. Busy, the press stays with the focus it
          was pressed with, and says it is waiting under it. On a phone the page's press is a finger's 44, as a form's foot is. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size={size} variant={variant} loading={busy} onClick={onPress} className={cn(size === 'default' && 'max-md:h-11')}>
          {label}
        </Button>
        {command && <CommandLine command={command} />}
      </div>
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {busyWords}
        </p>
      )}
      {failed && (
        <p role="alert" className="whitespace-pre-line text-xs text-danger">
          <Linked text={failed} />
        </p>
      )}
    </div>
  )
}

/** A program's words, each address in them a link: a sign-in page it names is opened from here. */
export function Linked({ text }: { text: string }) {
  return text.split(/(https?:\/\/[^\s<>"]+)/).map((part, at) =>
    at % 2 === 1 ? (
      <a key={at} href={part} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        {part}
      </a>
    ) : (
      part
    ),
  )
}

/** The list a coding agent's accounts are kept in, by its CLI. */
const ACCOUNTS_OF = { 'claude-code': 'claude', codex: 'codex' } as const

/**
 * What a press does about a coding agent that cannot run: [Install Claude Code], with its command,
 * where its program is missing; else [Add account], the window its package adds one in. Nothing
 * when nothing fixes it.
 */
export function AgentFix({ state, onChanged, size, variant }: { state: AgentState; onChanged: () => void; size?: 'default' | 'sm' | undefined; variant?: FixVariant }) {
  const [error, setError] = useState<string | undefined>()
  const connect = useMountedModules().views['agent.connect'][0]
  if (state.ready || !state.fix) return null
  if (state.fix.kind !== 'install')
    return connect ? (
      <ModuleSlot package={connect.package} label="add account">
        <connect.View agent={ACCOUNTS_OF[state.driver]} primary={variant === undefined} label="Add account" small={size === 'sm'} onConnected={onChanged} />
      </ModuleSlot>
    ) : null
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
      variant={variant}
      label={`Install ${name}`}
      busy={state.fixing !== undefined}
      busyWords={`Installing ${name}…`}
      command={state.fix.command}
      {...((error ?? state.failed) !== undefined ? { failed: (error ?? state.failed)! } : {})}
      onPress={() => void press()}
    />
  )
}

/** One thing missing before runs can start; the Permissions page shows it whole. */
export interface Missing {
  key: string
  /** What it is: "Claude Code", "GitHub". */
  name: string
  /** What is missing, in words. */
  words: string
  /** What fixes it, as a menu item that leads there says it: "Install Claude Code…". */
  action: string
  /** The press that fixes it, for the coding agent: a git host's account is added in its dialog (`AddGitAccount.tsx`). */
  fix?: ReactNode
}

/** What is missing, in the order a person sets things up: the coding agent first, then the git hosts. Nothing while it is not read yet, and `loaded` once both are read. With it, the git hosts as read, for a place that shows them too. */
export function useMissing(): { missing: Missing[]; loaded: boolean; reload: () => Promise<void>; hosts: GitHostsView | undefined } {
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
      words: agentWords(state),
      action: agentLoginState(state) === 'not-installed' ? `Install ${name}…` : loggedOut(state) ? `Add a ${name} account…` : `Set up ${name}…`,
      fix: <AgentFix state={state} onChanged={() => void reloadAgent()} />,
    })
  }
  for (const row of view?.hosts ?? []) {
    const p = row.provider
    if (!p || hostLoginState(row) === 'connected') continue
    missing.push({
      key: `host:${row.host}`,
      name: p.name,
      words: hostWords(row),
      action: !p.installed ? `Install ${p.tool}…` : p.accounts.length === 0 ? `Add a ${p.name} account…` : `Add your ${p.name} account again…`,
    })
  }
  return { missing, loaded: state !== undefined && view !== undefined, reload, hosts: view }
}
