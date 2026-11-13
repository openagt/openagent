import { Fragment, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { ScrollArea, ShowSidebarButton } from '@openagt/dashboard/module'

// The frame every page under the tickets list sits in (#1144, #685): the breadcrumb back to the
// list, then the page's own content in one scrolling column. A page under a list needs the same way
// out and the same measure wherever it goes, and the two were written out separately — so a change
// to one left the other reading as a different kind of page.

/** What a ticket page shows while its read is in flight, and when there is nothing to show. */
export function TicketPageNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

/** One step of the breadcrumb after "Tickets": a page that opens, or, last, the page itself. */
export interface Crumb {
  label: string
  onOpen?: (() => void) | undefined
}

export function TicketPageShell({
  onBack,
  crumbs = [],
  children,
}: {
  /** Back to the tickets list, as it was left: the breadcrumb's first step. */
  onBack: () => void
  /** The steps after "Tickets", down to this page. */
  crumbs?: readonly Crumb[]
  children: ReactNode
}) {
  const step = 'min-w-0 truncate rounded px-1 py-0.5 hover:bg-accent hover:text-foreground'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The bar holds the content's column; while the sidebar is hidden, the button that shows it again stands first in it. */}
      <div className="border-b border-border py-2">
        <nav aria-label="Breadcrumb" className="mx-auto flex max-w-3xl items-center gap-1 text-sm text-muted-foreground md:px-6 max-md:px-4">
          <ShowSidebarButton />
          <button type="button" className={`${step} -ml-1 shrink-0`} onClick={onBack}>
            Tickets
          </button>
          {crumbs.map((crumb, at) => (
            <Fragment key={at}>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
              {crumb.onOpen && at < crumbs.length - 1 ? (
                <button type="button" className={step} onClick={crumb.onOpen}>
                  {crumb.label}
                </button>
              ) : (
                <span className="min-w-0 truncate px-1 text-foreground" aria-current="page">
                  {crumb.label}
                </span>
              )}
            </Fragment>
          ))}
        </nav>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl md:p-6 max-md:p-4">{children}</div>
      </ScrollArea>
    </div>
  )
}
