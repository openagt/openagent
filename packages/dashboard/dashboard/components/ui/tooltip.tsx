'use client'
import { createContext, useContext, useRef, type ComponentProps, type RefObject } from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '../../lib/utils.js'
import { POPUP_MOTION_CLASS, usePopupPlacement } from './popup-placement.js'

// A trimmed shadcn-style Tooltip on Base UI (already a dep across the ui/ kit — no Radix pulled
// in). Per item:
//   <Tooltip><TooltipTrigger render={<Button …/>}>…</TooltipTrigger><TooltipContent>Label</TooltipContent></Tooltip>
const TooltipProvider = TooltipPrimitive.Provider

/**
 * The box a row of items stands in, at its foot (the message box's last line): an item's tooltip
 * opens past the box's edge, under it or, with no room there, over it, its left edge on the item's.
 * Opened from the item itself it would lie over the text being typed, or the items beside it.
 */
const PastBox = createContext<RefObject<HTMLElement | null> | null>(null)
export const TooltipsPastBox = PastBox.Provider

/** Each tooltip's trigger, for its content to stand by. */
const TriggerOf = createContext<RefObject<HTMLElement | null> | null>(null)

function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  const trigger = useRef<HTMLElement | null>(null)
  return (
    <TriggerOf.Provider value={trigger}>
      <TooltipPrimitive.Root {...props} />
    </TriggerOf.Provider>
  )
}

// A tooltip opens 400ms after the pointer comes to rest, and the next one at once while the last is
// open or just closed: the pointer passing over the page lights nothing, and moving along a row of
// icons reads each one. The "at once" is the one
// <TooltipProvider> around the app (AppFrame.tsx), whose tooltips are one group.
function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const trigger = useContext(TriggerOf)
  return (
    <TooltipPrimitive.Trigger
      delay={400}
      ref={(item: HTMLElement | null) => {
        if (trigger) trigger.current = item
      }}
      {...props}
    />
  )
}

/** Where a tooltip in a box's row stands: an anchor as wide as its item and as tall as the box. */
function pastBox(box: RefObject<HTMLElement | null>, trigger: RefObject<HTMLElement | null>) {
  return () => {
    const item = trigger.current
    if (!box.current || !item) return item
    return {
      contextElement: item,
      getBoundingClientRect: () => {
        const edges = box.current!.getBoundingClientRect()
        const { x, width } = item.getBoundingClientRect()
        return DOMRect.fromRect({ x, width, y: edges.y, height: edges.height })
      },
    }
  }
}

function TooltipContent({
  className,
  sideOffset = 6,
  side,
  align,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Popup> & {
  sideOffset?: number
  side?: ComponentProps<typeof TooltipPrimitive.Positioner>['side']
  align?: ComponentProps<typeof TooltipPrimitive.Positioner>['align']
}) {
  const positionMethod = usePopupPlacement()
  const box = useContext(PastBox)
  const trigger = useContext(TriggerOf)
  const placement = box && trigger ? { anchor: pastBox(box, trigger), side: 'bottom' as const, align: 'start' as const } : { ...(side ? { side } : {}), ...(align ? { align } : {}) }
  return (
    <TooltipPrimitive.Portal>
      {/* The stacking layer belongs here, on the positioned element (#1506). It used to sit on the
          popup below, which Base UI leaves `position: static` — where a z-index does nothing at
          all. A tooltip opened over a menu or a popover, both of which carry theirs on their own
          positioner, was painted *behind* it: the preset hints in the launcher's menu rendered
          with the right words and were covered by the very menu that triggered them. */}
      <TooltipPrimitive.Positioner
        positionMethod={positionMethod}
        className="z-50"
        sideOffset={sideOffset}
        {...placement}
      >
        <TooltipPrimitive.Popup
          data-overlay="hint"
          // Base UI leaves the popup unlabelled (it treats a tooltip as a supplement to the
          // trigger's own accessible name, which every trigger here has). The role costs nothing
          // and names the popup for assistive tech and for tests, which is how they read it now
          // that no element carries a `title`.
          role="tooltip"
          className={cn(
            'rounded-md border border-hairline bg-card px-2 py-1 text-xs text-card-foreground shadow-lg',
            POPUP_MOTION_CLASS,
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
