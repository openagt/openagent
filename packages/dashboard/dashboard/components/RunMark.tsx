import { runMark } from '../lib/run-words.js'
import { cn } from '../lib/utils.js'

/**
 * A run's state as its mark: the one drawing of it, a dot while something goes on, a ring once
 * nothing does. Given a `label`, the mark carries the word for a reader who cannot see it.
 */
export function RunMark({ status, label, className }: { status: string; label?: string | undefined; className?: string | undefined }) {
  return <span {...(label !== undefined ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} className={cn('shrink-0 rounded-full', runMark(status), className)} />
}
