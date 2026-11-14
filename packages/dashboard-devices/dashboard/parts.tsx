import { Fragment, useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode, type RefObject } from 'react'
import { ChevronRight, Circle, CircleArrowUp, CircleCheck, CircleX, Loader2, Pencil } from 'lucide-react'
import { Badge, Button, Input, RadioGroupOption, Row, Section, cn, formatDateTime, formatRelative, useOpenAgentDown } from '@openagt/dashboard/module'
import type { DeviceRow as Listed } from './devices.js'
import type { StepState } from './servers.js'

// The small pieces the pages of Settings › Devices share: a device's row, the tabs of a
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

/** Names as a sentence says them: `a`, `a and b`, `a, b and c`. */
export const named = (names: readonly string[]): string => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

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

/** Where a device is, in a few words with a dot of its colour. */
export function State({ tone, children }: { tone: 'working' | 'good' | 'warn' | 'bad' | 'quiet'; children: ReactNode }) {
  return (
    <Badge role="status" tone={TONE[tone]}>
      {children}
    </Badge>
  )
}

const TONE = { working: 'info', good: 'success', warn: 'warning', bad: 'danger', quiet: 'neutral' } as const

/** The words of a line under a name, apart: "Computer · on this Wi-Fi". */
export function Facts({ children }: { children: ReactNode[] }) {
  const shown = children.filter(child => child !== undefined && child !== false && child !== null && child !== '')
  return shown.map((child, i) => (
    <Fragment key={i}>
      {i > 0 && ' · '}
      <span>{child}</span>
    </Fragment>
  ))
}

/** A device in a list: its icon, its name, the line under it, its state at the right, and its page or its own presses. */
export function ListedDevice({ icon: Icon, name, facts, state, actions, onOpen }: { icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; name: string; facts: ReactNode[]; state?: ReactNode; actions?: ReactNode; onOpen?: () => void }) {
  return (
    <Row
      leading={<Icon aria-hidden className="size-4" />}
      title={name}
      detail={<Facts>{facts}</Facts>}
      meta={
        state !== undefined || onOpen !== undefined ? (
          <>
            {state}
            {onOpen && <ChevronRight aria-hidden className="size-4" />}
          </>
        ) : undefined
      }
      actions={actions}
      stackOnPhone
      {...(onOpen ? { onClick: onOpen } : {})}
    />
  )
}

/** The tabs of a device's page: each a word, the picked one underlined. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly { id: T; title: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mt-4 flex gap-1 border-b border-hairline">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
          className={cn('focus-ring -mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors', tab.id === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          {tab.title}
        </button>
      ))}
    </div>
  )
}

/** A part of a device's page, with its heading. */
export function Part({ title, children }: { title?: string; children: ReactNode }) {
  if (title !== undefined)
    return (
      <Section title={title} className="pt-6">
        <div className="space-y-3">{children}</div>
      </Section>
    )
  return <section className="space-y-3 pt-6">{children}</section>
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
    <pre role="alert" className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
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
  return <Circle aria-hidden className={cn(className, 'text-faint-foreground')} />
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

/**
 * A change a page makes on a press: busy while it runs, then what it changed read again
 * (`reload`); why it failed is said until the next change. `act` answers whether it went.
 */
export function useChange(reload: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const act = async (change: () => Promise<{ ok: true } | { ok: false; error: string }>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    const answer = await change()
    if (!answer.ok) setError(answer.error)
    await reload().catch(() => {})
    setBusy(false)
    return answer.ok
  }
  return { busy, setBusy, error, setError, act }
}

/** A rename: the person's picked name, and what saving it answered. */
export type Rename = (name: string) => Promise<{ ok: true } | { ok: false; error: string }>

/** Rename's press and its form: open, the form has the focus; closed, by Save or Cancel, its press has it again. */
export function useRenaming(): { renaming: boolean; open: () => void; close: () => void; press: RefObject<HTMLButtonElement | null> } {
  const [renaming, setRenaming] = useState(false)
  const press = useRef<HTMLButtonElement>(null)
  const closed = useRef(false)
  useEffect(() => {
    if (renaming || !closed.current) return
    closed.current = false
    press.current?.focus()
  }, [renaming])
  const close = (): void => {
    closed.current = true
    setRenaming(false)
  }
  return { renaming, open: () => setRenaming(true), close, press }
}

/** A name being changed in place: the field, Save and Cancel; a refusal is said below the field. */
export function RenameForm({ name, rename, onClose }: { name: string; rename: Rename; onClose: () => void }) {
  const down = useOpenAgentDown()
  const [picked, setPicked] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    const answer = await rename(picked.trim())
    setBusy(false)
    if (answer.ok) onClose()
    else setError(answer.error)
  }
  return (
    <div className="space-y-1">
      <form className="flex flex-wrap items-center gap-2" onSubmit={event => void save(event)}>
        <Input name="device-name" autoFocus aria-label="Name" value={picked} maxLength={60} onChange={event => setPicked(event.target.value)} className="h-8 w-56" />
        <Button type="submit" loading={busy} disabled={!picked.trim() || down}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </form>
      {error !== undefined && <Problem>{error}</Problem>}
    </div>
  )
}

