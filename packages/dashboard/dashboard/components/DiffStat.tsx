import { cn } from '../lib/utils.js'

// A change's size as the `+12 −3` pair, the one way the dashboard says it: in a run's handoff and,
// through `@openagt/dashboard/module`, wherever a module shows a change.

/**
 * Added/removed counts as the `+12 −3` pair. A count of nothing is left out, so a change that only
 * adds reads `+12` — except where the pair is a chip of its own (`zeros`), as the bar above the
 * message box has one: there both numbers are always there, as Claude Code on the web writes them,
 * and a chip that changed width with every commit would make the bar jump.
 */
export function DiffStat({ added, removed, className, zeros = false }: { added: number; removed: number; className?: string; zeros?: boolean }) {
  const shown = (count: number) => zeros || count > 0
  return (
    <span className={cn('shrink-0 font-mono text-[10px] tabular-nums', className)}>
      <span aria-hidden>
        {shown(added) && <span className="text-success">+{added}</span>}
        {shown(added) && shown(removed) && ' '}
        {shown(removed) && <span className="text-danger">−{removed}</span>}
      </span>
      <span className="sr-only">{inWords(added, removed, shown)}</span>
    </span>
  )
}

/** The pair as a screen reader says it: `+12 −3` is "12 lines added, 3 removed", `+1 −0` "1 line added, none removed". */
function inWords(added: number, removed: number, shown: (count: number) => boolean): string {
  const lines = (count: number) => `${count} line${count === 1 ? '' : 's'}`
  const said = [
    shown(added) && (added > 0 ? `${lines(added)} added` : 'none added'),
    shown(removed) && (removed === 0 ? 'none removed' : added > 0 ? `${removed} removed` : `${lines(removed)} removed`),
  ]
  return said.filter(Boolean).join(', ')
}
