import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ModuleHostContext, type ModuleHost } from '@openagt/dashboard/module'
import { FRAME, PULSE, STATE, streamPart } from '../src/stream.js'
import { BrowserPanel } from './BrowserPanel.js'

// The Browser tab inside a faked dashboard: `watchScreen` answers a stream the test writes to,
// `sendToScreen` records what the person did. jsdom draws nothing, so a picture is a stub of the
// size the test says, and the canvas is given a place on the page.

const context = { files: new Set<string>(), toggle() {} }

function dashboard() {
  let feed: ReadableStreamDefaultController<Uint8Array> | undefined
  const watched: AbortSignal[] = []
  const sent: unknown[] = []
  let open = true
  let cancelled = 0
  const host: ModuleHost = {
    package: '@openagt/skill-browser',
    runCommand: vi.fn(async () => ({ ok: false as const, error: 'no commands' })),
    act: vi.fn(async () => ({ ok: false as const, error: 'no commands' })),
    read: vi.fn(async () => ({ ok: false as const, error: 'no reads' })),
    openAgent: vi.fn(),
    openPage: vi.fn(),
    startRun: vi.fn(async () => ({ ok: false as const, error: 'no runs' })),
    configureRun: vi.fn(),
    agents: vi.fn(async () => []),
    machines: vi.fn(async () => ({ version: '0.0.0', machines: [] })),
    addMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    watchScreen: vi.fn(async (_project: string, _agent: string, signal: AbortSignal) => {
      watched.push(signal)
      if (!open) return undefined
      return new ReadableStream<Uint8Array>({ start: controller => void (feed = controller), cancel: () => void cancelled++ })
    }),
    sendToScreen: vi.fn(async (_project: string, _agent: string, input: unknown) => {
      sent.push(input)
      return true
    }),
  }
  return {
    host,
    watched,
    sent,
    browser(isOpen: boolean) {
      open = isOpen
    },
    cancelled: () => cancelled,
    async raw(bytes: Uint8Array) {
      await act(async () => {
        feed!.enqueue(bytes)
        await new Promise(resolve => setTimeout(resolve, 0))
      })
    },
    says(kind: number, bytes: Uint8Array) {
      return this.raw(streamPart(kind, bytes))
    },
    async ends() {
      await act(async () => {
        feed!.close()
        await new Promise(resolve => setTimeout(resolve, 0))
      })
    },
  }
}

/** The start of a JPEG that says it is a picture of this size. */
const jpeg = (width = 1280, height = 800) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03])
const state = (url: string) => new TextEncoder().encode(JSON.stringify({ url, title: 'A page' }))
const show = (host: ModuleHost, props: { agentId?: string; activity?: number } = { agentId: 'run-1' }) => (
  <ModuleHostContext.Provider value={host}>
    <BrowserPanel projectId="p" context={context} {...props} />
  </ModuleHostContext.Provider>
)

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1280, height: 800, close() {} })))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as never)
  // The picture is shown at half its size, 40 from the left and 100 from the top.
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 100, width: 640, height: 400 } as DOMRect)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

test('the tab shows the browser live: the address, the picture, and a click goes to the page where it was made', async () => {
  const world = dashboard()
  render(show(world.host))
  await waitFor(() => expect(world.host.watchScreen).toHaveBeenCalledWith('p', 'run-1', expect.any(AbortSignal)))
  expect(screen.getByText(/No browser is open/)).toBeTruthy()

  await world.says(STATE, state('http://localhost:3000/'))
  await world.says(PULSE, new Uint8Array(0))
  await world.says(FRAME, jpeg())
  const view = await screen.findByRole('img', { name: "The agent's browser" })
  expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe('http://localhost:3000/')
  expect(screen.queryByText(/No browser is open/)).toBeNull()

  fireEvent.click(view, { clientX: 40 + 100, clientY: 100 + 50 })
  expect(world.sent).toEqual([{ type: 'click', x: 200, y: 100 }])

  fireEvent.keyDown(view, { key: 'a' })
  fireEvent.keyDown(view, { key: 'Enter' })
  fireEvent.keyDown(view, { key: 'c', metaKey: true })
  fireEvent.keyDown(view, { key: 'Shift' })
  fireEvent.wheel(view, { clientX: 40, clientY: 100, deltaY: 30 })
  expect(world.sent.slice(1)).toEqual([{ type: 'text', text: 'a' }, { type: 'key', key: 'Enter' }, { type: 'scroll', x: 0, y: 0, deltaY: 60 }])
})

test('the address bar goes where the person says, and is not overwritten while they type', async () => {
  const world = dashboard()
  render(show(world.host))
  await waitFor(() => expect(world.host.watchScreen).toHaveBeenCalled())
  await world.says(STATE, state('http://a.test/'))
  await world.says(FRAME, jpeg())

  const address = screen.getByLabelText('Address') as HTMLInputElement
  fireEvent.focus(address)
  fireEvent.change(address, { target: { value: 'example.test/page' } })
  await world.says(STATE, state('http://a.test/moved'))
  expect(address.value).toBe('example.test/page')
  fireEvent.submit(address.closest('form')!)
  expect(world.sent).toEqual([{ type: 'navigate', url: 'http://example.test/page' }])

  fireEvent.click(screen.getByLabelText('Back'))
  fireEvent.click(screen.getByLabelText('Forward'))
  fireEvent.click(screen.getByLabelText('Reload'))
  expect(world.sent.slice(1)).toEqual([{ type: 'back' }, { type: 'forward' }, { type: 'reload' }])
})

