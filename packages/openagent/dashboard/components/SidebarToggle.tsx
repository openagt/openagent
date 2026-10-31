import { PanelLeft } from 'lucide-react'
import { Button } from '@openagt/skill-ui/module'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import { useOptionalSidebar, useSidebar } from './ui/sidebar.js'

// The sidebar hidden and shown again, as Claude Code's is: its button in the sidebar's own top row
// hides it, and while it is hidden the same button stands at the start of the page's top row (an
// agent's bar, the "New agent" page's, a page's header) to show it. Cmd/Ctrl+B does both. A phone's
// sidebar is a sheet, opened by its own button (MenuButton): there neither is drawn.

const SHORTCUT = navigator.platform.startsWith('Mac') ? '⌘B' : 'Ctrl+B'

/** In the sidebar's top row: hides it. */
export function HideSidebarButton() {
  const { isMobile, setOpen } = useSidebar()
  if (isMobile) return null
  return <ToggleButton label="Hide the sidebar" onClick={() => setOpen(false)} />
}

/** At the start of a page's top row while the sidebar is hidden: shows it again. A page drawn without the shell has no sidebar to show. */
export function ShowSidebarButton() {
  const sidebar = useOptionalSidebar()
  if (!sidebar) return null
  const { isMobile, open, setOpen } = sidebar
  if (isMobile || open) return null
  return <ToggleButton label="Show the sidebar" onClick={() => setOpen(true)} />
}

function ToggleButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label={label} onClick={onClick} />}>
        <PanelLeft className="h-4 w-4" aria-hidden />
      </TooltipTrigger>
      <TooltipContent>
        {label} <span className="text-muted-foreground">{SHORTCUT}</span>
      </TooltipContent>
    </Tooltip>
  )
}
