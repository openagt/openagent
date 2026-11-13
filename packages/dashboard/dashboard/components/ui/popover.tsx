import { Popover as BasePopover } from '@base-ui/react/popover'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'
import { ScrollArea } from './scroll-area.js'
import { POPUP_MOTION_CLASS, usePopupPlacement } from './popup-placement.js'

// The shadcn "base" popover (Base UI, not Radix) — the floating panel for rich content a menu can't
// hold, like a ticket filter facet's panel. Same surface as the
// dropdown menu (border + card + shadow on the Popup, the body scrolls through our ScrollArea), and
// the trigger stays lit while open via `data-popup-open`, matching the menus.

const TRIGGER_OPEN_HIGHLIGHT =
  'data-[popup-open]:bg-[var(--color-accent)] data-[popup-open]:text-[var(--color-accent-foreground)]'

export const Popover = BasePopover.Root

export function PopoverTrigger({ className, ...props }: ComponentProps<typeof BasePopover.Trigger>) {
  return (
    <BasePopover.Trigger
      className={typeof className === 'function' ? className : cn(TRIGGER_OPEN_HIGHLIGHT, className)}
      {...props}
    />
  )
}

export function PopoverContent({
  className,
  sideOffset = 6,
  align = 'start',
  children,
  ...props
}: ComponentProps<typeof BasePopover.Popup> & { sideOffset?: number; align?: 'start' | 'center' | 'end' }) {
  const positionMethod = usePopupPlacement()
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner positionMethod={positionMethod} sideOffset={sideOffset} align={align} className="z-50 outline-none">
        <BasePopover.Popup
          className={cn(
            'rounded-lg border border-hairline bg-card text-card-foreground shadow-lg outline-none',
            POPUP_MOTION_CLASS,
            className,
          )}
          {...props}
        >
          <ScrollArea viewportClassName="max-h-[var(--available-height)]">
            <div className="p-3">{children as ReactNode}</div>
          </ScrollArea>
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}