test('a picture too large to be a browser\'s is not drawn, and bytes that are no screen drop the stream', async () => {
  const world = dashboard()
  render(show(world.host))
  await waitFor(() => expect(world.host.watchScreen).toHaveBeenCalledTimes(1))
  // Its size is read off its header: a picture that says it is too large, and bytes that are no
  // JPEG, are never handed to the decoder.
  await world.says(FRAME, jpeg(50_000, 800))
  await world.says(FRAME, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  expect(createImageBitmap).not.toHaveBeenCalled()
  expect(screen.getByText(/No browser is open/)).toBeTruthy()

  // A message that says it is four gigabytes long: the stream is let go, never kept.
  const huge = new Uint8Array(5)
  huge[0] = FRAME
  new DataView(huge.buffer).setUint32(1, 0xffffffff)
  await world.raw(huge)
  expect(world.watched[0]!.aborted).toBe(false)
  expect(world.cancelled()).toBe(1)
})

test('with no browser open the tab says so and asks again; a closed tab stops asking and lets the stream go', async () => {
  vi.useFakeTimers()
  const world = dashboard()
  world.browser(false)
  const { unmount, rerender } = render(show(world.host))
  await act(async () => void (await vi.advanceTimersByTimeAsync(0)))
  expect(world.host.watchScreen).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/No browser is open/)).toBeTruthy()
  expect((screen.getByLabelText('Address') as HTMLInputElement).disabled).toBe(true)

  await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)))
  expect(world.host.watchScreen).toHaveBeenCalledTimes(2)

  // The agent did something: it is asked at once, not at the next turn of the clock.
  rerender(show(world.host, { agentId: 'run-1', activity: 5 }))
  await act(async () => void (await vi.advanceTimersByTimeAsync(0)))
  expect(world.host.watchScreen).toHaveBeenCalledTimes(3)

  world.browser(true)
  await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)))
  expect(world.host.watchScreen).toHaveBeenCalledTimes(4)
  expect(world.watched.at(-1)!.aborted).toBe(false)
  unmount()
  expect(world.watched.at(-1)!.aborted).toBe(true)
  await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)))
  expect(world.host.watchScreen).toHaveBeenCalledTimes(4)
})

test('a browser that closes leaves the tab saying so; a page with no session has no browser', async () => {
  const world = dashboard()
  const { rerender } = render(show(world.host))
  await waitFor(() => expect(world.host.watchScreen).toHaveBeenCalled())
  await world.says(FRAME, jpeg())
  await screen.findByRole('img', { name: "The agent's browser" })
  world.browser(false)
  await world.ends()
  expect(screen.getByText(/No browser is open/)).toBeTruthy()

  rerender(show(world.host, {}))
  expect(screen.getByText('Open a session to see its browser.')).toBeTruthy()
})

test('where the pointer is a finger, a field takes the typing and a drag scrolls the page', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }))
  const world = dashboard()
  render(show(world.host))
  await waitFor(() => expect(world.host.watchScreen).toHaveBeenCalled())
  expect(screen.queryByLabelText('Type into the page')).toBeNull()
  await world.says(FRAME, jpeg())

  const field = await screen.findByLabelText('Type into the page')
  fireEvent.change(field, { target: { value: 'h' } })
  expect((field as HTMLInputElement).value).toBe('')
  fireEvent.keyDown(field, { key: 'Enter' })
  fireEvent.keyDown(field, { key: 'Backspace' })
  expect(world.sent).toEqual([{ type: 'text', text: 'h' }, { type: 'key', key: 'Enter' }, { type: 'key', key: 'Backspace' }])

  // A finger moved up 50 scrolls the page down by 100 of its own pixels: the picture is at half size.
  const view = screen.getByRole('img', { name: "The agent's browser" })
  fireEvent.pointerDown(view, { pointerId: 1, pointerType: 'touch', clientX: 140, clientY: 300 })
  fireEvent.pointerMove(view, { pointerId: 1, pointerType: 'touch', clientX: 140, clientY: 297 })
  fireEvent.pointerMove(view, { pointerId: 1, pointerType: 'touch', clientX: 140, clientY: 250 })
  fireEvent.pointerUp(view, { pointerId: 1, pointerType: 'touch', clientX: 140, clientY: 250 })
  fireEvent.pointerMove(view, { pointerId: 1, pointerType: 'touch', clientX: 140, clientY: 100 })
  expect(world.sent.slice(3)).toEqual([{ type: 'scroll', x: 200, y: 300, deltaY: 100 }])
})
