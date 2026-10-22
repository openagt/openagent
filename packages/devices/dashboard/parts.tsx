import { useState, type ComponentType, type FormEvent, type ReactNode } from 'react'
import { ChevronRight, Circle, CircleArrowUp, CircleCheck, CircleX, Loader2, Pencil } from 'lucide-react'
import { Button, Input, cn } from '@openagt/dashboard/module'
import type { StepState } from './servers.js'

// The small pieces the pages of Settings › Devices share: a row of the list, the tabs of a
// device's page, where a device is in a few words, and the lines of a server's steps and logins.

/** A day, as a person reads it. */
export const day = (iso: string | undefined): string => (iso === undefined ? '' : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))

/** A door's address as a person reads it: its host, without the scheme. */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Names as a sentence says them: `@a`, `@a and @b`, `@a, @b and @c`. */
export const named = (accounts: readonly string[]): string => {
  const said = accounts.map(account => `@${account}`)
  return said.length < 2 ? (said[0] ?? '') : `${said.slice(0, -1).join(', ')} and ${said.at(-1)}`
}

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

/** Where a device is, in a few words with a mark. */
export function State({ tone, children }: { tone: 'working' | 'good' | 'warn' | 'bad' | 'quiet'; children: ReactNode }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-1.5', tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-muted-foreground')}>
      {tone === 'working' ? (
        <Loader2 aria-hidden className="h-3 w-3 shrink-0 animate-spin text-primary" />
      ) : tone === 'warn' ? (
        <CircleArrowUp aria-hidden className="h-3 w-3 shrink-0" />
      ) : tone === 'bad' ? (
        <CircleX aria-hidden className="h-3 w-3 shrink-0" />
      ) : (
        <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone === 'good' ? 'bg-[var(--color-primary)]' : 'bg-muted-foreground/40')} />
      )}
      {children}
    </span>
  )
}

/** The words of a line under a name, apart: "Online · Computer · on this Wi-Fi". */
export function Facts({ children }: { children: ReactNode[] }) {
  const shown = children.filter(child => child !== undefined && child !== false && child !== null && child !== '')
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      {shown.map((child, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          {child}
        </span>
      ))}
    </p>
  )
}

/** A device in the list: its icon, its name, the line under it, and what is at its end: a way into its page, or a menu. */
export function Row({ icon: Icon, name, facts, end, onOpen }: { icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; name: string; facts: ReactNode[]; end?: ReactNode; onOpen?: () => void }) {
  const body = (
    <>
      <Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm">{name}</span>
        <Facts>{facts}</Facts>
      </span>
    </>
  )
  return (
    <li aria-label={name} className="flex items-center gap-3 py-3">
      {onOpen ? (
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]" onClick={onOpen}>
          {body}
          <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}
      {end}
    </li>
  )
}

/** The tabs of a device's page: each a word, the picked one underlined. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly { id: T; title: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-border">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
          className={cn('-mb-px border-b-2 px-3 py-2 text-sm outline-none', tab.id === value ? 'border-[var(--color-primary)] font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          {tab.title}
        </button>
      ))}
    </div>
  )
}

/** A part of a device's page, with its heading. */
export function Part({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border py-4 last:border-b-0">
      {title !== undefined && <h3 className="text-sm font-medium">{title}</h3>}
      {children}
    </section>
  )
}

/** A switch row of a page: what it is, what it means now, and the switch. */
export function SwitchLine({ label, words, children }: { label: string; words: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted-foreground">{words}</span>
      </span>
      {children}
    </div>
  )
}

/** One login's line: what is there, what a person can do about it, and why the last try failed. */
export function LoginLine({ label, words, said, children }: { label: string; words: string; said: string | undefined; children: ReactNode }) {
  return (
    <li aria-label={label} className="space-y-1.5">
      <p>{words}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {said !== undefined && <Said>{said}</Said>}
    </li>
  )
}

/** What a server or a command said, as it said it. */
export function Said({ children }: { children: ReactNode }) {
  return (
    <pre role="alert" className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground">
      {children}
    </pre>
  )
}

export const STATE_WORD: Record<StepState, string> = { waiting: 'not started', running: 'running', done: 'done', failed: 'failed' }

/** A step's mark: its own spinner while it runs. */
export function StepMark({ state }: { state: StepState }) {
  const className = 'h-3.5 w-3.5 shrink-0'
  if (state === 'running') return <Loader2 aria-hidden className={cn(className, 'animate-spin text-primary')} />
  if (state === 'done') return <CircleCheck aria-hidden className={cn(className, 'text-success')} />
  if (state === 'failed') return <CircleX aria-hidden className={cn(className, 'text-danger')} />
  return <Circle aria-hidden className={cn(className, 'text-muted-foreground/50')} />
}

/** One line of the steps: its mark, its name, and what the server said when it failed. */
export function StepLine({ label, state, said, children }: { label: string; state: StepState; said?: string | undefined; children?: ReactNode }) {
  return (
    <li aria-label={`${label}: ${STATE_WORD[state]}`}>
      <span className={cn('flex items-center gap-2', state === 'failed' ? 'text-danger' : state === 'waiting' ? 'text-muted-foreground' : undefined)}>
        <StepMark state={state} />
        {label}
      </span>
      {children}
      {said !== undefined && <div className="mt-1 ml-5.5">{<Said>{said}</Said>}</div>}
    </li>
  )
}

/** A line that went wrong, said in red. */
export function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-xs text-danger">
      {children}
    </p>
  )
}

/** The top of a device's page: its icon, name and facts, and Rename. */
export function Head({ icon: Icon, name, badge, facts, rename }: { icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; name: string; badge?: string; facts: ReactNode[]; rename?: (name: string) => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const [renaming, setRenaming] = useState(false)
  const [picked, setPicked] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!rename) return
    setBusy(true)
    setError(undefined)
    const answer = await rename(picked.trim())
    setBusy(false)
    if (answer.ok) setRenaming(false)
    else setError(answer.error)
  }
  return (
    <div className="space-y-1 py-2">
      <div className="flex items-center gap-3">
        <Icon aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form className="flex flex-wrap items-center gap-2" onSubmit={event => void save(event)}>
              <Input autoFocus aria-label="Name" value={picked} maxLength={60} onChange={event => setPicked(event.target.value)} className="h-8 w-56" />
              <Button size="sm" type="submit" disabled={busy || !picked.trim()}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                Save
              </Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <p className="flex min-w-0 items-center gap-2 text-base font-semibold">
              <span className="truncate">{name}</span>
              {badge !== undefined && <span className="shrink-0 rounded-full border border-border px-2 text-[11px] font-medium text-muted-foreground">{badge}</span>}
            </p>
          )}
          <Facts>{facts}</Facts>
        </div>
        {rename && !renaming && (
          <Button size="sm" variant="ghost" onClick={() => (setPicked(name), setRenaming(true))}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Rename
          </Button>
        )}
      </div>
      {error !== undefined && <Problem>{error}</Problem>}
    </div>
  )
}
