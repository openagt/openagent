import { cn } from '../lib/utils.js'

// A list told apart by one of its fields (how a run ended): a word for all and one per value the
// list holds, each with how many rows it shows, the picked one underlined. Drawn only when the list
// holds more than one value: a single word would pick nothing. The Logs page uses it.

export interface FilterChip<T extends string> {
  value: T
  label: string
  count: number
}

export function FilterChips<T extends string>({ chips, total, picked, onPick, className }: { chips: FilterChip<T>[]; /** How many rows "All" shows. */ total: number; picked: T | null; onPick: (value: T | null) => void; className?: string }) {
  if (chips.length < 2) return null
  return (
    <div role="group" aria-label="Show" className={cn('flex flex-wrap gap-x-6', className)}>
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
        'focus-ring flex h-8 items-center gap-1.5 rounded-t-sm border-b-2 text-sm font-medium transition-colors max-md:h-11',
        on ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      <span className="text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
    </button>
  )
}
