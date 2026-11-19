import { cn } from '../lib/utils.js'

// A list told apart by one of its fields (how a run ended): a word for all and one per value the
// list holds, each with how many rows it shows, as one segmented control whose picked segment is a
// card on its sunk track. Drawn only when the list holds more than one value: a single word would
// pick nothing. The Logs page uses it.

export interface FilterChip<T extends string> {
  value: T
  label: string
  count: number
}

export function FilterChips<T extends string>({ chips, total, picked, onPick, className }: { chips: FilterChip<T>[]; /** How many rows "All" shows. */ total: number; picked: T | null; onPick: (value: T | null) => void; className?: string }) {
  if (chips.length < 2) return null
  return (
    // On a phone the track scrolls sideways rather than wrap: a second row of segments reads as a second control.
    <div role="group" aria-label="Show" className={cn('inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-accent p-0.5 [scrollbar-width:none]', className)}>
      <Chip on={picked === null} onClick={() => onPick(null)} label="All" count={total} />
      {chips.map(chip => (
        <Chip key={chip.value} on={picked === chip.value} onClick={() => onPick(chip.value)} label={chip.label} count={chip.count} />
      ))}
    </div>
  )
}

function Chip({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'focus-ring flex h-7 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] max-md:h-10',
        on ? 'bg-card text-foreground shadow-sm ring-1 ring-hairline' : 'text-muted-foreground hover:text-foreground active:bg-foreground/5',
      )}
    >
      {label}
      <span className="font-normal tabular-nums text-faint-foreground">{count}</span>
    </button>
  )
}
