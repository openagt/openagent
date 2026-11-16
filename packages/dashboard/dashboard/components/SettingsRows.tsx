import { createContext, useContext, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js'
import { cn } from '../lib/utils.js'
import { DaemonDown } from '../lib/use-daemon-health.js'
import { Skeleton } from './ui/skeleton.js'
import { Switch } from './ui/switch.js'

// Settings' building blocks (#958): an entry's settings, a row, a row picked from a list. The
// dashboard's own entries are made of them, and so is an entry a module brings (`@openagt/dashboard/module`
// exports them), so every entry looks alike.

/**
 * An entry's settings: what they are about as a whole (`description`) and what the entry offers as
 * a whole (`action`, a button) over its rows, 24 apart (ui/look/spacing.md: 44 from row to row with one
 * line, 64 with two). No card and no line between them: the rows stand on the dialog's inset, and the
 * dialog is their frame. The entry's title is Settings' own, over it.
 */
export function SettingsSection({ description, action, children }: { description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-6">
      {(description !== undefined || action !== undefined) && (
        // On a phone the action goes under the words: beside them it squeezes them to a word a line.
        <div className="flex items-start justify-between gap-3 max-sm:flex-col">
          {description !== undefined && <p className="max-w-180 text-sm text-muted-foreground">{description}</p>}
          {action !== undefined && <div className="shrink-0 sm:ml-auto">{action}</div>}
        </div>
      )}
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  )
}

/** Where Settings keeps an entry's presses: under what scrolls, in sight however long the entry is. */
export const SettingsFootContext = createContext<HTMLElement | null>(null)

/** An entry's presses (what is not saved yet, Cancel, Save), at the foot of Settings; elsewhere, where it stands. */
export function SettingsFoot({ children }: { children: ReactNode }) {
  const foot = useContext(SettingsFootContext)
  return foot ? createPortal(children, foot) : children
}

/** One setting: what it is and what it does on the left, its control on the right, centred on the row; on a phone, the control under it. */
export function SettingsRow({
  label,
  description,
  control,
  dimmed = false,
  labelFor,
  stacked = false,
}: {
  label: string
  description: ReactNode
  control: ReactNode
  /** A row the rules turned off: greyed, but still shown with its reason. */
  dimmed?: boolean
  /** The control's `id`: a click on the label works the control. */
  labelFor?: string
  /** A control too wide to stand beside the words (a long row of choices): under them on every screen. */
  stacked?: boolean
}) {
  const named = cn('text-sm font-medium', dimmed && 'text-muted-foreground')
  return (
    // A switch is narrow: it stays beside its label on a phone too.
    <div className={cn('flex justify-between gap-x-6 gap-y-3', stacked ? 'flex-col' : 'items-center max-md:flex-col max-md:items-stretch max-md:has-[[role=switch]]:flex-row max-md:has-[[role=switch]]:items-center')}>
      <div className="min-w-0 max-w-md">
        {labelFor === undefined ? (
          <p className={named}>{label}</p>
        ) : (
          <label htmlFor={labelFor} className={cn('block', !dimmed && 'cursor-pointer', named)}>
            {label}
          </label>
        )}
        <p className="mt-0.5 text-xs text-faint-foreground">{description}</p>
      </div>
      {/* On a phone a press or a field in it is 44 high, under the thumb. */}
      <div className="shrink-0 max-md:[&_button]:h-11 max-md:[&_input]:h-11">{control}</div>
    </div>
  )
}

/** Settings rows while they are read, in their own shape: a {@link Slot}'s `shape`. */
export function SettingsRowShapes({ rows = 2 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: rows }, (_, at) => (
        <div key={at} className="flex items-center justify-between gap-x-6 gap-y-3 max-md:flex-col max-md:items-stretch">
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-8 w-50 max-md:w-full" />
        </div>
      ))}
    </div>
  )
}

export interface SettingsOption {
  value: string
  label: string
  /** A line in the list that says something rather than being a choice. */
  disabled?: boolean
}

/** What stands in for the empty value in the list: a choice whose value is no text ("Auto-detect", an agent's own default) is still a choice to pick. */
const NO_VALUE = '(no value)'

/**
 * One setting picked from a list.
 *
 * A row with nothing to pick renders nothing at all (#1172). An empty list is a control that
 * cannot be operated — it reads as broken rather than as "no choices here", which is exactly the
 * paper cut this guard exists for. Every list on this page has a fixed first entry today ("Auto-detect",
 * the agent's own default), so nothing hits it; it is here because the next list will be added
 * without thinking about the empty case.
 */
export function SettingsSelectRow({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string
  description: ReactNode
  value: string
  options: SettingsOption[]
  onChange: (next: string) => void
}) {
  const down = useContext(DaemonDown)
  if (options.length === 0) return null
  // A saved value the list does not hold (an editor that is no longer found, a list not read yet) is still what is saved: it gets a line of its own, by its text.
  const listed = options.some(o => o.value === value) ? options : [...options, { value, label: value }]
  const items = listed.map(o => ({ value: o.value === '' ? NO_VALUE : o.value, label: o.label, disabled: o.disabled === true }))
  // Only a person's pick is saved. Base UI changes the value on its own too (reason `none`): when the
  // list loses the line it holds, it falls back to the value it was first given, and in 1.9 it does
  // so a render early, still holding the old value when a "Mixed" line leaves a list (#2143).
  const picked = (next: unknown, details: { reason: string }): void => {
    if (details.reason !== 'none') onChange(next === NO_VALUE ? '' : (next as string))
  }
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <Select items={items} value={value === '' ? NO_VALUE : value} onValueChange={picked} disabled={down}>
          <SelectTrigger aria-label={label} className="w-50 bg-card max-md:w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {items.map(item => (
              <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}

/** A setting that is on or off and takes effect at once: a switch, not a box to tick in a form still to be sent. */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  dimmed = disabled,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
  /** A capability the daemon or browser withholds, e.g. notifications the browser has blocked. */
  disabled?: boolean
  /** Greyed while what it needs is off, and still to be switched. */
  dimmed?: boolean
}) {
  const id = useId()
  return (
    <SettingsRow
      label={label}
      description={description}
      dimmed={dimmed}
      labelFor={id}
      control={
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={next => onChange(next === true)}
          aria-label={label}
        />
      }
    />
  )
}
