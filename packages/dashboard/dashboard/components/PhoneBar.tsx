import { createContext } from 'react'
import { Menu } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { useSidebar } from './ui/sidebar.js'

// On a phone the sidebar is closed (AgentHistory), and these two are how a person gets to it. The
// shell draws neither on a wider screen.

/**
 * The button that opens the sidebar over the page. The shell lays it over the top left corner of
 * the page: a page with its own top row (an agent's, the "New agent session" page) leaves that corner free,
 * and every other page gets a {@link PhoneBar} to hold it.
 */
export function MenuButton({ inBar = false }: { inBar?: boolean }) {
  const { toggleSidebar, openMobile } = useSidebar()
  return (
    // In the bar of a page that scrolls as a page, so the two move as one when the phone bounces at the top.
    // A press of 28 whose hit area is 44, a finger's.
    <Button variant="ghost" size="icon-bar" className={cn('z-10', inBar ? 'shrink-0' : 'absolute top-2 left-2')} aria-label="Open the menu" aria-expanded={openMobile} onClick={toggleSidebar}>
      <Menu className="h-4 w-4" aria-hidden />
    </Button>
  )
}

/** Where a page's count is drawn while a {@link PhoneBar} names the page: beside that name. None where no bar is drawn. */
export const PhoneBarCount = createContext<HTMLElement | null>(null)

/**
 * The top row of a page that has none of its own: the {@link MenuButton}, the page's name and the
 * page's count, which the page draws into `countSlot`. It stays at the top as the page scrolls.
 */
export function PhoneBar({ title, countSlot }: { title: string; countSlot: (slot: HTMLElement | null) => void }) {
  return (
    <div className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background pr-4 pl-2 text-sm font-medium">
      <MenuButton inBar />
      <span className="truncate">{title}</span>
      <span ref={countSlot} className="shrink-0 font-normal tabular-nums text-muted-foreground empty:hidden" />
    </div>
  )
}
