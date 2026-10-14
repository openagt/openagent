import type { ComponentProps } from 'react'
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui-components/react/scroll-area'
import { cn } from '../../lib/utils.js'

// shadcn's Base UI `scroll-area`, ported (#913) the same way `message-scroller` was (#712): there is
// no components.json here, so upstream's `cn-scroll-area-*` classes — a stylesheet of `@apply` in
// their registry — are inlined on the parts instead, and the focus ring uses our own token.
//
// Why a component rather than styling the native bar: the OS paints an overlay scrollbar that hides
// itself, so a rail gives no hint that it holds more than it shows. This one belongs to the layout —
// always there while the content overflows, darkening under the pointer. Its tone is
// `muted-foreground`, not `border`: a border-toned thumb disappears into the dark canvas.
//
// #710 still stands for everything not converted: no `::-webkit-scrollbar` rule comes back.
//
// The scrollbar unmounts when the content fits, so a short list has no bar at all.
//
// Vertical only: nothing here scrolls sideways, and upstream's horizontal branch would ship
// untested. Add it with its first use.

export function ScrollArea({
  className,
  children,
  viewportClassName,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  /** Extra classes on the viewport — where the height cap belongs when the Root has no definite
   *  height. A `max-h-*` on the Root only caps the box; the viewport's `h-full` cannot resolve
   *  against a parent's max-height, so the content grows instead of scrolling. Put the cap here. */
  viewportClassName?: string
}) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn('relative', className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          // No focus ring on the viewport: a scroll region is not a control, and the ring painted a
          // green box down the sidebar edge whenever it took focus. Keep it focusable for keyboard
          // scrolling, just without the outline.
          'w-full rounded-[inherit] outline-none',
          // Default: fill a definite-height Root. A caller that caps the viewport (a dropdown, the
          // editor) passes its own `max-h-*` here instead of relying on the Root.
          viewportClassName ?? 'h-full',
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({ className, ...props }: ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation="vertical"
      className={cn('flex h-full w-2.5 touch-none select-none border-l border-l-transparent p-px', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-muted-foreground/40 transition-colors hover:bg-muted-foreground/70"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}
