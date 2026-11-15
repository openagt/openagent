import { cn } from '../lib/utils.js'
import { MiddleCut } from './MiddleCut.js'

/**
 * A path in a muted mono strip, cut to fit: its folders first, then its last part, the one that
 * names it, in its own middle, so its ending always shows. Whole in its tooltip.
 */
export function PathStrip({ path, className }: { path: string; className?: string }) {
  const cut = path.lastIndexOf('/', path.length - 2)
  const head = cut > 0 ? path.slice(0, cut) : ''
  const tail = cut > 0 ? path.slice(cut) : path
  return (
    <code title={path} className={cn('inline-flex max-w-full min-w-0 rounded-sm bg-muted px-1 align-bottom font-mono text-xs text-foreground', className)}>
      {/* The folders take the whole shortage before the name gives any. */}
      <span className="min-w-0 shrink-[1000000] truncate">{head}</span>
      <MiddleCut text={tail} />
    </code>
  )
}
