import type { ReactNode } from 'react'
import { ShowSidebarButton } from './SidebarToggle.js'
import { cn } from '../lib/utils.js'

// A page of the dashboard that is no chat (the Overview, and a module's page: Logs, Queue, Tickets,
// Automations): its name, a line saying what it shows, and the page's own buttons at the end of
// that row; under them, what the page shows. Every page is a column centred in what the sidebar
// leaves: 960 for a list or a settings page, 720 for reading, 1120 for the Overview. The page
// scrolls as a page (App), its header going up with the rest. A phone's bar names the page already
// (PhoneBar): there the name is said to a screen reader only.

/** How wide a page's column is at most: `list` 960, `reading` 720, `wide` 1120. */
export type PageWidth = 'list' | 'reading' | 'wide'

const WIDTHS: Record<PageWidth, string> = { list: 'max-w-240', reading: 'max-w-180', wide: 'max-w-280' }

export function Page({
  title,
  count,
  description,
  actions,
  bar,
  width = 'list',
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
  /** How wide its column is at most; a list's, 960, unless said. */
  width?: PageWidth | undefined
  children: ReactNode
}) {
  return (
    // 32 around it on a wide screen, 24 on a tablet, 16 on a phone.
    <div className={cn('mx-auto w-full lg:p-8 md:max-lg:p-6 max-md:p-4', WIDTHS[width])}>
      <header className="mb-6 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-start gap-2">
            {/* While the sidebar is hidden, the button that shows it again stands before the name. */}
            <ShowSidebarButton />
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">
                <span className="max-md:sr-only">{title}</span>
                {/* A space, not only a margin, so a screen reader says the name and the count apart. */}
                {count !== undefined && (
                  <>
                    {' '}
                    {/* A margin from md up only: a module page's stylesheet, loaded after the dashboard's, redefines a plain ml-1 over a max-md:ml-0. */}
                    <span className="text-sm font-normal tabular-nums text-muted-foreground md:ml-1">{count}</span>
                  </>
                )}
              </h1>
              {description !== undefined && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
          </div>
          {/* The buttons give up width: they go under each other when the column is narrower than them, and on a phone a button's words longer than the screen are cut. */}
          {actions !== undefined && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {bar}
      </header>
      {children}
    </div>
  )
}
