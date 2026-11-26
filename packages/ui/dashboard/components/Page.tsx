import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PhoneBarCount } from './PhoneBar.js'
import { ShowSidebarButton } from './SidebarToggle.js'
import { RowShapes } from './ui/slot.js'
import { Waiting } from './Waiting.js'
import { cn } from '../lib/utils.js'

// A page of the dashboard that is no chat (the Overview, and a module's page: Logs, Queue, Tickets,
// Automations): its name, a line saying what it shows, and the page's own buttons at the end of
// that row; under them, what the page shows. The page scrolls as a page (App), its header going up
// with the rest. A phone's bar names the page already (PhoneBar): there the name is said to a
// screen reader only, and the count stands beside the name in the bar.

/**
 * The one column every page that is no chat stands in, 960 at most, centred in what the sidebar
 * leaves: a page's title starts at the same x on every page. What is read in it (a ticket's text)
 * is 720 at most, from its left edge.
 */
export function PageColumn({ children }: { children: ReactNode }) {
  // 32 around it on a wide screen, 24 on a tablet, 16 on a phone.
  return <div className="mx-auto w-full max-w-240 lg:p-8 md:max-lg:p-6 max-md:p-4">{children}</div>
}

/**
 * Where a page's own presses stand (its head's, a part's start, an account to add): on a phone each is a finger's 44 high,
 * whatever size it is drawn at elsewhere, a pair's halves and a count's stepper with it.
 */
export function PagePresses({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('max-md:[&_:is(.h-7,.h-8,.h-9)]:h-11', className)}>{children}</div>
}

/**
 * A page while its code is imported: its name, as this browser listed it, where the page's name
 * will stand (none on a first visit, where it is not known yet), and rows' shapes where its list
 * will stand. The page takes its place without moving its name.
 */
export function PageShape({ title }: { title: string | undefined }) {
  return (
    <Page title={title ?? ''}>
      <Waiting shape={<RowShapes rows={3} />} />
    </Page>
  )
}

export function Page({
  title,
  count,
  description,
  line,
  actions,
  bar,
  children,
}: {
  title: string
  /** Beside the name, in grey: how many the page shows ("14/14"). Seen on a phone too. */
  count?: ReactNode
  description?: ReactNode
  /** In the description's place, what the page's parts say now (the Overview's "2 need you · 1 working"): a phone shows it too, at the left of the buttons' row, wrapping as text beside them, so a part of it that changes its length never moves the buttons to another row. */
  line?: ReactNode
  /** The page's own buttons, at the end of its name's row. */
  actions?: ReactNode
  /** Under the header: a bar of the page's own (the Tickets' filters). */
  bar?: ReactNode
  children: ReactNode
}) {
  const phoneCount = useContext(PhoneBarCount)
  return (
    <PageColumn>
      {count !== undefined && phoneCount !== null && createPortal(count, phoneCount)}
      <header className="mb-6 max-md:mb-4">
        {/* A phone's bar names the page and says its count: there this block shows only the buttons and the line, and is said alone when it has neither, taking no room. */}
        <div className={cn(bar !== undefined && 'mb-3', actions === undefined && line === undefined && 'max-md:sr-only max-md:mb-0')}>
          {/* One row at every width: the name with its count, then the page's buttons at its right. */}
          <div className={cn('flex items-center justify-between gap-4 md:min-h-8 md:items-start', line !== undefined && 'md:flex-wrap md:gap-y-1')}>
            {/* A page's name and its count never give up width: the buttons do. As high as a row of buttons, at the top: where the buttons take two rows, the name stands beside the first, not between them. */}
            <div className="flex shrink-0 items-center gap-2 md:min-h-8">
              {/* While the sidebar is hidden, the button that shows it again stands before the name. */}
              <ShowSidebarButton />
              <h1 className="text-2xl font-semibold tracking-tight">
                <span className="max-md:sr-only">{title}</span>
                {/* A space, not only a margin, so a screen reader says the name and the count apart. */}
                {count !== undefined && phoneCount === null && (
                  <>
                    {' '}
                    {/* A margin from md up only: a module page's stylesheet, loaded after the dashboard's, redefines a plain ml-1 over a max-md:ml-0. */}
                    <span className="text-sm font-normal tabular-nums text-muted-foreground md:ml-1">{count}</span>
                  </>
                )}
              </h1>
            </div>
            {/* The buttons give up width: they go under each other, from the right, when the row is narrower than them, and on a phone a button's words longer than the screen are cut. */}
            {actions !== undefined && <PagePresses className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</PagePresses>}
            {/* Under the row from a tablet up, as the description is; on a phone, where the bar names the page, first in the row. */}
            {line !== undefined && <p className="min-w-0 text-sm text-muted-foreground max-md:order-first max-md:flex-1 md:order-last md:basis-full">{line}</p>}
          </div>
          {/* Under the row, so however long it is, the buttons stay at the name's right. On a phone, where the bar names the page, it is said to a screen reader only. */}
          {/* 8 under the row, so a page's buttons, as tall as the row, never touch it (his report, 2026-11-26). */}
          {description !== undefined && <p className="mt-2 text-sm text-muted-foreground max-md:sr-only">{description}</p>}
        </div>
        {bar}
      </header>
      {children}
    </PageColumn>
  )
}
