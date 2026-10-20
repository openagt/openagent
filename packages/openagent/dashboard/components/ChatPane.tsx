import { useLayoutEffect, useRef, type ReactNode } from 'react'

// An agent's page, laid out as Claude Code on the web lays out a session: the top bar and the
// notices under it (`top`) are the page's first row, and the chat fills the rest, its scroll bar
// at the page's edge from under that row to the page's end. `bottom` is the message box and what
// sits on it (the open questions, the agent's work), and lies over the chat's end.
//
// The room that bar takes is written on the page as `--chat-bottom`, and the chat keeps its last
// row clear of it (EventList). It is written straight to the element as the bar changes its size,
// with no render in between: the chat moves in the same frame as the bar. The bar's height is read
// to the part of a pixel, so its fade starts where it ends. The bar stops short of the scroll bar
// (`--chat-scroll-bar`): its width is read off a probe styled as the chat's scroller is, since a
// scroll bar that lies over the content takes none.
//
// The chat's room is a layer of its own (`isolate`): what the dashboard opens over the page (a
// file's preview, from the Files pane) stays over the message box's bar. And what lies over the
// chat is cut at the room's edges: over a bar as tall as the room (a tall question on a short
// window), the bar's fade stays off the top bar.
export function ChatPane({ top, bottom, children }: { top: ReactNode; bottom: ReactNode; children?: ReactNode }) {
  const pane = useRef<HTMLDivElement>(null)
  const bottomBar = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const read = () => {
      const style = pane.current!.style
      style.setProperty('--chat-bottom', `${bottomBar.current!.getBoundingClientRect().height}px`)
      style.setProperty('--chat-scroll-bar', `${probe.current!.offsetWidth - probe.current!.clientWidth}px`)
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    for (const measured of [bottomBar, probe]) observer.observe(measured.current!)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={pane} data-testid="chat-pane" className="flex min-h-0 flex-1 flex-col">
      <div data-testid="chat-top" className="shrink-0">
        {top}
      </div>
      <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden">
        <div ref={probe} className="scrollbar-thin invisible absolute h-0 w-8 overflow-y-scroll" aria-hidden />
        {children}
        {/* On a window too short for a tall question, the bar scrolls inside itself. */}
        <div ref={bottomBar} data-testid="chat-bottom" className="absolute right-(--chat-scroll-bar) bottom-0 left-0 z-10 max-h-full overflow-y-auto bg-background">
          {bottom}
        </div>
        {/* A short fade at each end, so a row passing out of view is not cut by a straight line. They
            stop short of the scroll bar, and of a strip as wide as one where the scroll bar lies over
            the content and takes no room (a Mac's): there the bar would show up faded at either end. */}
        <div className="pointer-events-none absolute top-0 right-[max(var(--chat-scroll-bar),0.75rem)] left-0 z-10 h-4 bg-gradient-to-b from-background to-transparent" aria-hidden />
        <div className="pointer-events-none absolute right-[max(var(--chat-scroll-bar),0.75rem)] bottom-(--chat-bottom) left-0 z-10 h-4 bg-gradient-to-t from-background to-transparent" aria-hidden />
      </div>
    </div>
  )
}

/** A line in the middle of the room the message box leaves: what an agent's page says while it has no chat to show. */
export function ChatNote({ children }: { children: ReactNode }) {
  return <div className="grid flex-1 place-items-center pb-(--chat-bottom) text-sm text-muted-foreground">{children}</div>
}
