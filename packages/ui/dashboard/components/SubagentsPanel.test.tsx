import type { RunEvent } from '@openagt/hooks'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('../rpc/agents.js', () => ({ onCodingAgents: () => new Promise(() => {}), onNamesRuns: () => new Promise(() => {}) }))

const { SubagentsPanel } = await import('./SubagentsPanel.js')
const { forgetRevealedChanges, revealSubagent } = await import('../lib/reveal-change.js')
const { SAMPLE_CALLS, hoverTooltip, phoneScreen } = await import('../test-utils.js')
const { RunCalls } = await import('./ToolCalls.js')
const { FocusHome } = await import('../lib/focus-home.js')
const { PaneHeaderContext } = await import('./PaneHeader.js')

beforeEach(() => {
  forgetRevealedChanges()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// The main agent's run is on a coding agent that words its calls.
const panel = (props: { events?: RunEvent[]; live?: boolean; agentId?: string }) => (
  <RunCalls.Provider value={SAMPLE_CALLS}>
    <SubagentsPanel projectId="p1" agentId={props.agentId ?? 'main'} events={props.events ?? []} live={props.live ?? true} />
  </RunCalls.Provider>
)

/**
 * A subagent the coding agent started inside its session, at 10:00 plus `at` minutes, that ended as
 * `end` says (none: still working) `ran` minutes later, on `model` (`null`: no model known).
 */
function call(id: string, name: string, at: number, end?: 'ended' | 'failed', ran = 2, model: string | null = 'claude-haiku-5-5'): RunEvent[] {
  const time = (minutes: number) => `2026-10-01T10:${String(minutes).padStart(2, '0')}:00.000Z`
  // Each of its events says it whole, as its coding agent writes them: the newest is what it is.
  const said = { name, ...(model !== null ? { model } : {}) }
  return [
    { kind: 'driver', event: { type: 'subagent', id, status: 'working', ...said }, at: time(at) },
    ...(end ? [{ kind: 'driver', event: { type: 'subagent', id, status: end, ...said }, at: time(at + ran) } satisfies RunEvent] : []),
  ]
}

/** A press as a browser makes it: the control takes the keyboard, then the click. */
function press(control: HTMLElement): void {
  control.focus()
  fireEvent.click(control)
}

/** The pointer comes onto `element`, as a browser says it: an enter on it and on each box around it. */
function pointTo(element: Element): void {
  for (let node: Element | null = element; node; node = node.parentElement) fireEvent.pointerEnter(node)
}

/** The pointer leaves the page from `element`. */
function pointAway(element: Element): void {
  for (let node: Element | null = element; node; node = node.parentElement) fireEvent.pointerLeave(node)
}

const rowButtons = () => screen.queryAllByRole('listitem').map(item => within(item).getAllByRole('button')[0]!)
const rowNames = () => screen.queryAllByRole('listitem').map(item => within(item).getAllByRole('button')[0]!.getAttribute('aria-label'))

describe('the list of a run\'s subagents', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T10:30:00.000Z'))
  })

  test('those that failed first, then those at work, then those that ended, each in the order it started: its name, its state and how long it worked', () => {
    const events: RunEvent[] = [
      ...call('toolu_c', 'Read the theme tokens', 1, 'ended', 3),
      ...call('toolu_b', 'Map the order table', 2, 'failed'),
      ...call('toolu_d', 'Account page tests', 24),
      ...call('toolu_a', 'Find colours written by hand', 28),
    ]
    render(panel({ events }))
    expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual(['Failed', 'Working', 'Ended'])
    expect(rowNames()).toEqual(['Map the order table · failed', 'Account page tests · working', 'Find colours written by hand · working', 'Read the theme tokens · done'])
    expect(rowButtons().map(row => document.getElementById(row.getAttribute('aria-describedby') ?? '')?.textContent)).toEqual(['2m 0s', '6m 0s', '2m 0s', '3m 0s'])
    // Nothing is open until a row is pressed, and nothing is stopped from here.
    expect(screen.queryByRole('button', { name: /^Close / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Stop/ })).toBeNull()
  })

  test("one still working when the run's process is not is over, stopped", () => {
    render(panel({ events: call('toolu_a', 'Find colours written by hand', 28), live: false }))
    expect(rowNames()).toEqual(['Find colours written by hand · stopped'])
  })

  test('the list\'s foot fades into the pane\'s own ground, the page\'s, so nothing shows under the last row', () => {
    const { container } = render(panel({ events: call('toolu_a', 'Read the theme tokens', 1, 'ended', 3) }))
    const foot = container.querySelector('.sticky.bottom-0.bg-gradient-to-t')!
    expect(foot.className.split(' ')).toContain('from-background')
  })

  test('on a phone an opened subagent takes the list\'s place, named in the pane\'s own head with "Subagents" back to all of them', () => {
    const events = [...call('toolu_a', 'Read the theme tokens', 1, 'ended', 3), ...call('toolu_b', 'Account page tests', 24)]
    const title = document.createElement('div')
    const actions = document.createElement('div')
    document.body.append(title, actions)
    const wide = phoneScreen()
    try {
      render(<PaneHeaderContext.Provider value={{ title, actions }}>{panel({ events })}</PaneHeaderContext.Provider>)
      fireEvent.click(screen.getByRole('button', { name: /^Account page tests/ }))
      const list = rowButtons()[0]!.closest('.overflow-y-auto')!
      expect(list.className.split(' ')).toEqual(expect.arrayContaining(['max-md:hidden', 'md:max-h-1/2']))
      // One row of ways back: no head of its own in the pane, no ✕, and nothing at the head's end.
      expect(within(title).getByRole('heading', { name: 'Account page tests' })).toBeTruthy()
      expect(actions.childElementCount).toBe(0)
      expect(within(screen.getByRole('region', { name: 'Account page tests' })).queryByRole('heading')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Close Account page tests' })).toBeNull()
      fireEvent.click(within(title).getByRole('button', { name: 'Back to all subagents' }))
      expect(screen.queryByRole('region', { name: 'Account page tests' })).toBeNull()
      expect(title.childElementCount).toBe(0)
      expect(rowButtons()[0]!.closest('.overflow-y-auto')!.className.split(' ')).toContain('flex-1')
    } finally {
      wide()
      title.remove()
      actions.remove()
    }
  })

  test('a row opens its subagent under the list, and pressed again, or closed, it is gone; the keyboard goes back to its row', () => {
    render(panel({ events: call('toolu_a', 'Write the docs', 1, 'ended', 1) }))
    const row = screen.getByRole('button', { name: /^Write the docs/ })
    press(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: 'Write the docs' })).toBeTruthy()
    press(row)
    expect(screen.queryByRole('region', { name: 'Write the docs' })).toBeNull()
    press(row)
    press(screen.getByRole('button', { name: 'Close Write the docs' }))
    expect(screen.queryByRole('region', { name: 'Write the docs' })).toBeNull()
    return waitFor(() => expect(document.activeElement).toBe(row))
  })

  test('opened from outside the pane, closed, the keyboard goes back to what opened it; with that gone and its row in the closed fold, to the fold', async () => {
    const events = [...Array.from({ length: 8 }, (_, at) => call(`toolu_${at}`, `Ended ${at}`, at, 'ended', 1)).flat(), ...call('toolu_w', 'Account page tests', 24)]
    const withOpener = (opener: boolean) => (
      <>
        {/* The chat's row, as the chat draws it: it asks the page for the subagent. */}
        <FocusHome>{opener && <button type="button" onClick={() => revealSubagent('p1/main', 'call:toolu_2')}>The chat's row</button>}</FocusHome>
        {panel({ events })}
      </>
    )
    const page = render(withOpener(true))
    const chatRow = screen.getByRole('button', { name: "The chat's row" })
    press(chatRow)
    press(screen.getByRole('button', { name: 'Close Ended 2' }))
    await waitFor(() => expect(document.activeElement).toBe(chatRow))
    press(chatRow)
    page.rerender(withOpener(false))
    press(screen.getByRole('button', { name: 'Close Ended 2' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ended · 8' })))
  })

  test('while the pointer is in the list it holds still: one that ends keeps its place, one that starts waits, and the row under the pointer stays the same element at the same index until the pointer leaves', () => {
    const working = [...call('toolu_a', 'Find the old tokens', 20), ...call('toolu_b', 'Account page tests', 22), ...call('toolu_c', 'Print styles', 24)]
    const list = render(panel({ events: working }))
    const under = screen.getByRole('button', { name: /^Account page tests/ })
    pointTo(under)
    const ended: RunEvent = { kind: 'driver', event: { type: 'subagent', id: 'toolu_a', status: 'ended', name: 'Find the old tokens' }, at: '2026-10-01T10:25:00.000Z' }
    list.rerender(panel({ events: [...working, ended, ...call('toolu_d', 'Theme switch in the header', 26)] }))
    expect(rowButtons()[1]).toBe(under)
    expect(rowNames()).toEqual(['Find the old tokens · done', 'Account page tests · working', 'Print styles · working'])
    pointAway(under)
    expect(rowNames()).toEqual(['Account page tests · working', 'Print styles · working', 'Theme switch in the header · working', 'Find the old tokens · done'])
    expect(rowButtons()[0]).toBe(under)
  })

  test("a subagent's time is the chat's count, said as what describes its row: at work it counts each second and its name stays the same", () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-01T10:30:43.000Z'))
    render(panel({ events: [...call('toolu_a', 'Read the theme tokens', 1, 'ended', 3), ...call('toolu_b', 'Account page tests', 22)] }))
    const working = screen.getByRole('button', { name: /^Account page tests/ })
    expect([working.getAttribute('aria-label'), working.getAttribute('aria-describedby') && document.getElementById(working.getAttribute('aria-describedby')!)?.textContent]).toEqual(['Account page tests · working', '8m 43s'])
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('button', { name: 'Account page tests · working', description: '8m 48s' })).toBe(working)
    expect(screen.getByRole('button', { name: 'Read the theme tokens · done', description: '3m 0s' })).toBeTruthy()
  })

  test('past eight rows in all, the ended ones fold into one row that says how many and opens them; once pressed the fold is the person\'s, for the page', () => {
    const ended = Array.from({ length: 8 }, (_, at) => call(`toolu_${at}`, `Ended ${at}`, at, 'ended')).flat()
    const events = [...ended, ...call('toolu_w', 'Account page tests', 24)]
    // A page of its own: the person's fold is kept for the page.
    render(panel({ events, agentId: 'folds' }))
    const fold = screen.getByRole('button', { name: 'Ended · 8' })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(rowNames()).toEqual(['Account page tests · working'])
    fireEvent.click(fold)
    expect(rowNames()).toHaveLength(9)
    cleanup()
    render(panel({ events, agentId: 'folds' }))
    expect(screen.getByRole('button', { name: 'Ended · 8' }).getAttribute('aria-expanded')).toBe('true')
    cleanup()
    // Eight in all stay open.
    render(panel({ events: ended.slice(0, 14) }))
    expect(screen.queryByRole('button', { name: /^Ended ·/ })).toBeNull()
    expect(rowNames()).toHaveLength(7)
  })

  test('forty, two failed: those are the first rows, and the ended ones are folded', () => {
    const events = [
      ...Array.from({ length: 38 }, (_, at) => call(`toolu_${at}`, `Ended ${at}`, at % 20, 'ended', 0)).flat(),
      ...call('toolu_v', 'Visual check in a browser', 20, 'failed', 1),
      ...call('toolu_m', 'Map the pages', 21, 'failed', 1),
    ]
    render(panel({ events }))
    expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual(['Failed'])
    expect(rowNames().map(name => name?.split(' · ')[0])).toEqual(['Visual check in a browser', 'Map the pages'])
    expect(screen.getByRole('button', { name: 'Ended · 38' }).getAttribute('aria-expanded')).toBe('false')
  })

  test('a ninth row arriving while the pointer is in the list folds nothing until the pointer leaves', () => {
    const events = [...call('toolu_w', 'Account page tests', 24), ...Array.from({ length: 7 }, (_, at) => call(`toolu_${at}`, `Ended ${at}`, at, 'ended', 1)).flat()]
    const list = render(panel({ events }))
    const under = screen.getByRole('button', { name: /^Ended 3/ })
    pointTo(under)
    list.rerender(panel({ events: [...events, ...call('toolu_p', 'Print styles', 26)] }))
    expect(screen.queryByRole('button', { name: /^Ended ·/ })).toBeNull()
    expect(rowButtons()[4]).toBe(under)
    pointAway(under)
    expect(screen.getByRole('button', { name: 'Ended · 7' }).getAttribute('aria-expanded')).toBe('false')
  })

  test('under the pointer a card says the row whole: its name, what it runs on, and how it stands', async () => {
    vi.useRealTimers()
    render(panel({ events: call('toolu_a', 'Read the theme tokens', 1, 'ended', 7) }))
    const tip = await hoverTooltip(screen.getByRole('button', { name: /^Read the theme tokens/ }))
    // The dot before its time is drawn, not said.
    expect(tip.textContent).toBe('Read the theme tokensModel claude-haiku-5-5Doneran 7m 0s')
  })

  test('with no model known, a card comes only where the row cuts the name, and then says its state alone', async () => {
    vi.useRealTimers()
    const events = call('toolu_a', 'Read the theme tokens', 1, 'ended', 7, null)
    // jsdom lays nothing out: every box is 0 wide, so a name is cut once it is wider than that.
    const width = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(0)
    render(panel({ events }))
    const row = screen.getByRole('button', { name: /^Read the theme tokens/ })
    fireEvent.mouseEnter(row)
    fireEvent.mouseMove(row)
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(screen.queryByRole('tooltip')).toBeNull()
    cleanup()
    width.mockReturnValue(400)
    render(panel({ events }))
    const tip = await hoverTooltip(screen.getByRole('button', { name: /^Read the theme tokens/ }))
    expect(tip.textContent).toBe('Read the theme tokensDoneran 7m 0s')
    width.mockRestore()
  })
})

