import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

/**
 * A part of a page: its heading, how many it holds, a press or a link at the heading's right, then
 * what it holds. No box: the heading and the space before it set it apart.
 */
export function Section({ title, count, action, className, children }: {
  title: ReactNode
  /** Beside the heading, quieter: how many it holds ("3 runs"). */
  count?: ReactNode
  /** At the heading's right: the section's own press, or a link to its page. */
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  // Named by its heading's words alone, not the count beside them.
  const heading = useId()
  return (
    <section aria-labelledby={heading} className={cn('min-w-0', className)}>
      <div className="mb-2 flex min-h-8 items-center gap-3">
        <h2 className="flex min-w-0 flex-1 items-baseline gap-2 text-base font-semibold">
          <span id={heading} className="min-w-0 truncate">{title}</span>
          {/* A space, not only the gap, so a screen reader says the heading and the count apart. */}
          {count !== undefined && (
            <>
              {' '}
              <span className="shrink-0 text-sm font-normal tabular-nums text-muted-foreground">{count}</span>
            </>
          )}
        </h2>
        {action !== undefined && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  )
}
