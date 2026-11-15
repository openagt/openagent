import { createContext, useContext, useId, type ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

/** Whether a section stands inside another. */
const Inside = createContext(false)

/** What it holds stands inside a section of its own, whose heading is said elsewhere (a dialog's title): a section in it is a group. */
export function InSection({ children }: { children: ReactNode }) {
  return <Inside.Provider value>{children}</Inside.Provider>
}

/** The heading a part drawn here takes: a page's part is an `h2`, one inside another an `h3`. */
export function useHeadingTag(): 'h2' | 'h3' {
  return useContext(Inside) ? 'h3' : 'h2'
}

/**
 * A part of a page: its heading, how many it holds, a press or a link at the heading's right, then
 * what it holds. No box: the heading and the space before it set it apart. Inside another section
 * its heading is one level down and a size smaller.
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
  const Heading = useHeadingTag()
  const inside = Heading === 'h3'
  return (
    <section aria-labelledby={heading} className={cn('min-w-0', className)}>
      <div className="mb-2 flex items-center gap-3">
        <Heading className={cn('flex min-w-0 flex-1 items-baseline gap-2 font-semibold', inside ? 'text-sm' : 'text-base')}>
          <span id={heading} className="min-w-0 truncate">{title}</span>
          {/* A space, not only the gap, so a screen reader says the heading and the count apart. */}
          {count !== undefined && (
            <>
              {' '}
              <span className="shrink-0 text-sm font-normal tabular-nums text-muted-foreground">{count}</span>
            </>
          )}
        </Heading>
        {action !== undefined && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      <Inside.Provider value>{children}</Inside.Provider>
    </section>
  )
}
