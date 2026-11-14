import { cn } from '../lib/utils.js'

/**
 * A path in a muted mono strip, cut in its middle when it does not fit: the last part, the one that
 * names it, always shows. Whole in its tooltip.
 */
export function PathStrip({ path, className }: { path: string; className?: string }) {
  const cut = path.lastIndexOf('/', path.length - 2)
  const head = cut > 0 ? path.slice(0, cut) : ''
  const tail = cut > 0 ? path.slice(cut) : path
  return (
    <code title={path} className={cn('inline-flex max-w-full min-w-0 rounded-sm bg-muted px-1 align-bottom font-mono text-xs text-foreground', className)}>
      <span className="truncate">{head}</span>
      <span className="shrink-0 whitespace-pre">{tail}</span>
    </code>
  )
}
