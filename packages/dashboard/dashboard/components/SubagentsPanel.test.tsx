import type { AgentMeta, OpenAgentEvent } from '../../src/index.js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const onAgent = vi.hoisted(() => vi.fn())
const sendStop = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onAgent }))
vi.mock('../rpc/control.js', () => ({ sendStop }))
vi.mock('../rpc/models.js', () => ({ onModels: () => new Promise(() => {}) }))

const { SubagentsPanel } = await import('./SubagentsPanel.js')
const { forgetRevealedChanges, revealSubagent } = await import('../lib/reveal-change.js')
const { forgetRemembered } = await import('../lib/use-async.js')
const { hoverTooltip } = await import('../test-utils.js')
const { FocusHome } = await import('../lib/focus-home.js')

beforeEach(() => {
  forgetRevealedChanges()
  forgetRemembered()
  onAgent.mockReset().mockResolvedValue([])
  sendStop.mockReset().mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const panel = (props: { events?: OpenAgentEvent[]; subagents?: AgentMeta[]; live?: boolean; onOpenAgent?: (id: string) => void; agentId?: string }) => (
  <SubagentsPanel projectId="p1" agentId={props.agentId ?? 'main'} events={props.events ?? []} subagents={props.subagents ?? []} live={props.live ?? true} onOpenAgent={props.onOpenAgent} />
)

/** A subagent that is a run of its own, started at `at` (10:00 plus minutes) and, unless working, ended `ran` minutes later. */
function run(at: number, title: string, status: AgentMeta['status'], ran = 0): AgentMeta {
  const id = `2026-10-01T10-${String(at).padStart(2, '0')}-00-000Z`
  const startedAt = `2026-10-01T10:${String(at).padStart(2, '0')}:00.000Z`
  const end = `2026-10-01T10:${String(at + ran).padStart(2, '0')}:00.000Z`
  return { status, id, startedAt, updatedAt: end, ...(status === 'running' ? {} : { endedAt: end }), parent: 'main', title, intent: `${title}\n\nYou are a subagent.`, model: 'claude-sonnet-5-5' }
}

/** A subagent the coding agent started inside its session, at 10:00 plus `at` minutes, that ended as `end` says (none: still working). */
function call(id: string, name: string, at: number, end?: 'ended' | 'failed'): OpenAgentEvent[] {
  const time = (minutes: number) => `2026-10-01T10:${String(minutes).padStart(2, '0')}:00.000Z`
  return [
    { kind: 'driver', event: { type: 'subagent', id, status: 'working', name, model: 'claude-haiku-5-5' }, at: time(at) },
    ...(end ? [{ kind: 'driver', event: { type: 'subagent', id, status: end, name }, at: time(at + 2) } satisfies OpenAgentEvent] : []),
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

/** A line of facts, as it reads: its dots are drawn between its facts, not in their words. */
const factsLine = (words: string) => screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent?.replaceAll('·', ' · ') === words)

const rowButtons = () => screen.queryAllByRole('listitem').map(item => within(item).getAllByRole('button')[0]!)
const rowNames = () => screen.queryAllByRole('listitem').map(item => within(item).getAllByRole('button')[0]!.getAttribute('aria-label'))

describe('the list of a run\'s subagents', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T10:30:00.000Z'))
  })

  test('those that failed first, then those at work, then those that ended, each in the order it started: its name, its state and how long it worked, a failed run with why', () => {
    const subagents = [run(1, 'Read the theme tokens', 'done', 3), run(24, 'Account page tests', 'running'), run(5, 'Visual check in a browser', 'failed', 2)]
    const events: OpenAgentEvent[] = [
      ...call('toolu_a', 'Find colours written by hand', 28),
      ...call('toolu_b', 'Map the order table', 2, 'failed'),
      { kind: 'driver', event: { type: 'start', prompt: `The run ${subagents[2]!.id}, started for this run, ended failed: Chrome did not start.` }, at: '2026-10-01T10:08:00.000Z' },
    ]
    render(panel({ events, subagents }))
    expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual(['Failed', 'Working', 'Ended'])
    expect(rowNames()).toEqual([
      'Map the order table · failed',
      'Visual check in a browser · failed · Chrome did not start',
      'Account page tests · working',
      'Find colours written by hand · working',
      'Read the theme tokens · done',
    ])
    expect(rowButtons().map(row => document.getElementById(row.getAttribute('aria-describedby') ?? '')?.textContent)).toEqual(['2m 0s', '2m 0s', '6m 0s', '2m 0s', '3m 0s'])
    expect(screen.getByText('Chrome did not start')).toBeTruthy()
    // Nothing is open until a row is pressed.
    expect(screen.queryByRole('button', { name: /^Close / })).toBeNull()
  })

  test('a row opens its subagent under the list, and pressed again, or closed, it is gone; the keyboard goes back to its row', () => {
    const sub = run(1, 'Write the docs', 'done', 1)
    render(panel({ subagents: [sub] }))
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
    const ended = Array.from({ length: 8 }, (_, at) => run(at, `Ended ${at}`, 'done', 1))
    const withOpener = (opener: boolean) => (
      <>
        {/* The chat's row, as the chat draws it: it asks the page for the subagent. */}
        <FocusHome>{opener && <button type="button" onClick={() => revealSubagent('p1/main', `run:${ended[2]!.id}`)}>The chat's row</button>}</FocusHome>
        {panel({ subagents: [run(24, 'Account page tests', 'running'), ...ended] })}
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

  test('while the pointer is in the list it holds still: one that ends keeps its place and loses its Stop, one that starts waits, and the row under the pointer stays the same element at the same index until the pointer leaves', () => {
    const ending = run(20, 'Find the old tokens', 'running')
    const list = render(panel({ subagents: [ending, run(22, 'Account page tests', 'running'), run(24, 'Print styles', 'running')] }))
    const under = screen.getByRole('button', { name: /^Account page tests/ })
    pointTo(under)
    list.rerender(panel({ subagents: [run(20, 'Find the old tokens', 'done', 5), run(22, 'Account page tests', 'running'), run(24, 'Print styles', 'running'), run(26, 'Theme switch in the header', 'running')] }))
    expect(rowButtons()[1]).toBe(under)
    expect(rowNames()).toEqual(['Find the old tokens · done', 'Account page tests · working', 'Print styles · working'])
    expect(screen.queryByRole('button', { name: 'Stop Find the old tokens' })).toBeNull()
    pointAway(under)
    expect(rowNames()).toEqual(['Account page tests · working', 'Print styles · working', 'Theme switch in the header · working', 'Find the old tokens · done'])
    expect(rowButtons()[0]).toBe(under)
  })

  test("a subagent's time is the chat's count, said as what describes its row: at work it counts each second and its name stays the same", () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-01T10:30:43.000Z'))
    render(panel({ subagents: [run(22, 'Account page tests', 'running'), run(1, 'Read the theme tokens', 'done', 3)] }))
    const working = screen.getByRole('button', { name: /^Account page tests/ })
    expect([working.getAttribute('aria-label'), working.getAttribute('aria-describedby') && document.getElementById(working.getAttribute('aria-describedby')!)?.textContent]).toEqual(['Account page tests · working', '8m 43s'])
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('button', { name: 'Account page tests · working', description: '8m 48s' })).toBe(working)
    expect(screen.getByRole('button', { name: 'Read the theme tokens · done', description: '3m 0s' })).toBeTruthy()
  })

  test('a run at work is stopped from its row or from its open part; a subagent of the coding agent\'s own, or one that ended, has no Stop', async () => {
    const working = run(24, 'Account page tests', 'running')
    render(panel({ subagents: [working, run(1, 'Read the theme tokens', 'done', 3)], events: call('toolu_a', 'Find colours written by hand', 28) }))
    expect(screen.getAllByRole('button', { name: /^Stop / }).map(b => b.getAttribute('aria-label'))).toEqual(['Stop Account page tests'])
    fireEvent.click(screen.getByRole('button', { name: 'Stop Account page tests' }))
    await waitFor(() => expect(sendStop).toHaveBeenCalledWith('p1', working.id))
    cleanup()
    // Another run: one Stop pressed holds for its run until the run is no longer working.
    const other = run(25, 'Theme switch in the header', 'running')
    render(panel({ subagents: [other] }))
    fireEvent.click(screen.getByRole('button', { name: /^Theme switch/ }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Theme switch in the header' })).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(sendStop).toHaveBeenCalledWith('p1', other.id))
    cleanup()
    render(panel({ events: call('toolu_a', 'Find colours written by hand', 28) }))
    fireEvent.click(screen.getByRole('button', { name: /^Find colours/ }))
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull()
  })

  test('a Stop the daemon refused is said in its words on a line of its own, never in a failure\'s place or colour', async () => {
    sendStop.mockResolvedValue({ ok: false, error: 'The run is not live.' })
    const working = run(26, 'Visual check in a browser', 'running')
    render(panel({ subagents: [working, run(5, 'Map the pages', 'failed', 2)], events: [{ kind: 'driver', event: { type: 'start', prompt: `The run ${run(5, 'Map the pages', 'failed', 2).id}, started for this run, ended failed: Chrome did not start.` }, at: '2026-10-01T10:08:00.000Z' }] }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop Visual check in a browser' }))
    const refusal = await screen.findByText('The run is not live.')
    expect(refusal.className).not.toContain('text-danger')
    expect(screen.getByText('Chrome did not start').className).toContain('text-danger')
    fireEvent.click(screen.getByRole('button', { name: /^Visual check in a browser/ }))
    const part = screen.getByRole('region', { name: 'Visual check in a browser' })
    fireEvent.click(within(part).getByRole('button', { name: 'Stop' }))
    const said = await within(part).findByText('The run is not live.')
    expect(said.className).not.toContain('text-danger')
  })

  test('its Stop gone once the run stopped, the keyboard stays: on its row, moved under Ended, or in its open part on its next press', async () => {
    const working = run(26, 'Visual check in a browser', 'running')
    const stopped = (meta: AgentMeta): AgentMeta => ({ ...meta, status: 'stopped', endedAt: '2026-10-01T10:29:00.000Z' })
    // The page's chat is a home of its own before the pane, as it is beside it.
    const withChat = (props: Parameters<typeof panel>[0]) => (
      <>
        <FocusHome>
          <button type="button">The chat</button>
        </FocusHome>
        {panel(props)}
      </>
    )
    const list = render(withChat({ subagents: [working] }))
    const stop = screen.getByRole('button', { name: 'Stop Visual check in a browser' })
    stop.focus()
    fireEvent.click(stop)
    await waitFor(() => expect(sendStop).toHaveBeenCalledWith('p1', working.id))
    list.rerender(withChat({ subagents: [stopped(working)] }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Visual check in a browser/ })))
    cleanup()
    const other = run(27, 'Print styles', 'running')
    const opened = render(panel({ subagents: [other], onOpenAgent: () => {} }))
    fireEvent.click(screen.getByRole('button', { name: /^Print styles/ }))
    const part = screen.getByRole('region', { name: 'Print styles' })
    within(part).getByRole('button', { name: 'Stop' }).focus()
    fireEvent.click(within(part).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(sendStop).toHaveBeenCalledWith('p1', other.id))
    opened.rerender(panel({ subagents: [stopped(other)], onOpenAgent: () => {} }))
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('region', { name: 'Print styles' })).getByRole('button', { name: 'Open its page' })))
  })

  test('past eight rows in all, the ended ones fold into one row that says how many and opens them; once pressed the fold is the person\'s, for the page', () => {
    const events = Array.from({ length: 8 }, (_, at) => call(`toolu_${at}`, `Ended ${at}`, at, 'ended')).flat()
    // A page of its own: the person's fold is kept for the page.
    render(panel({ subagents: [run(24, 'Account page tests', 'running')], events, agentId: 'folds' }))
    const fold = screen.getByRole('button', { name: 'Ended · 8' })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(rowNames()).toEqual(['Account page tests · working'])
    fireEvent.click(fold)
    expect(rowNames()).toHaveLength(9)
    cleanup()
    render(panel({ subagents: [run(24, 'Account page tests', 'running')], events, agentId: 'folds' }))
    expect(screen.getByRole('button', { name: 'Ended · 8' }).getAttribute('aria-expanded')).toBe('true')
    cleanup()
    // Eight in all stay open.
    render(panel({ events: events.slice(0, 14) }))
    expect(screen.queryByRole('button', { name: /^Ended ·/ })).toBeNull()
    expect(rowNames()).toHaveLength(7)
  })

  test('forty, two failed and one asking: those three are the first rows, and the ended ones are folded', () => {
    const ended = Array.from({ length: 37 }, (_, at) => run(at % 30, `Ended ${at}`, 'done', 0))
    const subagents = [...ended.map((sub, at) => ({ ...sub, id: `${sub.id}-${at}` })), run(20, 'Visual check in a browser', 'failed', 1), run(22, 'Pick a palette', 'waiting'), run(21, 'Map the pages', 'failed', 1)]
    render(panel({ subagents }))
    expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual(['Needs you', 'Failed'])
    expect(rowNames().map(name => name?.split(' · ')[0])).toEqual(['Pick a palette', 'Visual check in a browser', 'Map the pages'])
    expect(screen.getByRole('button', { name: 'Ended · 37' }).getAttribute('aria-expanded')).toBe('false')
  })

  test('a ninth row arriving while the pointer is in the list folds nothing until the pointer leaves', () => {
    const ended = Array.from({ length: 7 }, (_, at) => run(at, `Ended ${at}`, 'done', 1))
    const list = render(panel({ subagents: [run(24, 'Account page tests', 'running'), ...ended] }))
    const under = screen.getByRole('button', { name: /^Ended 3/ })
    pointTo(under)
    list.rerender(panel({ subagents: [run(24, 'Account page tests', 'running'), ...ended, run(26, 'Print styles', 'running')] }))
    expect(screen.queryByRole('button', { name: /^Ended ·/ })).toBeNull()
    expect(rowButtons()[4]).toBe(under)
    pointAway(under)
    expect(screen.getByRole('button', { name: 'Ended · 7' }).getAttribute('aria-expanded')).toBe('false')
  })

  test('under the pointer a card says the row whole: its name, what it runs on, and how it stands', async () => {
    vi.useRealTimers()
    const sub = run(1, 'Read the theme tokens', 'done', 7)
    render(panel({ subagents: [sub] }))
    const tip = await hoverTooltip(screen.getByRole('button', { name: /^Read the theme tokens/ }))
    // The dot before its time is drawn, not said.
    expect(tip.textContent).toBe('Read the theme tokensclaude-sonnet-5-5Doneran 7m 0s')
  })

  test('with no model known, a card comes only where the row cuts the name, and then says its state alone', async () => {
    vi.useRealTimers()
    const { model: _model, ...sub } = run(1, 'Read the theme tokens', 'done', 7)
    // jsdom lays nothing out: every box is 0 wide, so a name is cut once it is wider than that.
    const width = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(0)
    render(panel({ subagents: [sub] }))
    const row = screen.getByRole('button', { name: /^Read the theme tokens/ })
    fireEvent.mouseEnter(row)
    fireEvent.mouseMove(row)
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(screen.queryByRole('tooltip')).toBeNull()
    cleanup()
    width.mockReturnValue(400)
    render(panel({ subagents: [sub] }))
    const tip = await hoverTooltip(screen.getByRole('button', { name: /^Read the theme tokens/ }))
    expect(tip.textContent).toBe('Read the theme tokensDoneran 7m 0s')
    width.mockRestore()
  })
})

describe('the subagent a row opened', () => {
  test("a subagent of the coding agent's own: its whole prompt, its model, then what it said and did, out of the main agent's log", () => {
    const events: OpenAgentEvent[] = [
      { kind: 'driver', event: { type: 'action', label: 'Agent', detail: 'Map the pages', id: 'toolu_a' }, at: '2026-10-01T10:00:10.000Z' },
      { kind: 'driver', event: { type: 'subagent', id: 'toolu_a', status: 'working', name: 'Map the pages', role: 'Explore', model: 'claude-haiku-5-5', prompt: 'Read how the pages are served.\nStart at server.ts.' }, at: '2026-10-01T10:00:10.000Z' },
      { kind: 'driver', event: { type: 'action', label: 'Read', detail: 'src/server.ts', id: 'toolu_b', subagent: 'toolu_a' }, at: '2026-10-01T10:00:12.000Z' },
      { kind: 'driver', event: { type: 'text', text: 'The pages are served by server.ts.', subagent: 'toolu_a' }, at: '2026-10-01T10:00:20.000Z' },
      { kind: 'driver', event: { type: 'text', text: 'The main agent’s own words.' }, at: '2026-10-01T10:00:30.000Z' },
    ]
    render(panel({ events }))
    act(() => revealSubagent('p1/main', 'call:toolu_a'))
    expect(within(screen.getByRole('region', { name: 'Map the pages' })).getByRole('heading').textContent).toBe('Map the pages')
    expect(screen.getByText('claude-haiku-5-5')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Its prompt' }).textContent).toContain('Read how the pages are served.\nStart at server.ts.')
    expect(screen.getByText('The pages are served by server.ts.')).toBeTruthy()
    expect(screen.getByText('server.ts')).toBeTruthy()
    expect(screen.queryByText('The main agent’s own words.')).toBeNull()
    // It has no page of its own to open.
    expect(screen.queryByRole('button', { name: 'Open its page' })).toBeNull()
  })

  test('a subagent that is a run of its own: its model and effort, its cost and its branch, its prompt, then its own log; its page is one click away', async () => {
    onAgent.mockResolvedValue([{ kind: 'driver', event: { type: 'text', text: 'I wrote the docs.' }, at: '2026-10-01T10:02:00.000Z' }] satisfies OpenAgentEvent[])
    const opened: string[] = []
    const sub: AgentMeta = {
      status: 'done',
      id: '2026-10-01T10-01-00-000Z',
      startedAt: '2026-10-01T10:01:00.000Z',
      updatedAt: '2026-10-01T10:03:00.000Z',
      endedAt: '2026-10-01T10:02:07.000Z',
      parent: 'main',
      title: 'Write the docs',
      intent: 'Write the README.\n\nYou are a subagent.',
      model: 'claude-sonnet-5-5',
      effort: 'high',
      cost: 0.36,
      branch: 'agent-2026-10-01T10-01-00-000Z',
    }
    render(panel({ subagents: [sub], onOpenAgent: id => opened.push(id) }))
    act(() => revealSubagent('p1/main', `run:${sub.id}`))
    expect(within(screen.getByRole('region', { name: 'Write the docs' })).getByRole('heading').textContent).toBe('Write the docs')
    expect(screen.getByRole('region', { name: 'Its prompt' }).textContent).toContain('You are a subagent.')
    // What it runs on, as its card says it.
    expect(factsLine('claude-sonnet-5-5 · high')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('I wrote the docs.')).toBeTruthy())
    // Under the log once its read answered: a slow read's shape is held a moment longer, so it does not flash.
    await waitFor(() => expect(factsLine(`1m 7s · $0.36 · on ${sub.branch}`)).toBeTruthy())
    expect(onAgent).toHaveBeenCalledWith('p1', sub.id)
    fireEvent.click(screen.getByRole('button', { name: 'Open its page' }))
    expect(opened).toEqual([sub.id])
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
    expect(within(log).queryByText('Nothing said or done yet.')).toBeNull()
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

  test('it says it has nothing to show only once the read answered, and a log read before is there from the first frame', async () => {
    const sub: AgentMeta = { status: 'done', id: '2026-10-01T10-05-00-000Z', startedAt: '2026-10-01T10:05:00.000Z', updatedAt: '2026-10-01T10:06:00.000Z', endedAt: '2026-10-01T10:06:00.000Z', parent: 'main', title: 'Fix the typo', intent: 'Fix it.' }
    let answer: (events: OpenAgentEvent[]) => void = () => {}
    onAgent.mockReturnValue(new Promise(resolve => (answer = resolve)))
    render(panel({ subagents: [sub] }))
    act(() => revealSubagent('p1/main', `run:${sub.id}`))
    expect(screen.queryByText('It left nothing to show.')).toBeNull()
    await act(async () => answer([{ kind: 'driver', event: { type: 'text', text: 'Fixed it.' }, at: '2026-10-01T10:05:30.000Z' }]))
    expect(screen.getByText('Fixed it.')).toBeTruthy()
    // Opened again, with a read that has not answered yet: what was read before is shown at once.
    cleanup()
    onAgent.mockReturnValue(new Promise(() => {}))
    render(panel({ subagents: [sub] }))
    expect(screen.getByText('Fixed it.')).toBeTruthy()
  })

  test('a read of its log that failed is said: what was read stays, not up to date; and with nothing read yet, it never says it has nothing to show', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-10-01T10:30:00.000Z'))
    onAgent.mockResolvedValueOnce([{ kind: 'driver', event: { type: 'text', text: 'Checked the header.' }, at: '2026-10-01T10:27:00.000Z' }] satisfies OpenAgentEvent[]).mockRejectedValue(new Error('The daemon did not answer'))
    const working = run(26, 'Visual check in a browser', 'running')
    render(panel({ subagents: [working] }))
    act(() => revealSubagent('p1/main', `run:${working.id}`))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText('Checked the header.')).toBeTruthy()
    expect(screen.queryByText('Not up to date')).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(screen.getByText('Not up to date')).toBeTruthy()
    expect(screen.getByText('Checked the header.')).toBeTruthy()
    cleanup()
    const ended = run(1, 'Fix the typo', 'done', 1)
    render(panel({ subagents: [ended] }))
    act(() => revealSubagent('p1/main', `run:${ended.id}`))
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(screen.queryByText('It left nothing to show.')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Fix the typo' })).getByRole('status').textContent).toBe('Loading…')
  })

  test('an ask for a subagent that is not one of this run’s opens none of them', () => {
    render(panel({ subagents: [run(1, 'Write the docs', 'done', 1)] }))
    act(() => revealSubagent('p1/main', 'run:gone'))
    expect(screen.queryByRole('button', { name: /^Close / })).toBeNull()
    expect(screen.getByRole('button', { name: /^Write the docs/ }).getAttribute('aria-expanded')).toBe('false')
  })
})
