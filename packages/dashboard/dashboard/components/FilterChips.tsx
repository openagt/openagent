import { cn } from '../lib/utils.js'

// A list told apart by one of its fields (what a row needs, how a run ended): a chip for all and
// one per value the list holds, each with how many rows it shows. Drawn only when the list holds
// more than one value: a single chip would pick nothing. The Overview's Human Queue and the Logs
// page use it.

export interface FilterChip<T extends string> {
  value: T
  label: string
  count: number
}

export function FilterChips<T extends string>({ chips, total, picked, onPick, className }: { chips: FilterChip<T>[]; /** How many rows "All" shows. */ total: number; picked: T | null; onPick: (value: T | null) => void; className?: string }) {
  if (chips.length < 2) return null
  return (
    <div role="group" aria-label="Show" className={cn('flex flex-wrap gap-1.5', className)}>
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        on ? 'border-transparent bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  )
}