/** The top of a device's page: its icon, name and facts, and Rename. */
export function Head({ icon: Icon, name, badge, facts, rename }: { icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; name: string; badge?: string; facts: ReactNode[]; rename?: Rename }) {
  const { renaming, open, close, press } = useRenaming()
  return (
    <div className="flex min-h-12 items-center gap-3">
        <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {renaming && rename ? (
            <RenameForm name={name} rename={rename} onClose={close} />
          ) : (
            <p className="flex min-w-0 items-center gap-2 text-base font-semibold">
              <span className="truncate">{name}</span>
              {badge !== undefined && <Badge>{badge}</Badge>}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            <Facts>{facts}</Facts>
          </p>
        </div>
        {rename && !renaming && (
          <Button ref={press} variant="ghost" size="sm" className="max-md:h-11" onClick={open}>
            <Pencil className="size-4" aria-hidden />
            Rename
          </Button>
        )}
    </div>
  )
}

/** A press that reads as a link in its sentence: blue, underlined under the pointer, with room around it for a finger. */
export function LinkPress({ loading = false, disabled = false, onClick, children }: { loading?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="link" loading={loading} disabled={disabled} onClick={onClick} className="relative h-auto px-0 text-xs font-normal whitespace-normal after:absolute after:inset-x-0 after:-inset-y-1.5 max-md:after:-inset-y-3.5">
      {children}
    </Button>
  )
}

/** When a device that is in got in and was last seen, and what it is when that needs saying. */
export function Seen({ device, note }: { device: Listed; note?: string | undefined }) {
  return (
    <>
      <span title={formatDateTime(device.seen ?? device.added)}>
        {`Added ${formatRelative(device.added)}`}
        {device.seen !== undefined ? `, last seen ${formatRelative(device.seen)}` : ''}
      </span>
      {note !== undefined && (
        <>
          {' · '}
          <span title={note}>{note}</span>
        </>
      )}
    </>
  )
}

/** One of a dialog's choices: its radio, its title and what it means, filled under the pointer; `children` under the words. */
export function Choice({ value, disabled, title, words, badge, children }: { value: string; disabled?: boolean | undefined; title: string; words: string; badge?: string | undefined; children?: ReactNode }) {
  return (
    <RadioGroupOption value={value} disabled={disabled} className="flex-nowrap items-start gap-x-3 rounded-md px-3 py-2 transition-colors hover:bg-accent has-[[data-disabled]]:hover:bg-transparent [&>[data-slot=radio-group-item]]:mt-0.5">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-medium">
          {title}
          {badge !== undefined && <Badge>{badge}</Badge>}
        </span>
        <span className="block text-xs text-muted-foreground">{words}</span>
        {children}
      </span>
    </RadioGroupOption>
  )
}

/** A code or an address to type somewhere else, in mono on a muted strip, with its copy press; `big` for one read from across a room. */
export function CodeStrip({ label, text, big = false, copy }: { label: string; text: string; big?: boolean; copy: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-md bg-muted py-1 pr-1 pl-3">
        <span className={cn('min-w-0 flex-1 truncate font-mono', big ? 'text-xl font-semibold tracking-wider' : 'text-sm')}>{text}</span>
        {copy}
      </div>
    </div>
  )
}
