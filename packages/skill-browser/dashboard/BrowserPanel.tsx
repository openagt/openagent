import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, CornerDownRight, RotateCw } from 'lucide-react'
import { Button, Input, useModuleHost, type ModulePanelProps } from '@openagt/dashboard/module'
import { KEPT_LINES } from '../src/console.js'
import type { ScreenInput } from '../src/screen.js'
import { CONSOLE, FRAME, jpegSize, readConsoleLine, readState, STATE, streamReader, type ConsoleLevel, type ConsoleLine } from '../src/stream.js'

/** How long until a session with no browser is asked again whether it has one. */
const ASK_AGAIN_MS = 3_000
/** The largest picture drawn, a side: the browser's own are 1280 by 800, and the stream may come from another computer. */
const MAX_SIDE = 4096
/** The keys passed on by name; any other key that is one character is passed on as text. */
const NAMED_KEYS = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
/** localStorage key that is there while this person keeps the console open. */
const CONSOLE_OPEN_KEY = 'oa.browser-console'

/**
 * The Browser tab: the browser the session's agent opened, live. The address bar (back, forward,
 * reload, the address) over the picture; a click, a scroll and typing on the picture go to the
 * page. Under the picture, the page's console, behind a bar that says how many errors the page
 * has. The stream is held only while the tab is on screen: a closed tab, another tab picked, or
 * a page in the background asks the session's computer for nothing.
 */
