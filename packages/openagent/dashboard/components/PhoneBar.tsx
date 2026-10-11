import { Menu } from 'lucide-react'
import { Button } from './ui/button.js'
import { useSidebar } from './ui/sidebar.js'

// On a phone the sidebar is closed (AgentHistory), and these two are how a person gets to it. The
// shell draws neither on a wider screen.

/**
 * The button that opens the sidebar over the page. The shell lays it over the top left corner of
 * the page: a page with its own top row (an agent's, the "New agent" page) leaves that corner free,
 * and every other page gets a {@link PhoneBar} to hold it.
 */
export function MenuButton() {
  const { toggleSidebar, openMobile } = useSidebar()
  return (
    <Button variant="ghost" size="icon-sm" className="absolute top-2 left-2 z-10 h-7 w-7" aria-label="Open the menu" aria-expanded={openMobile} onClick={toggleSidebar}>
      <Menu className="h-4 w-4" aria-hidden />
    </Button>
  )
}

/** The top row of a page that has none of its own: the page's name, beside the {@link MenuButton}. */
export function PhoneBar({ title }: { title: string }) {
  return (
    <div className="flex h-11 shrink-0 items-center border-b border-border pr-4 pl-11 text-sm font-medium">
      <span className="truncate">{title}</span>
    </div>
  )
}
