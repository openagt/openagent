import { useLayoutEffect, useRef, type ReactNode } from 'react'

// An agent's page, laid out as Claude Code on the web lays out a session: the chat scrolls over
// the page's whole height, its scroll bar at the page's edge from top to bottom, and the page's two
// bars lie over it. `top` is the top bar and the notices under it; `bottom` is the message box and
// what sits on it (the open questions, the agent's work).
//
// The room each bar takes is written on the page as `--chat-top` and `--chat-bottom`, and the chat
// keeps its first and its last row clear of them (EventList). They are written straight to the
// element as a bar changes its size, with no render in between: the chat moves in the same frame
// as the bar. A bar's height is read to the part of a pixel, so its fade starts where it ends. The
// bars stop short of the scroll bar (`--chat-scroll-bar`): its width is read off a probe styled as
// the chat's scroller is, since a scroll bar that lies over the content takes none.
//
// The page is a layer of its own (`isolate`): what the shell lays over its corners (the menu's
// button on a phone, the side panel's) stays over the bars.
export function ChatPane({ top, bottom, children }: { top: ReactNode; bottom: ReactNode; children?: ReactNode }) {
  const pane = useRef<HTMLDivElement>(null)
  const topBar = useRef<HTMLDivElement>(null)
  const bottomBar = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const read = () => {
      const style = pane.current!.style
      style.setProperty('--chat-top', `${topBar.current!.getBoundingClientRect().height}px`)
      style.setProperty('--chat-bottom', `${bottomBar.current!.getBoundingClientRect().height}px`)
      style.setProperty('--chat-scroll-bar', `${probe.current!.offsetWidth - probe.current!.clientWidth}px`)
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    for (const measured of [topBar, bottomBar, probe]) observer.observe(measured.current!)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={pane} data-testid="chat-pane" className="relative isolate flex min-h-0 flex-1 flex-col">
      <div ref={probe} className="scrollbar-thin invisible absolute h-0 w-8 overflow-y-scroll" aria-hidden />
      <div ref={topBar} data-testid="chat-top" className="absolute top-0 right-(--chat-scroll-bar) left-0 z-10 bg-background">
        {top}
      </div>
      {children}
      {/* On a window too short for a tall question, the bar at the end scrolls inside itself and leaves the top bar's row free. */}
      <div ref={bottomBar} data-testid="chat-bottom" className="absolute right-(--chat-scroll-bar) bottom-0 left-0 z-10 max-h-[calc(100%-2.75rem)] overflow-y-auto bg-background">
        {bottom}
      </div>
      {/* Each bar ends in a short fade, so a row passing under it is not cut by a straight line. */}
      <div className="pointer-events-none absolute top-(--chat-top) right-(--chat-scroll-bar) left-0 z-10 h-4 bg-gradient-to-b from-background to-transparent" aria-hidden />
      <div className="pointer-events-none absolute right-(--chat-scroll-bar) bottom-(--chat-bottom) left-0 z-10 h-4 bg-gradient-to-t from-background to-transparent" aria-hidden />
    </div>
  )
}

/** A line in the middle of the room the bars leave: what an agent's page says while it has no chat to show. */
export function ChatNote({ children }: { children: ReactNode }) {
  return <div className="grid flex-1 place-items-center pt-(--chat-top) pb-(--chat-bottom) text-sm text-muted-foreground">{children}</div>
}
