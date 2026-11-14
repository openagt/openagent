import { PanelLeft } from 'lucide-react'
import { flushSync } from 'react-dom'
import { Button } from './ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import { useOptionalSidebar, useSidebar } from './ui/sidebar.js'
import { shortcut } from '../lib/shortcut.js'

// The sidebar hidden and shown again, as Claude Code's is: its button in the sidebar's own top row
// hides it, and while it is hidden the same button stands at the start of the page's top row (an
// agent's bar, the "New agent session" page's, a page's header) to show it. Cmd/Ctrl+B does both. A phone's
// sidebar is a sheet, opened by its own button (MenuButton): there the button in its top row closes it.

const SHORTCUT = shortcut('B')

/** In the sidebar's top row: hides it, and on a phone closes its sheet. */
export function HideSidebarButton() {
  const { isMobile, setOpen, setOpenMobile } = useSidebar()
  // A phone's sheet gives the focus back to the button that opened it.
  if (isMobile) return <ToggleButton label="Hide the sidebar" onClick={() => setOpenMobile(false)} />
  return <ToggleButton label="Hide the sidebar" onClick={() => setOpen(false)} focusNext />
}

/** At the start of a page's top row while the sidebar is hidden: shows it again. A page drawn without the shell has no sidebar to show. */
export function ShowSidebarButton() {
  const sidebar = useOptionalSidebar()
  if (!sidebar) return null
  const { isMobile, open, setOpen } = sidebar
  if (isMobile || open) return null
  return <ToggleButton label="Show the sidebar" onClick={() => setOpen(true)} focusNext />
}

function ToggleButton({ label, onClick, focusNext = false }: { label: string; onClick: () => void; focusNext?: boolean }) {
  // The pressed button goes with its press: the one drawn in its place takes the focus.
  const press = (): void => {
    if (!focusNext) return onClick()
    flushSync(onClick)
    document.querySelector<HTMLElement>('[data-sidebar-toggle]')?.focus()
  }
  return (
    <Tooltip>
      {/* A press of 28 whose hit area is 44 on a phone. */}
      <TooltipTrigger render={<Button data-sidebar-toggle variant="ghost" size="icon-sm" className="relative shrink-0 text-muted-foreground max-md:after:absolute max-md:after:-inset-2" aria-label={label} onClick={press} />}>
        <PanelLeft className="h-4 w-4" aria-hidden />
      </TooltipTrigger>
      <TooltipContent>
        {label} <span className="text-muted-foreground">{SHORTCUT}</span>
      </TooltipContent>
    </Tooltip>
  )
}
