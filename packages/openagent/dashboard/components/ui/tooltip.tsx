'use client'
import type { ComponentProps } from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '../../lib/utils.js'

// A trimmed shadcn-style Tooltip on Base UI (already a dep across the ui/ kit — no Radix pulled
// in). Per item:
//   <Tooltip><TooltipTrigger render={<Button …/>}>…</TooltipTrigger><TooltipContent>Label</TooltipContent></Tooltip>
const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root

// A tooltip opens 300ms after the pointer comes to rest, and the next one at once while the last is
// open or just closed, as Claude Code on the web's do: the pointer passing over the page lights
// nothing, and moving along a row of icons reads each one. The "at once" is the one
// <TooltipProvider> around the app (AppFrame.tsx), whose tooltips are one group.
function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger delay={300} {...props} />
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
  return (
    <TooltipPrimitive.Portal>
      {/* The stacking layer belongs here, on the positioned element (#1506). It used to sit on the
          popup below, which Base UI leaves `position: static` — where a z-index does nothing at
          all. A tooltip opened over a menu or a popover, both of which carry theirs on their own
          positioner, was painted *behind* it: the preset hints in the launcher's menu rendered
          with the right words and were covered by the very menu that triggered them. */}
      <TooltipPrimitive.Positioner
        className="z-50"
        sideOffset={sideOffset}
        {...(side ? { side } : {})}
        {...(align ? { align } : {})}
      >
        <TooltipPrimitive.Popup
          // Base UI leaves the popup unlabelled (it treats a tooltip as a supplement to the
          // trigger's own accessible name, which every trigger here has). The role costs nothing
          // and names the popup for assistive tech and for tests, which is how they read it now
          // that no element carries a `title`.
          role="tooltip"
          className={cn(
            'rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground shadow-md',
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
