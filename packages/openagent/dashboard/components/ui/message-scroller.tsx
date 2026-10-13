import type { ComponentProps } from 'react'
import { ArrowDown } from 'lucide-react'
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from '@shadcn/react/message-scroller'
import { cn } from '../../lib/utils.js'

// shadcn's Base UI `message-scroller`, ported (no components.json here, #712). The behavior —
// follow the live edge, preserve visible rows, anchor on turn boundaries, an inert-when-not-
// scrollable scroll button — lives in the dependency-free @shadcn/react primitive; these are the
// styled wrappers. Adapted from the upstream `bases/base` variant: our own `cn`, a native button
// (our Button is not Base-UI render-ready) rather than `render={<Button/>}`, lucide instead of the
// icon placeholder.
//
// Upstream's viewport also carries `scrollbar-thin` / `scrollbar-thumb-*`, which come from the
// tailwind-scrollbar plugin rather than from shadcn. #914 puts that back as three local utilities
// on plain `scrollbar-width` / `scrollbar-color` / `scrollbar-gutter` (see tailwind.css), so the
// log's bar is toned like the rest of the app instead of being whatever the OS paints.
//
// Upstream's `scroll-fade` on the viewport is not here: an agent's page lays its bars over the
// log's two ends (ChatPane), and each bar carries the fade of its own edge.

// The Provider needs no styling (no data-slot / className), so it is the primitive's directly,
// re-exported for a uniform `message-scroller` import site rather than wrapped for nothing.
export const MessageScrollerProvider = MessageScrollerPrimitive.Provider

export function MessageScroller({ className, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn('group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden', className)}
      {...props}
    />
  )
}

export function MessageScrollerViewport({ className, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn(
        'size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain',
        'scrollbar-thin scrollbar-gutter-stable data-autoscrolling:scrollbar-quiet',
        className,
      )}
      {...props}
    />
  )
}

export function MessageScrollerContent({ className, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn('flex h-max min-h-full flex-col', className)}
      {...props}
    />
  )
}

export function MessageScrollerItem({ className, scrollAnchor = false, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn('min-w-0 shrink-0', className)}
      {...props}
    />
  )
}

export function MessageScrollerButton({ direction = 'end', className, children, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Button>) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      direction={direction}
      className={cn(
        'absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-background/90 px-3 py-1 text-xs text-foreground shadow-sm backdrop-blur transition-[translate,scale,opacity] duration-200 hover:bg-accent',
        'data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0',
        'data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100',
        'data-[direction=end]:bottom-3 data-[direction=end]:data-[active=false]:translate-y-full',
        'data-[direction=start]:top-3 data-[direction=start]:data-[active=false]:-translate-y-full',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          Jump to latest
          <ArrowDown className="size-3.5" aria-hidden />
        </>
      )}
    </MessageScrollerPrimitive.Button>
  )
}

export { useMessageScroller, useMessageScrollerScrollable, useMessageScrollerVisibility }