describe('the subagent a row opened', () => {
  test("its whole prompt, its model, then what it said and did, out of the main agent's log", () => {
    const events: RunEvent[] = [
      { kind: 'driver', event: { type: 'action', label: 'Agent', detail: 'Map the pages', id: 'toolu_a' }, at: '2026-10-01T10:00:10.000Z' },
      { kind: 'driver', event: { type: 'subagent', id: 'toolu_a', status: 'working', name: 'Map the pages', role: 'Explore', model: 'claude-haiku-5-5', prompt: 'Read how the pages are served.\nStart at server.ts.' }, at: '2026-10-01T10:00:10.000Z' },
      { kind: 'driver', event: { type: 'action', label: 'Read', detail: 'src/server.ts', id: 'toolu_b', subagent: 'toolu_a' }, at: '2026-10-01T10:00:12.000Z' },
      { kind: 'driver', event: { type: 'text', text: 'The pages are served by server.ts.', subagent: 'toolu_a' }, at: '2026-10-01T10:00:20.000Z' },
      { kind: 'driver', event: { type: 'text', text: 'The main agent’s own words.' }, at: '2026-10-01T10:00:30.000Z' },
    ]
    render(panel({ events }))
    act(() => revealSubagent('p1/main', 'call:toolu_a'))
    expect(within(screen.getByRole('region', { name: 'Map the pages' })).getByRole('heading').textContent).toBe('Map the pages')
    expect(screen.getByText('Model claude-haiku-5-5')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Its prompt' }).textContent).toContain('Read how the pages are served.\nStart at server.ts.')
    expect(screen.getByText('The pages are served by server.ts.')).toBeTruthy()
    expect(screen.getByText('server.ts')).toBeTruthy()
    expect(screen.queryByText('The main agent’s own words.')).toBeNull()
    // It has no page, no Stop and no branch of its own.
    expect(screen.queryByRole('button', { name: 'Open its page' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })

  test('one that ended says what it came to under what it said, and one that left nothing says so', () => {
    const own: RunEvent[] = [
      { kind: 'driver', event: { type: 'action', label: 'Read', detail: 'src/server.ts', id: 'toolu_b', subagent: 'toolu_a' }, at: '2026-10-01T10:00:12.000Z' },
      { kind: 'driver', event: { type: 'text', text: 'Found it.', subagent: 'toolu_a' }, at: '2026-10-01T10:00:20.000Z' },
    ]
    const ended: RunEvent = { kind: 'driver', event: { type: 'subagent', id: 'toolu_a', status: 'ended', name: 'Map the pages', tokens: 50_700, toolUses: 2 }, at: '2026-10-01T10:00:30.000Z' }
    const started: RunEvent = { kind: 'driver', event: { type: 'subagent', id: 'toolu_a', status: 'working', name: 'Map the pages' }, at: '2026-10-01T10:00:10.000Z' }
    render(panel({ events: [started, ...own, ended] }))
    act(() => revealSubagent('p1/main', 'call:toolu_a'))
    const part = screen.getByRole('region', { name: 'Map the pages' })
    expect(within(part).getByText((_, element) => element?.tagName === 'SPAN' && element.textContent?.replaceAll('·', ' · ') === '2 tool calls · 50.7k tokens · 20s')).toBeTruthy()
    cleanup()
    render(panel({ events: [started, ended] }))
    act(() => revealSubagent('p1/main', 'call:toolu_a'))
    expect(screen.getByText('It left nothing to show.')).toBeTruthy()
  })

  test("one at work that has said nothing yet: its log ends on the chat's moving line under its prompt, counting from its start, and no note", () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T10:08:43.000Z'))
    render(panel({ events: call('toolu_a', 'Find colours written by hand', 0) }))
    act(() => revealSubagent('p1/main', 'call:toolu_a'))
    const log = within(screen.getByRole('region', { name: 'Find colours written by hand' })).getByLabelText('Agent output')
    expect(within(log).getByRole('status').textContent).toBe('8m 43s')
    // The time is said once, on that line, and nothing says it has said nothing.
    expect(within(log).getAllByText(/\d+m \d+s/)).toHaveLength(1)
    expect(within(log).queryByText('It left nothing to show.')).toBeNull()
  })

  test("its log takes the room its scroller keeps for a scroll bar off its right padding: it reads that room's width", () => {
    const outer = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(564)
    const inner = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(554)
    render(panel({ events: call('toolu_a', 'Find colours written by hand', 0) }))
    act(() => revealSubagent('p1/main', 'call:toolu_a'))
    const log = within(screen.getByRole('region', { name: 'Find colours written by hand' })).getByLabelText('Agent output')
    expect(log.style.getPropertyValue('--log-gutter')).toBe('10px')
    outer.mockRestore()
    inner.mockRestore()
  })

  test('an ask for a subagent that is not one of this run’s opens none of them', () => {
    render(panel({ events: call('toolu_a', 'Write the docs', 1, 'ended', 1) }))
    act(() => revealSubagent('p1/main', 'call:gone'))
    expect(screen.queryByRole('button', { name: /^Close / })).toBeNull()
    expect(screen.getByRole('button', { name: /^Write the docs/ }).getAttribute('aria-expanded')).toBe('false')
  })
})