export function BrowserPanel({ projectId, agentId, activity }: ModulePanelProps) {
  const host = useModuleHost()
  // The host is a new object on every render, with the same services: the effects read the newest.
  const services = useRef(host)
  services.current = host

  const canvas = useRef<HTMLCanvasElement>(null)
  const [live, setLive] = useState(false)
  const [address, setAddress] = useState('')
  const [lines, setLines] = useState<ConsoleLine[]>([])
  const editing = useRef(false)
  const visible = usePageVisible()
  /** Ask again now whether the session has a browser, when it had none. */
  const askNow = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    if (!agentId || !visible) return
    let stopped = false
    let again: ReturnType<typeof setTimeout> | undefined
    const gone = new AbortController()
    const later = (): void => {
      setLive(false)
      askNow.current = () => {
        clearTimeout(again)
        void watch()
      }
      again = setTimeout(() => void watch(), ASK_AGAIN_MS)
    }
    const watch = async (): Promise<void> => {
      askNow.current = undefined
      const stream = await services.current.watchScreen(projectId, agentId, gone.signal)
      if (stopped) return
      if (!stream) return later()
      const parts = streamReader()
      const reader = stream.getReader()
      // A stream begins with the console's kept lines: what an earlier stream brought is let go.
      setLines([])
      let newest = 0
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done || stopped) break
          const fresh: ConsoleLine[] = []
          for (const part of parts(value)) {
            if (part.kind === FRAME) {
              const drawn = await draw(canvas.current, part.bytes)
              // The picture took a moment: the tab may show another session's browser by now.
              if (stopped) break
              if (drawn) setLive(true)
            } else if (part.kind === STATE) {
              const said = readState(part.bytes)
              if (said && !editing.current) setAddress(said.url)
            } else if (part.kind === CONSOLE) {
              const said = readConsoleLine(part.bytes)
              // Each line once, in its order: its number says so, whatever the stream repeats.
              if (said && said.n > newest) {
                newest = said.n
                fresh.push(said)
              }
            }
          }
          if (stopped) break
          if (fresh.length) setLines(held => [...held, ...fresh].slice(-KEPT_LINES))
        }
      } catch {
        // The stream broke, or was not a screen's: it is dropped, and asked for again.
      }
      void reader.cancel().catch(() => {})
      if (!stopped) later()
    }
    void watch()
    return () => {
      stopped = true
      askNow.current = undefined
      clearTimeout(again)
      gone.abort()
    }
  }, [projectId, agentId, visible])

  // The agent did something: it may have opened its browser just now.
  useEffect(() => askNow.current?.(), [activity])

  if (!agentId) return <Nothing>Open a session to see its browser.</Nothing>

  const send = (input: ScreenInput): void => void services.current.sendToScreen(projectId, agentId, input)
  /** Where on the page a point of the picture is: the picture is drawn at any size, the page has its own. */
  const at = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const el = canvas.current!
    const box = el.getBoundingClientRect()
    return { x: Math.round(((e.clientX - box.left) / box.width) * el.width), y: Math.round(((e.clientY - box.top) / box.height) * el.height) }
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (NAMED_KEYS.has(e.key)) send({ type: 'key', key: e.key })
    else if (e.key.length === 1) send({ type: 'text', text: e.key })
    else return
    e.preventDefault()
  }
  const go = (e: FormEvent): void => {
    e.preventDefault()
    const typed = address.trim()
    if (!typed) return
    send({ type: 'navigate', url: /^https?:\/\//i.test(typed) ? typed : `http://${typed}` })
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form onSubmit={go} className="flex items-center gap-1 border-b border-border p-2">
        <Button type="button" variant="ghost" size="icon-sm" className="h-7 w-7 shrink-0" aria-label="Back" disabled={!live} onClick={() => send({ type: 'back' })}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" className="h-7 w-7 shrink-0" aria-label="Forward" disabled={!live} onClick={() => send({ type: 'forward' })}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" className="h-7 w-7 shrink-0" aria-label="Reload" disabled={!live} onClick={() => send({ type: 'reload' })}>
          <RotateCw className="h-4 w-4" />
        </Button>
        <Input
          aria-label="Address"
          className="h-7 min-w-0 flex-1 text-xs"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          disabled={!live}
          value={address}
          onChange={e => setAddress(e.target.value)}
          onFocus={() => (editing.current = true)}
          onBlur={() => (editing.current = false)}
        />
      </form>
      {/* A phone has no keys until a field has the focus: what is typed here goes to the page. */}
      {live && <TypeHere send={send} />}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-hidden bg-muted">
        <Scroll canvas={canvas} send={send}>
          <canvas
            ref={canvas}
            tabIndex={0}
            role="img"
            aria-label="The agent's browser"
            className={live ? 'max-h-full max-w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring' : 'hidden'}
            onClick={e => {
              e.currentTarget.focus()
              send({ type: 'click', ...at(e) })
            }}
            onKeyDown={onKey}
          />
        </Scroll>
        {!live && <Nothing>No browser is open in this session. When the agent opens one, it shows here, live.</Nothing>}
      </div>
      {live && <Console lines={lines} />}
    </div>
  )
}

const TONE: Record<ConsoleLevel, string> = { error: 'text-danger', warning: 'text-warning', info: '', log: '', debug: 'text-muted-foreground', went: 'text-muted-foreground' }

/**
 * The page's console, under the picture: a bar that is closed until the person opens it, and
 * says how many errors the page has, the one the browser is on now. Open, it takes the lower
 * third and follows the newest line, unless the person scrolled up to read. Where the page went
 * to another address is a row no line of the page can pass for: it has a band and a mark of
 * its own.
 */
function Console({ lines }: { lines: ConsoleLine[] }) {
  const [open, setOpen] = useState(keptOpen)
  const listId = useId()
  const list = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)
  useEffect(() => {
    const el = list.current
    if (el && atEnd.current) el.scrollTop = el.scrollHeight
  }, [lines, open])

  const errors = lines.reduce((count, said) => (said.level === 'went' ? (said.errors ?? 0) : said.level === 'error' ? count + 1 : count), 0)
  const said = errors === 1 ? '1 error' : `${errors} errors`
  const toggle = (): void => {
    setOpen(!open)
    keepOpen(!open)
    atEnd.current = true
  }
  const Arrow = open ? ChevronDown : ChevronUp
  return (
    <div className={`shrink-0 border-t border-border ${open ? 'flex min-h-0 basis-1/3 flex-col' : ''}`}>
      <button type="button" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={errors > 0 ? `Console, ${said}` : 'Console'} onClick={toggle} className="flex w-full shrink-0 items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted">
        <Arrow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">Console</span>
        {errors > 0 && <span className="text-danger">{said}</span>}
      </button>
      {open && (
        <div
          ref={list}
          id={listId}
          role="log"
          // A page may say a line a second: it is read when the person looks, not read out as it comes.
          aria-live="off"
          aria-label="The page's console"
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto border-t border-border font-mono text-[11px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onScroll={e => {
            const el = e.currentTarget
            atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
          }}
        >
          {lines.length === 0 && <p className="px-3 py-2 font-sans text-xs text-muted-foreground">The page has said nothing.</p>}
          {lines.map(said =>
            said.level === 'went' ? (
              <div key={said.n} data-went className="flex gap-2 border-b border-border/50 bg-muted px-3 py-0.5 text-muted-foreground">
                <time className="shrink-0">{clock(said.at)}</time>
                <CornerDownRight aria-label="Went to" className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1 wrap-anywhere">{said.text}</span>
              </div>
            ) : (
              <div key={said.n} className={`flex gap-2 border-b border-border/50 px-3 py-0.5 ${TONE[said.level]}`}>
                <time className="shrink-0 text-muted-foreground">{clock(said.at)}</time>
                <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere">
                  {(said.level === 'error' || said.level === 'warning') && <span className="sr-only">{said.level}: </span>}
                  {said.text}
                  {said.where && <span className="text-muted-foreground"> {said.where}</span>}
                </span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

/** The time of day, on this person's clock: `09:05:07`. */
function clock(at: number): string {
  const time = new Date(at)
  return [time.getHours(), time.getMinutes(), time.getSeconds()].map(part => String(part).padStart(2, '0')).join(':')
}

/** Whether this person left the console open, in this browser. */
function keptOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(CONSOLE_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function keepOpen(open: boolean): void {
  try {
    if (open) globalThis.localStorage?.setItem(CONSOLE_OPEN_KEY, '1')
    else globalThis.localStorage?.removeItem(CONSOLE_OPEN_KEY)
  } catch {
    // A browser that keeps nothing: the console is closed at the next visit.
  }
}

function Nothing({ children }: { children: string }) {
  return <p className="p-4 text-center text-sm text-muted-foreground">{children}</p>
}

/** Whether the page is on screen: a tab in the background, or a phone with its screen off, is not. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const changed = (): void => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  return visible
}

/**
 * Draw one picture; whether it was one. Its size is read off its header first: decoding is where
 * a picture's size is paid for, and the bytes may come from another computer.
 */
async function draw(canvas: HTMLCanvasElement | null, jpeg: Uint8Array): Promise<boolean> {
  const size = jpegSize(jpeg)
  if (!canvas || !size || size.width === 0 || size.height === 0 || size.width > MAX_SIDE || size.height > MAX_SIDE) return false
  const picture = await createImageBitmap(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })).catch(() => undefined)
  if (!picture) return false
  if (canvas.width !== picture.width) canvas.width = picture.width
  if (canvas.height !== picture.height) canvas.height = picture.height
  canvas.getContext('2d')?.drawImage(picture, 0, 0)
  picture.close()
  return true
}

/**
 * Scrolling the page from its picture: a mouse's wheel, and a finger dragged over it. The wheel
 * is listened to by hand, since React's own listener cannot keep the dashboard from scrolling too.
 */
function Scroll({ canvas, send, children }: { canvas: RefObject<HTMLCanvasElement | null>; send: (input: ScreenInput) => void; children: ReactNode }) {
  const sending = useRef(send)
  sending.current = send
  const finger = useRef<{ id: number; y: number } | undefined>(undefined)

  const scaled = (e: { clientX: number; clientY: number }, dy: number): ScreenInput => {
    const el = canvas.current!
    const box = el.getBoundingClientRect()
    const scale = el.height / box.height
    return { type: 'scroll', x: Math.round(((e.clientX - box.left) / box.width) * el.width), y: Math.round((e.clientY - box.top) * scale), deltaY: Math.round(dy * scale) }
  }

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      sending.current(scaled(e, e.deltaY))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas])

  const down = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') finger.current = { id: e.pointerId, y: e.clientY }
  }
  const move = (e: PointerEvent): void => {
    const held = finger.current
    if (!held || held.id !== e.pointerId) return
    const dy = held.y - e.clientY
    // A few pixels are a tap that shook, not a drag.
    if (Math.abs(dy) < 8) return
    held.y = e.clientY
    send(scaled(e, dy))
  }
  const up = (e: PointerEvent): void => {
    if (finger.current?.id === e.pointerId) finger.current = undefined
  }
  return (
    <div className="contents" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {children}
    </div>
  )
}

/** A field whose typing goes to the page, for a device with no keys of its own: shown where the pointer is a finger. */
function TypeHere({ send }: { send: (input: ScreenInput) => void }) {
  const [coarse] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  if (!coarse) return null
  return (
    <div className="border-b border-border p-2">
      <Input
        aria-label="Type into the page"
        placeholder="Type into the page"
        className="h-7 text-xs"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value=""
        onChange={e => {
          if (e.target.value) send({ type: 'text', text: e.target.value })
        }}
        onKeyDown={e => {
          if (e.key !== 'Enter' && e.key !== 'Backspace') return
          e.preventDefault()
          send({ type: 'key', key: e.key })
        }}
      />
    </div>
  )
}
