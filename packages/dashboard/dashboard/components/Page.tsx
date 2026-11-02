import type { ReactNode } from 'react'
import { ShowSidebarButton } from './SidebarToggle.js'

// A page of the dashboard that is no chat (the Overview, and a module's page: Logs, Queue, Tickets,
// Automations): its name, a line saying what it shows, and the page's own buttons at the end of
// that row; under them, what the page shows. Every page has the same column, centered, as wide as
// the Overview's cards always were. The page scrolls as a page (App), its header going up with the
// rest. A phone's bar names the page already (PhoneBar): there the name is said to a screen reader
// only.
export function Page({
  title,
  count,
  description,
  actions,
  bar,
  children,
}: {
  title: string
  /** Beside the name, in grey: how many the page shows ("14/14"). Seen on a phone too. */
  count?: ReactNode
  description?: ReactNode
  /** The page's own buttons, at the end of its name's row. */
  actions?: ReactNode
  /** Under the header: a bar of the page's own (the Tickets' filters). */
  bar?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-6xl p-6 max-md:p-4">
      <header className="mb-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-start gap-2">
            {/* While the sidebar is hidden, the button that shows it again stands before the name. */}
            <ShowSidebarButton />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">
                <span className="max-md:sr-only">{title}</span>
                {count !== undefined && <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground max-md:ml-0">{count}</span>}
              </h1>
              {description !== undefined && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
          </div>
          {/* On a phone a button's words are longer than the screen: the buttons give up width, and their words are cut. */}
          {actions !== undefined && <div className="flex flex-wrap items-center justify-end gap-2 md:shrink-0 max-md:min-w-0">{actions}</div>}
        </div>
        {bar}
      </header>
      {children}
    </div>
  )
}
