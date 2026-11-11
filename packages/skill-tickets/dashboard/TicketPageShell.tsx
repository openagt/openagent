import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button, ScrollArea, ShowSidebarButton } from '@openagt/dashboard/module'

// The frame both ticket pages sit in (#1144, #685): the way back to the list, then the ticket's
// own content in one scrolling column. A page under a list needs the same way out and the same
// measure wherever it goes, and the two were written out separately — so a change to one left the
// other reading as a different kind of page.

/** What a ticket page shows while its read is in flight, and when there is nothing to show. */
export function TicketPageNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

export function TicketPageShell({
  onBack,
  path,
  children,
}: {
  /** Back to the tickets list. */
  onBack: () => void
  /** The repo-relative file this page renders, shown beside the way back. Omitted where the page's own heading already names it. */
  path?: string | undefined
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The bar holds the content's column, and the way back, first in it, gives back its own padding: the arrow stands above the ticket's title. While the sidebar is hidden, the button that shows it again stands before it. */}
      <div className="border-b border-border py-2">
        <div className="mx-auto flex max-w-3xl items-center gap-2 md:px-6 max-md:px-4">
          <ShowSidebarButton />
          <Button variant="ghost" size="sm" className="gap-1.5 first:-ml-3" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Tickets
          </Button>
          {path && <span className="min-w-0 truncate text-xs text-muted-foreground">{path}</span>}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl md:p-6 max-md:p-4">{children}</div>
      </ScrollArea>
    </div>
  )
}
