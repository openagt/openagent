import { Menu } from '@base-ui/react/menu'
import { ChevronRight, Check } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'
import { ScrollArea } from './scroll-area.js'
import { usePopupPlacement } from './popup-placement.js'

// The shadcn "base" dropdown menu (built on Base UI, not Radix) — trimmed to what the Start
// form's Commands + agent/model menus need (#649/#650). On the menu surface, which sets the theme's
// tokens again for what is inside it (`.menu-surface`), so the items read them with the plain
// utilities (`bg-accent`), never `var(--color-*)`, which holds the page's value. Item highlight
// state is `data-highlighted`; an open submenu trigger is `data-popup-open`.

// Border + surface live on the Popup; the scroll (and its padding) move inside a ScrollArea so a
// long menu shows our own thin overlay bar (#1046) instead of the OS one, whose grey track read as
// a second layer beside the border. #710 stands: no native scrollbar comes back.
// The surface is shadcn create's menu in the theme's colours (`.menu-surface`, tailwind.css):
// rounded, see-through over a blur, a faint ring for an edge.
export const MENU_SURFACE_CLASS = 'menu-surface rounded-xl shadow-lg ring-1 ring-foreground/10 backdrop-blur-xl outline-none'
export const MENU_POPUP_CLASS = cn('min-w-[13rem]', MENU_SURFACE_CLASS)

/** The scrolled body every popup shares: caps at the space the positioner allows, pads the items. */
function PopupBody({ children }: { children: ReactNode }) {
  return (
    <ScrollArea viewportClassName="max-h-[var(--available-height)]">
      <div className="p-1.5">{children}</div>
    </ScrollArea>
  )
}
export const MENU_ITEM_CLASS =
  'relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50'

export const DropdownMenu = Menu.Root
export const DropdownMenuGroup = Menu.Group
export const DropdownMenuSub = Menu.SubmenuRoot

// Keep a trigger lit while its menu is open (#1046), matching the hover state Base UI marks it with.
// One place so every menu button (Commands, agent/model, gear, notifications) behaves the same.
export const MENU_TRIGGER_OPEN_CLASS =
  'data-[popup-open]:bg-[var(--color-accent)] data-[popup-open]:text-[var(--color-accent-foreground)]'

export function DropdownMenuTrigger({ className, ...props }: ComponentProps<typeof Menu.Trigger>) {
  return (
    <Menu.Trigger
      className={typeof className === 'function' ? className : cn(MENU_TRIGGER_OPEN_CLASS, className)}
      {...props}
    />
  )
}

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'start',
  children,
  ...props
}: ComponentProps<typeof Menu.Popup> & { sideOffset?: number; align?: 'start' | 'center' | 'end' }) {
  const positionMethod = usePopupPlacement()
  return (
    <Menu.Portal>
      <Menu.Positioner positionMethod={positionMethod} sideOffset={sideOffset} align={align} className="z-50 outline-none">
        <Menu.Popup className={cn(MENU_POPUP_CLASS, className)} {...props}>
          <PopupBody>{children}</PopupBody>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn(MENU_ITEM_CLASS, className)} {...props} />
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  // Keep the menu open when toggling, so several options can be flipped in one pass.
  closeOnClick = false,
  ...props
}: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(MENU_ITEM_CLASS, className)} closeOnClick={closeOnClick} {...props}>
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <Menu.CheckboxItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </Menu.CheckboxItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  )
}

export function DropdownMenuSubTrigger({ className, children, ...props }: ComponentProps<typeof Menu.SubmenuTrigger>) {
  return (
    // The chevron is pushed to the end by its own `ml-auto`, not by `justify-between` on the row.
    // Justifying the row spaces out *every* child, so a trigger whose label is plain text had it
    // centred between the icon and the chevron while every ordinary item sat left, and the only
    // way to sit straight was to remember a `flex-1` wrapper. Now both forms align the same.
    <Menu.SubmenuTrigger
      className={cn(MENU_ITEM_CLASS, 'data-[popup-open]:bg-accent', className)}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" />
    </Menu.SubmenuTrigger>
  )
}

export function DropdownMenuSubContent({ className, children, ...props }: ComponentProps<typeof Menu.Popup>) {
  const positionMethod = usePopupPlacement()
  return (
    <Menu.Portal>
      <Menu.Positioner positionMethod={positionMethod} side="right" align="start" sideOffset={2} className="z-50 outline-none">
        <Menu.Popup className={cn(MENU_POPUP_CLASS, className)} {...props}>
          <PopupBody>{children}</PopupBody>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1.5 my-1.5 h-px bg-border', className)} {...props} />
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.GroupLabel>) {
  return (
    <Menu.GroupLabel
      className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)}
      {...props}
    />
  )
}
