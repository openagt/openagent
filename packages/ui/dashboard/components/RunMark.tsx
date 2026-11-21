import { runCell } from '../lib/run-words.js'
import { StateCell } from './ui/state.js'

/**
 * A run's state as its mark: the one drawing of it, the look's hexagon in the state of work the run
 * is in, 14 square unless `className` sizes it. Given a `label`, the mark carries the word for a
 * reader who cannot see it.
 */
export function RunMark({ status, label, className }: { status: string; label?: string | undefined; className?: string | undefined }) {
  const cell = <StateCell state={runCell(status)} className={className} />
  return label !== undefined ? (
    <span role="img" aria-label={label} data-state={runCell(status)} className="inline-flex shrink-0">
      {cell}
    </span>
  ) : (
    cell
  )
}
