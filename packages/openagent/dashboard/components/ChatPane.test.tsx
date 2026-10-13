import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { OpenAgentEvent } from '../../src/index.js'
import { ChatNote, ChatPane } from './ChatPane.js'
import { EventList } from './EventList.js'

// The test DOM lays nothing out: an element's height is what `heights` says for its test id, the
// list's top padding is `padding`, and the scroll bar is as wide as `scrollBar` says. The
// observers are stand-ins a test fires by hand.
let heights: Record<string, number> = {}
let padding = 0
let scrollBar = 0
let observers: { fire: () => void; targets: Element[] }[] = []
const resize = (target: Element) => act(() => observers.filter(o => o.targets.includes(target)).forEach(o => o.fire()))
const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) })
const computed = window.getComputedStyle

beforeEach(() => {
  heights = { 'chat-top': 44.5, 'chat-bottom': 96 }
  padding = 0
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
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => (el.matches('[data-slot="message-scroller-content"]') ? ({ ...computed(el, pseudo), paddingTop: `${padding}px` } as CSSStyleDeclaration) : computed(el, pseudo)))
})
afterEach(() => {
  cleanup()
  // What a test put on the prototype over the browser's own goes with it.
  for (const name of ['getBoundingClientRect', 'offsetWidth', 'clientHeight', 'scrollHeight', 'scrollTo']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const pane = () => screen.getByTestId('chat-pane')
const room = (name: string) => pane().style.getPropertyValue(name)

describe('ChatPane', () => {
  test('the page says the room each bar takes, and again when a bar changes its size', () => {
    render(<ChatPane top={<b>top bar</b>} bottom={<b>message box</b>}><p>chat</p></ChatPane>)
    // To the part of a pixel: a bar's fade starts where the bar ends.
    expect([room('--chat-top'), room('--chat-bottom')]).toEqual(['44.5px', '96px'])
    // A question opens above the message box: the bar at the end is taller.
    heights['chat-bottom'] = 400
    resize(screen.getByTestId('chat-bottom'))
    expect([room('--chat-top'), room('--chat-bottom')]).toEqual(['44.5px', '400px'])
  })

  test('the bars lie over the chat and stop short of its scroll bar; one that lies over the content takes no room', () => {
    const { unmount } = render(<ChatPane top={<b>top bar</b>} bottom={<b>message box</b>}><p>chat</p></ChatPane>)
    for (const bar of ['chat-top', 'chat-bottom']) expect(screen.getByTestId(bar).className.split(' ')).toEqual(expect.arrayContaining(['absolute', 'left-0', 'right-(--chat-scroll-bar)', 'bg-background']))
    expect(screen.getByTestId('chat-top').className.split(' ')).toContain('top-0')
    expect(screen.getByTestId('chat-bottom').className.split(' ')).toContain('bottom-0')
    expect(room('--chat-scroll-bar')).toBe('11px')
    // In the page's order: the top bar, the chat, the message box.
    expect(document.body.textContent).toBe('top barchatmessage box')
    unmount()
    scrollBar = 0
    render(<ChatPane top={<b>top bar</b>} bottom={<b>message box</b>}><p>chat</p></ChatPane>)
    expect(room('--chat-scroll-bar')).toBe('0px')
  })

  test('the page is a layer of its own, so what the shell lays over its corners stays over the bars; a tall bar at the end stays under the top one', () => {
    render(<ChatPane top={null} bottom={null} />)
    expect(pane().className.split(' ')).toEqual(expect.arrayContaining(['relative', 'isolate']))
    expect(screen.getByTestId('chat-bottom').className.split(' ')).toEqual(expect.arrayContaining(['max-h-[calc(100%-2.75rem)]', 'overflow-y-auto']))
  })

  test('a note stands in the middle of the room the bars leave', () => {
    render(<ChatPane top={null} bottom={null}><ChatNote>Loading agent…</ChatNote></ChatPane>)
    expect(screen.getByText('Loading agent…').className.split(' ')).toEqual(expect.arrayContaining(['place-items-center', 'pt-(--chat-top)', 'pb-(--chat-bottom)']))
  })
})

describe('the chat\'s rows under the bars', () => {
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

  test('the rows start under the top bar and end above the message box, and the browser\'s own scrolling keeps clear of both', () => {
    render(<EventList events={ended} projectId="p1" />)
    expect(content().className.split(' ')).toEqual(expect.arrayContaining(['px-4', 'pt-[calc(var(--chat-top,0px)+1rem)]']))
    const end = screen.getByTestId('log-end-room')
    expect(end.className.split(' ')).toContain('h-[calc(var(--chat-bottom,0px)+0.5rem)]')
    expect(viewport().className.split(' ')).toEqual(expect.arrayContaining(['scroll-pt-(--chat-top)', 'scroll-pb-(--chat-bottom)']))
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

  test('a message sent to an ended agent is brought to the top at once, though the room at the end is there', async () => {
    layOut()
    const { rerender } = render(<EventList events={ended} projectId="p1" stick={false} openAt="end" />)
    // Opened at its end: the room at the end is the last thing in view.
    await waitFor(() => expect(screen.getByTestId('log-end-room').getBoundingClientRect().bottom).toBe(500))
    rerender(<EventList events={ended} projectId="p1" stick={false} openAt="end" sending="And now this" working />)
    const sent = () => screen.getByText('And now this').closest<HTMLElement>('[data-message-id]')!
    // Under the top of the view, with a little of the row before it still seen.
    await waitFor(() => expect(sent().getBoundingClientRect().top).toBe(64))
  })

  describe('a chat at its end when the room the bars take grows', () => {
    // The viewport as a test sets it: how tall the list is, how tall the view, where it is scrolled to.
    const view = (scroll: { height: number; shown: number; top: number }) => {
      const el = viewport()
      Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scroll.height })
      Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => scroll.shown })
      Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => scroll.top, set: (to: number) => void (scroll.top = Math.min(to, scroll.height - scroll.shown)) })
      return scroll
    }
    // The list is taller by what the bars took, and says so as a list that changed its size does.
    const grow = (scroll: { height: number }, by: { end?: number; start?: number }) => {
      heights['log-end-room'] = (heights['log-end-room'] ?? 0) + (by.end ?? 0)
      padding += by.start ?? 0
      scroll.height += (by.end ?? 0) + (by.start ?? 0)
      resize(content())
    }
    const list = () => {
      heights['log-end-room'] = 104
      padding = 60
      render(<EventList events={ended} projectId="p1" stick={false} openAt="end" />)
    }

    test('it stays at its end: a question opened over the message box does not cover its last rows', () => {
      list()
      const scroll = view({ height: 2000, shown: 500, top: 1500 })
      grow(scroll, { end: 300 })
      expect(scroll.top).toBe(1800)
    })

    test('a notice that comes under the top bar pushes its last rows under the message box no more than a question does', () => {
      list()
      const scroll = view({ height: 2000, shown: 500, top: 1500 })
      grow(scroll, { start: 33 })
      expect(scroll.top).toBe(1533)
      // Both at once, as when another agent's page has a taller top bar and a taller message box.
      grow(scroll, { start: 40, end: 200 })
      expect(scroll.top).toBe(1773)
    })

    test('rows that come in, and a bar that gets shorter, are nothing to act on', () => {
      list()
      // A few pixels from its end, which still counts as at it: only room that grew moves the view.
      const scroll = view({ height: 2000, shown: 500, top: 1495 })
      grow(scroll, {})
      expect(scroll.top).toBe(1495)
      grow(scroll, { end: -50 })
      expect(scroll.top).toBe(1495)
    })

    test('a chat scrolled away from its end is left where it is', () => {
      list()
      const scroll = view({ height: 2000, shown: 500, top: 700 })
      grow(scroll, { end: 300 })
      expect(scroll.top).toBe(700)
    })

    test('a prompt the scroller holds at the top is left to the scroller', () => {
      list()
      const scroll = view({ height: 2000, shown: 500, top: 1500 })
      spacer().hidden = false
      grow(scroll, { end: 300 })
      expect(scroll.top).toBe(1500)
    })

    test('a chat that comes with its page opens at its end: the bars are measured after the list has opened', () => {
      // With no bar measured yet the list has its own room only.
      heights['log-end-room'] = 8
      padding = 16
      render(<ChatPane top={null} bottom={null}><EventList events={ended} projectId="p1" stick={false} openAt="end" /></ChatPane>)
      expect(room('--chat-bottom')).toBe('96px')
      // The list opened at its end before the page said its bars' room; the room then came, at both ends.
      const scroll = view({ height: 2000, shown: 500, top: 1500 })
      grow(scroll, { start: 44.5, end: 96 })
      expect(scroll.top).toBe(1640.5)
    })
  })
})
