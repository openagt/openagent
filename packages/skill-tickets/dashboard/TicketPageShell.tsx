import { Fragment, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { ShowSidebarButton, Skeleton } from '@openagt/dashboard/module'

// The frame every page under the tickets list sits in (#1144, #685): the breadcrumb back to the
// list, then the page's own content in one column. A page under a list needs the same way
// out and the same measure wherever it goes, and the two were written out separately — so a change
// to one left the other reading as a different kind of page.

/** What a ticket page shows while its read is in flight, and when there is nothing to show. */
export function TicketPageNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

/** A ticket's page while it is read, in its own shape: the title, the line of facts, the tabs, the text. A `Slot`'s `shape`. */
export function TicketPageShape() {
  return (
    <div>
      <Skeleton className="h-7 w-1/2" />
      <Skeleton className="mt-2 h-4 w-1/4" />
      <Skeleton className="mt-6 h-9 w-32" />
      <div className="mt-6 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  )
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
  const step = 'focus-ring min-w-0 truncate rounded-sm hover:text-foreground hover:underline'
  return (
    // A page read rather than scanned: the narrow column of a page (`Page`'s reading width), with 32 around it on a wide screen.
    <div className="mx-auto w-full max-w-180 lg:p-8 md:max-lg:p-6 max-md:p-4">
      {/* While the sidebar is hidden, the button that shows it again stands first. */}
      <nav aria-label="Breadcrumb" className="mb-3 flex min-h-7 items-center gap-1.5 text-xs text-muted-foreground">
        <ShowSidebarButton />
        <button type="button" className={`${step} shrink-0`} onClick={onBack}>
          Tickets
        </button>
        {crumbs.map((crumb, at) => (
          <Fragment key={at}>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden />
            {crumb.onOpen && at < crumbs.length - 1 ? (
              <button type="button" className={step} onClick={crumb.onOpen}>
                {crumb.label}
              </button>
            ) : (
              <span className="min-w-0 truncate" aria-current="page">
                {crumb.label}
              </span>
            )}
          </Fragment>
        ))}
      </nav>
      {children}
    </div>
  )
}
