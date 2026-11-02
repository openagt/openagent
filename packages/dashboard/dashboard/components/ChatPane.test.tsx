import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { OpenAgentEvent } from '../../src/index.js'
import { ChatNote, ChatPane } from './ChatPane.js'
import { EventList } from './EventList.js'

// The test DOM lays nothing out: an element's height is what `heights` says for its test id, and
// the scroll bar is as wide as `scrollBar` says. The observers are stand-ins a test fires by hand.
let heights: Record<string, number> = {}
let scrollBar = 0
let observers: { fire: () => void; targets: Element[] }[] = []
const resize = (target: Element) => act(() => observers.filter(o => o.targets.includes(target)).forEach(o => o.fire()))
const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) })

beforeEach(() => {
  heights = { 'chat-bottom': 96.5 }
  scrollBar = 11
  observers = []
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) { return rect(0, heights[this.dataset['testid'] ?? ''] ?? 0) }
  // Only an element styled as the chat's scroller is has a scroll bar to measure: its box, and its box without the bar (`clientWidth`, 0 here).
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get(this: HTMLElement) { return ['scrollbar-thin', 'overflow-y-scroll'].every(cls => this.classList.contains(cls)) ? scrollBar : 0 } })
  vi.stubGlobal('ResizeObserver', class {
    readonly targets: Element[] = []
    constructor(readonly fire: () => void) { observers.push(this) }
    observe(target: Element) { this.targets.push(target) }
    disconnect() { observers = observers.filter(o => o !== this) }
  })
})
afterEach(() => {
  cleanup()
  // What a test put on the prototype over the browser's own goes with it.
  for (const name of ['getBoundingClientRect', 'offsetWidth', 'clientHeight', 'scrollHeight', 'scrollTo']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
  vi.unstubAllGlobals()
})

const pane = () => screen.getByTestId('chat-pane')
const room = (name: string) => pane().style.getPropertyValue(name)

describe('ChatPane', () => {
  test('the page says the room the message box\'s bar takes, and again when the bar changes its size', () => {
    render(<ChatPane top={<b>top bar</b>} bottom={<b>message box</b>}><p>chat</p></ChatPane>)
    // To the part of a pixel: the bar's fade starts where the bar ends.
    expect(room('--chat-bottom')).toBe('96.5px')
    // A question opens above the message box: the bar is taller.
    heights['chat-bottom'] = 400
    resize(screen.getByTestId('chat-bottom'))
    expect(room('--chat-bottom')).toBe('400px')
  })

  test('on a touch screen the chat ends where the message box starts: a phone draws its scroll bar the chat\'s whole height', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }))
    render(<ChatPane top={<b>top bar</b>} bottom={<b>message box</b>}><p>chat</p></ChatPane>)
    expect(room('--chat-bar')).toBe('96.5px')
    // The chat keeps no room for the bar: it is not under it.
    expect(room('--chat-bottom')).toBe('0px')
    expect(screen.getByTestId('chat-bottom').parentElement!.className.split(' ')).toContain('pointer-coarse:pb-(--chat-bar)')
  })

  test('the top bar is the page\'s first row, and the chat\'s room starts under it: the chat keeps no room for it', () => {
    render(<ChatPane top={<b>top bar</b>} bottom={<b>message box</b>}><p>chat</p></ChatPane>)
    const top = screen.getByTestId('chat-top')
    expect(top.parentElement).toBe(pane())
    expect(top.className.split(' ')).not.toContain('absolute')
    // The chat and what lies over it share the room under the top bar, which the top bar is no part of.
    const chatRoom = screen.getByText('chat').parentElement!
    expect(chatRoom.parentElement).toBe(pane())
    // What lies over the chat is cut at the room's edges: nothing of it reaches the top bar. And the
    // room is a layer of its own: a popup the dashboard opens over the page stays over the message box's bar.
    expect(chatRoom.className.split(' ')).toEqual(expect.arrayContaining(['relative', 'isolate', 'min-h-0', 'flex-1', 'overflow-hidden']))
    expect(chatRoom.contains(top)).toBe(false)
    expect(screen.getByTestId('chat-bottom').parentElement).toBe(chatRoom)
    expect(room('--chat-top')).toBe('')
    // In the page's order: the top bar, the chat, the message box.
    expect(document.body.textContent).toBe('top barchatmessage box')
  })

  test('the message box\'s bar lies over the chat and stops short of its scroll bar; a scroll bar that lies over the content takes no room, and the bar still leaves it a strip', () => {
    const { unmount } = render(<ChatPane top={<b>top bar</b>} bottom={<b>message box</b>}><p>chat</p></ChatPane>)
    const bar = screen.getByTestId('chat-bottom').className.split(' ')
    expect(bar).toEqual(expect.arrayContaining(['absolute', 'bottom-0', 'left-0', 'right-[max(var(--chat-scroll-bar),0.75rem)]', 'bg-background']))
    // As much more on its left, so the message box stays centered under the chat.
    expect(bar).toContain('pl-[calc(max(var(--chat-scroll-bar),0.75rem)_-_var(--chat-scroll-bar))]')
    // A phone's chat ends above the bar: no strip there.
    expect(bar).toEqual(expect.arrayContaining(['pointer-coarse:right-(--chat-scroll-bar)', 'pointer-coarse:pl-0']))
    expect(room('--chat-scroll-bar')).toBe('11px')
    unmount()
    scrollBar = 0
    render(<ChatPane top={<b>top bar</b>} bottom={<b>message box</b>}><p>chat</p></ChatPane>)
    expect(room('--chat-scroll-bar')).toBe('0px')
  })

  test('a bar too tall for the chat\'s room scrolls inside itself', () => {
    render(<ChatPane top={null} bottom={null} />)
    expect(screen.getByTestId('chat-bottom').className.split(' ')).toEqual(expect.arrayContaining(['max-h-full', 'overflow-y-auto']))
  })

  test('the chat fades out at each end of its room: under the top bar, and above the message box\'s bar, clear of the scroll bar', () => {
    render(<ChatPane top={<b>top bar</b>} bottom={<b>message box</b>}><p>chat</p></ChatPane>)
    const chatRoom = screen.getByText('chat').parentElement!
    const fades = [...chatRoom.querySelectorAll<HTMLElement>(':scope > [aria-hidden]')].filter(el => el.className.includes('to-transparent')).map(el => el.className.split(' '))
    expect(fades).toHaveLength(2)
    for (const fade of fades) expect(fade).toEqual(expect.arrayContaining(['pointer-events-none', 'absolute', 'left-0', 'right-[max(var(--chat-scroll-bar),0.75rem)]']))
    expect(fades[0]).toEqual(expect.arrayContaining(['top-0', 'bg-gradient-to-b']))
    expect(fades[1]).toEqual(expect.arrayContaining(['bottom-(--chat-bar)', 'bg-gradient-to-t']))
  })

  test('a note stands in the middle of the room the message box leaves', () => {
    render(<ChatPane top={null} bottom={null}><ChatNote>Loading agent…</ChatNote></ChatPane>)
    const note = screen.getByText('Loading agent…').className.split(' ')
    expect(note).toEqual(expect.arrayContaining(['place-items-center', 'pb-(--chat-bottom)']))
    expect(note).not.toContain('pt-(--chat-top)')
  })
})

