import { Menu } from '@base-ui/react/menu'
import { ChevronRight, Check } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@openagt/skill-ui/module'
import { ScrollArea } from './scroll-area.js'

// The shadcn "base" dropdown menu (built on Base UI, not Radix) — trimmed to what the Start
// form's Commands + agent/model menus need (#649/#650). Themed with the dashboard's CSS-var tokens
// (there is no --color-popover, so the card surface stands in). Item highlight state is
// `data-highlighted`; an open submenu trigger is `data-popup-open`.

// Border + surface live on the Popup; the scroll (and its padding) move inside a ScrollArea so a
// long menu shows our own thin overlay bar (#1046) instead of the OS one, whose grey track read as
// a second layer beside the border. #710 stands: no native scrollbar comes back.
const POPUP_CLASS =
  'min-w-[13rem] rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-card-foreground)] shadow-md outline-none'

/** The scrolled body every popup shares: caps at the space the positioner allows, pads the items. */
function PopupBody({ children }: { children: ReactNode }) {
  return (
    <ScrollArea viewportClassName="max-h-[var(--available-height)]">
      <div className="p-1">{children}</div>
    </ScrollArea>
  )
}
const ITEM_CLASS =
  'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--color-accent)] data-[highlighted]:text-[var(--color-accent-foreground)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50'

export const DropdownMenu = Menu.Root
export const DropdownMenuGroup = Menu.Group
export const DropdownMenuSub = Menu.SubmenuRoot

// Keep a trigger lit while its menu is open (#1046), matching the hover state Base UI marks it with.
// One place so every menu button (Commands, agent/model, gear, notifications) behaves the same.
const TRIGGER_OPEN_HIGHLIGHT =
  'data-[popup-open]:bg-[var(--color-accent)] data-[popup-open]:text-[var(--color-accent-foreground)]'

export function DropdownMenuTrigger({ className, ...props }: ComponentProps<typeof Menu.Trigger>) {
  return (
    <Menu.Trigger
      className={typeof className === 'function' ? className : cn(TRIGGER_OPEN_HIGHLIGHT, className)}
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
  return (
    <Menu.Portal>
      <Menu.Positioner sideOffset={sideOffset} align={align} className="z-50 outline-none">
        <Menu.Popup className={cn(POPUP_CLASS, className)} {...props}>
          <PopupBody>{children}</PopupBody>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn(ITEM_CLASS, className)} {...props} />
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  // Keep the menu open when toggling, so several options can be flipped in one pass.
  closeOnClick = false,
  ...props
}: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(ITEM_CLASS, className)} closeOnClick={closeOnClick} {...props}>
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
      className={cn(ITEM_CLASS, 'data-[popup-open]:bg-[var(--color-accent)]', className)}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" />
    </Menu.SubmenuTrigger>
  )
}

export function DropdownMenuSubContent({ className, children, ...props }: ComponentProps<typeof Menu.Popup>) {
  return (
    <Menu.Portal>
      <Menu.Positioner side="right" align="start" sideOffset={2} className="z-50 outline-none">
        <Menu.Popup className={cn(POPUP_CLASS, className)} {...props}>
          <PopupBody>{children}</PopupBody>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-[var(--color-border)]', className)} {...props} />
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.GroupLabel>) {
  return (
    <Menu.GroupLabel
      className={cn('px-2 py-1.5 text-xs font-semibold text-[var(--color-muted-foreground)]', className)}
      {...props}
    />
  )
}