describe('the chat\'s rows and the message box over their end', () => {
  const said = (text: string) => ({ kind: 'driver', event: { type: 'text', text } })
  const ended = [{ kind: 'driver', event: { type: 'start', prompt: 'Say hi' } }, ...Array.from({ length: 12 }, (_, at) => said(`reply ${at}`)), { kind: 'end', ok: true }] as OpenAgentEvent[]
  const viewport = () => document.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!
  const content = () => document.querySelector<HTMLElement>('[data-slot="message-scroller-content"]')!
  const spacer = () => content().querySelector<HTMLElement>('[data-message-scroller-spacer]')!
  // The content's children in the order they are drawn: the rows, the room at the end, the scroller's spacer.
  const drawn = () => {
    const children = [...content().children] as HTMLElement[]
    const rows = children.filter(child => child !== spacer() && child.dataset['testid'] !== 'log-end-room')
    return [...rows, screen.getByTestId('log-end-room'), ...(spacer().hidden ? [] : [spacer()])]
  }

  test('the rows end above the message box, and the browser\'s own scrolling keeps clear of it; no room is kept at the start', () => {
    render(<EventList events={ended} projectId="p1" />)
    expect(content().className.split(' ')).toEqual(expect.arrayContaining(['px-4', 'pt-4']))
    const end = screen.getByTestId('log-end-room')
    expect(end.className.split(' ')).toContain('h-[calc(var(--chat-bottom,0px)+0.5rem)]')
    expect(viewport().className.split(' ')).toContain('scroll-pb-(--chat-bottom)')
    expect(viewport().className).not.toContain('--chat-top')
    // "Jump to latest" stands above the message box and its fade, and nowhere else; it never lies over a bar.
    const button = document.querySelector<HTMLElement>('[data-slot="message-scroller-button"]')!.className.split(' ')
    expect(button).toContain('data-[direction=end]:bottom-[calc(var(--chat-bottom,0px)+1.25rem)]')
    expect(button).not.toContain('data-[direction=end]:bottom-3')
    expect(document.querySelector('[data-slot="message-scroller"]')!.className.split(' ')).toContain('isolate')
  })

  test('the room at the end is the list\'s first element and is drawn last, the scroller\'s spacer after it', () => {
    render(<EventList events={ended} projectId="p1" />)
    const end = screen.getByTestId('log-end-room')
    expect(content().firstElementChild).toBe(end)
    expect(end.className.split(' ')).toContain('order-9998')
    expect(spacer().className.split(' ')).toContain('order-last')
  })

  // The browser keeps the first row of the page in the view where it was when a row above it
  // grows: the room, first and at the end, kept the end still and pushed an opened steps line up.
  test('the room at the end is never the row the browser holds in place', () => {
    render(<EventList events={ended} projectId="p1" />)
    expect(screen.getByTestId('log-end-room').className.split(' ')).toContain('[overflow-anchor:none]')
  })

  // A layout for the real scroller: every drawn child of the list is 100 tall, the viewport 500.
  const layOut = () => {
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this === viewport()) return rect(0, 500)
      if (this.parentElement !== content()) return rect(0, 0)
      const at = drawn().indexOf(this)
      return at < 0 ? rect(0, 0) : rect(at * 100 - viewport().scrollTop, 100)
    }
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this === viewport() ? 500 : 0 } })
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return this === viewport() ? (drawn().length - (spacer().hidden ? 0 : 1)) * 100 + (spacer().hidden ? 0 : Number.parseFloat(spacer().style.height || '0')) : 0 } })
    HTMLElement.prototype.scrollTo = function (this: HTMLElement, to?: ScrollToOptions | number) { this.scrollTop = typeof to === 'object' ? (to.top ?? 0) : 0 } as typeof HTMLElement.prototype.scrollTo
  }

  test('a message sent lands at the end, under the last answer: the log goes there from a reader scrolled up, and lifts nothing to the top', async () => {
    layOut()
    const { rerender } = render(<EventList events={ended} projectId="p1" stick={false} openAt="end" />)
    // Opened at its end: the room at the end is the last thing in view.
    await waitFor(() => expect(screen.getByTestId('log-end-room').getBoundingClientRect().bottom).toBe(500))
    // The reader scrolls up, then sends.
    viewport().scrollTop = 0
    rerender(<EventList events={ended} projectId="p1" stick={false} openAt="end" sending="And now this" working />)
    const sent = () => screen.getByText('And now this').closest<HTMLElement>('[data-message-id]')!
    await waitFor(() => expect(screen.getByTestId('log-end-room').getBoundingClientRect().bottom).toBe(500))
    // In view, just above the room at the end: the scroller kept no empty room under it.
    expect(sent().getBoundingClientRect().bottom).toBeLessThanOrEqual(screen.getByTestId('log-end-room').getBoundingClientRect().top)
    expect(spacer().hidden).toBe(true)
  })

  describe('a chat at its end when its rows get less room', () => {
    // The view is 500 tall from its first layout on: the list reads it as it comes to the page.
    beforeEach(() => Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.matches('[data-slot="message-scroller-viewport"]') ? 500 : 0 } }))
    // The viewport as a test sets it: how tall the list is, how tall the view, where it is scrolled to.
    const view = (scroll: { height: number; shown: number; top: number }) => {
      const el = viewport()
      Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scroll.height })
      Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => scroll.shown })
      Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => scroll.top, set: (to: number) => void (scroll.top = Math.min(to, scroll.height - scroll.shown)) })
      return scroll
    }
    // The list is taller by what the message box's bar took, and the room at its end says so as an element that changed its size does.
    const grow = (scroll: { height: number }, by: number) => {
      heights['log-end-room'] = (heights['log-end-room'] ?? 0) + by
      scroll.height += by
      resize(screen.getByTestId('log-end-room'))
    }
    // The view is shorter by what the top bar took of the page, and says so as a view that changed its size does.
    const shorten = (scroll: { shown: number }, by: number) => {
      scroll.shown -= by
      resize(viewport())
    }
    const list = () => {
      heights['log-end-room'] = 104
      render(<EventList events={ended} projectId="p1" stick={false} openAt="end" />)
    }

    test('it stays at its end: a question opened over the message box does not cover its last rows', () => {
      list()
      const scroll = view({ height: 2000, shown: 500, top: 1500 })
      grow(scroll, 300)
      expect(scroll.top).toBe(1800)
    })

    test('a notice that comes under the top bar makes the view shorter, and pushes its last rows under the message box no more than a question does', () => {
      list()
      const scroll = view({ height: 2000, shown: 500, top: 1500 })
      shorten(scroll, 33)
      expect(scroll.top).toBe(1533)
      // Both in one frame, as when the details open under the top bar while a question opens over the message box.
      heights['log-end-room'] = 304
      scroll.height += 200
      shorten(scroll, 40)
      expect(scroll.top).toBe(1773)
    })

    test('a bar that gets shorter and a view that gets taller are nothing to act on', () => {
      list()
      // A few pixels from its end, which still counts as at it: only room that was lost moves the view.
      const scroll = view({ height: 2000, shown: 500, top: 1495 })
      grow(scroll, -50)
      expect(scroll.top).toBe(1495)
      shorten(scroll, -30)
      expect(scroll.top).toBe(1495)
    })

    test('a chat shorter than its view is left at its top when rows make it longer, though the bar grew before', () => {
      list()
      const scroll = view({ height: 500, shown: 500, top: 0 })
      // The list fills the view whatever its rows take: the bar grows by 40, and nothing scrolls yet.
      heights['log-end-room'] = 144
      resize(screen.getByTestId('log-end-room'))
      // Rows then make the list longer than the view, and the view a little shorter: only that little is lost.
      scroll.height += 30
      shorten(scroll, 2)
      expect(scroll.top).toBe(0)
    })

    test('a chat a little way from its end is left where it is, however much room is lost', () => {
      list()
      const scroll = view({ height: 2000, shown: 500, top: 1400 })
      grow(scroll, 300)
      expect(scroll.top).toBe(1400)
      shorten(scroll, 60)
      expect(scroll.top).toBe(1400)
    })

    test('a chat scrolled away from its end is left where it is', () => {
      list()
      const scroll = view({ height: 2000, shown: 500, top: 700 })
      grow(scroll, 300)
      expect(scroll.top).toBe(700)
      shorten(scroll, 33)
      expect(scroll.top).toBe(700)
    })

    test('a chat that comes with its page opens at its end: the bar is measured after the list has opened', () => {
      // With no bar measured yet the list has its own room only.
      heights['log-end-room'] = 8
      render(<ChatPane top={null} bottom={null}><EventList events={ended} projectId="p1" stick={false} openAt="end" /></ChatPane>)
      expect(room('--chat-bottom')).toBe('96.5px')
      // The list opened at its end before the page said the bar's room; the room then came.
      const scroll = view({ height: 2000, shown: 500, top: 1500 })
      grow(scroll, 96.5)
      expect(scroll.top).toBe(1596.5)
    })
  })
})
