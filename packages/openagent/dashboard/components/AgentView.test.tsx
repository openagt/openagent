import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { OpenAgentEvent } from '../../src/index.js'
import { ModulesContext, type MountedModules } from '../lib/use-modules.js'
import type { ModuleRunProps } from '../module/index.js'

const onAgent = vi.fn(async () => [] as unknown)
const onRetainedWorktrees = vi.fn(async () => [] as unknown)
const onAgentHandoff = vi.fn(async () => null as unknown)
const onAgentsDoing = vi.fn(async () => ({}) as unknown)
const onBridgeQuestion = vi.fn(async () => null as unknown)
const onBridgeEvents = vi.fn(async () => [] as unknown)
const onBridgeAnswer = vi.fn(async () => null as unknown)
const onAgentWorktree = vi.fn(async () => ({ branch: 'agent-x' }) as unknown)
vi.mock('../rpc/reads.js', () => ({ onAgent, onRetainedWorktrees, onAgentHandoff, onAgentsDoing, onBridgeQuestion, onBridgeEvents, onBridgeAnswer, onAgentWorktree }))
const sendMessage = vi.fn(async () => ({ ok: true }) as unknown)
vi.mock('../rpc/control.js', () => ({
  sendMessage,
  sendOpenPullRequest: vi.fn(async () => null),
  sendSetHandoff: vi.fn(async () => null),
  sendBridgeAnswer: vi.fn(async () => null),
  sendBridgeAnswerCancel: vi.fn(async () => null),
  sendStart: vi.fn(async () => null),
  sendChoice: vi.fn(async () => null),
}))
// The page's parts read the preferences module, whose RPC reads must not fetch a daemon that is
// not there.
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => ({}),
  updatePreferences: vi.fn(),
}))

// The frame around the feed is not under test: the bar and composer reach for git and session
// state of their own, and the swap decision this file cares about is visible in the feed alone.
// The `actions` and `summary` slots of the bar above the message box ARE rendered, so the handoff
// cluster and the modules' summaries stay reachable.
vi.mock('./AgentActionBar.js', () => ({
  AgentActionBar: ({ ready, checkout, onToggle, runsOn }: { ready?: boolean; checkout: unknown; onToggle?: () => void; runsOn?: string }) => (
    <>
      <span data-testid="bar-runs-on">{runsOn}</span>
      <button type="button" onClick={onToggle}>details</button>
      <span data-testid="bar-ready">{String(ready)}</span>
      <span data-testid="bar-checkout">{JSON.stringify(checkout)}</span>
    </>
  ),
}))
vi.mock('./AgentWorkBar.js', () => ({
  AgentWorkBar: ({ actions, summary, checkout, show }: { actions?: ReactNode; summary?: ReactNode; checkout: unknown; show: boolean }) => (
    <div data-testid="work-bar" data-show={String(show)}>
      <span data-testid="work-checkout">{JSON.stringify(checkout)}</span>
      {summary}
      {actions}
    </div>
  ),
}))
// The composer shows only what the view tells it about the run going: the one fact of it under test here.
vi.mock('./AgentComposer.js', () => ({
  AgentComposer: ({ live, outcome, model, onQueued }: { live: boolean; outcome?: unknown; model?: string; onQueued?: (text: string) => void }) => (
    <>
      <button type="button" onClick={() => onQueued?.('and then this')}>queue-one</button>
      <span data-testid="composer-model">{model ?? ''}</span>
      <span data-testid="composer-live">{String(live)}</span>
      <span data-testid="composer-outcome">{JSON.stringify(outcome ?? null)}</span>
    </>
  ),
}))

const { AgentView } = await import('./AgentView.js')

const LIVE_EVENTS = [{ kind: 'log', message: 'the channel delivered this line' }] as OpenAgentEvent[]
const ARCHIVED = [{ kind: 'log', message: 'the archive delivered this line' }] as OpenAgentEvent[]

const view = (over: Partial<Parameters<typeof AgentView>[0]> = {}) => (
  <AgentView projectId="p1" agentId="run-1" events={LIVE_EVENTS} live={false} files={[]} {...over} />
)

beforeEach(() => {
  vi.clearAllMocks()
  onRetainedWorktrees.mockResolvedValue([])
  onAgentHandoff.mockResolvedValue(null)
  onAgentWorktree.mockResolvedValue({ branch: 'agent-x' })
})
afterEach(cleanup)

describe('AgentView event source (#1026/#1383)', () => {
  test('a finished run swaps to its archived log once it has events', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    render(view())
    await waitFor(() => expect(onAgent).toHaveBeenCalledWith('p1', 'run-1'))
    await waitFor(() => expect(screen.getByText(/the archive delivered this line/)).toBeTruthy())
    expect(screen.queryByText(/the channel delivered this line/)).toBeNull()
  })

  test('an empty archive never replaces the events already on screen (#1383)', async () => {
    // `onAgent` answers `[]` for "not archived yet" as well as "gone", and a Stop races the archive
    // write: swapping a populated live feed for that `[]` blanked the view to "This session has
    // no events." until a manual refresh.
    onAgent.mockResolvedValue([])
    render(view())
    await waitFor(() => expect(screen.getByText(/the channel delivered this line/)).toBeTruthy())
    expect(screen.queryByText('This agent has no events.')).toBeNull()
  })

  test('a finished run with nothing anywhere still says it has no events', async () => {
    onAgent.mockResolvedValue([])
    render(view({ events: [] }))
    await waitFor(() => expect(onAgent).toHaveBeenCalledWith('p1', 'run-1'))
    await waitFor(() => expect(screen.getByText('This agent has no events.')).toBeTruthy())
  })

  test('a stale archive never hides a resumed leg: the channel wins the moment it knows more (#1460)', async () => {
    // On Resume the new leg streams over the channel while `live` waits on the 2s runs poll.
    // Serving the frozen archive for that window rendered nothing of the continuation — or, when
    // the poll lost the race outright, nothing until a manual refresh.
    onAgent.mockResolvedValue(ARCHIVED)
    const resumed = [
      ...ARCHIVED,
      { kind: 'session', driver: 'claude-code', workspace: '/w' },
      { kind: 'log', message: 'the resumed leg streamed this line' },
    ] as OpenAgentEvent[]
    render(view({ events: resumed }))
    await waitFor(() => expect(screen.getByText(/the resumed leg streamed this line/)).toBeTruthy())
  })

  test("a foreign journal's events never beat this run's archive, however long (#1460)", async () => {
    // The live channel is not guaranteed to be this agent's journal: an ended agent whose worktree is
    // gone resolves to the project ROOT journal server-side, which holds whatever root run wrote
    // it last. "The channel knows more" must not let that longer foreign feed replace the archive.
    onAgent.mockResolvedValue(ARCHIVED)
    const foreign = [
      { kind: 'log', message: 'a different run wrote this line' },
      { kind: 'session', driver: 'claude-code', workspace: '/w' },
      { kind: 'log', message: 'and its newest segment never ended' },
    ] as OpenAgentEvent[]
    render(view({ events: foreign }))
    await waitFor(() => expect(screen.getByText(/the archive delivered this line/)).toBeTruthy())
    expect(screen.queryByText(/a different run wrote this line/)).toBeNull()
  })

  test('an archive that catches up takes back over, bringing the epilogue events with it (#1460)', async () => {
    // A line written as the run is recorded only ever lands in the archive — the worktree journal
    // dies with the teardown — so once the feed outgrows the copy on screen the archive is re-read,
    // and the re-read is how the PR line reaches the screen without a manual refresh.
    const ahead = [...ARCHIVED, { kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'end', ok: true }] as OpenAgentEvent[]
    const full = [...ahead, { kind: 'pull-request', number: 7, url: 'https://x/pr/7' }] as OpenAgentEvent[]
    onAgent.mockResolvedValueOnce(ARCHIVED).mockResolvedValue(full)
    render(view({ events: ahead }))
    await waitFor(() => expect(onAgent.mock.calls.length).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(screen.getByText(/pull request: #7/)).toBeTruthy())
  })
})

describe('AgentView: a continued run reads as going', () => {
  test('once the feed showed the new turn, the run stays going while the archive catches up and the poll has not said so yet, and ends with the turn', async () => {
    const ended = [{ kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'log', message: 'first turn' }, { kind: 'end', ok: true }] as OpenAgentEvent[]
    const going = [...ended, { kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'log', message: 'second turn' }] as OpenAgentEvent[]
    // The archive as it was, then caught up with the channel: the same lines, no more.
    onAgent.mockResolvedValueOnce(ended).mockResolvedValue(going)
    const { rerender } = render(view({ events: ended }))
    await waitFor(() => expect(screen.getByText(/first turn/)).toBeTruthy())
    expect(screen.getByTestId('composer-live').textContent).toBe('false')

    rerender(view({ events: going }))
    await waitFor(() => expect(screen.getByTestId('composer-live').textContent).toBe('true'))
    // The archive is read again and now holds as much as the channel: still going, with the poll still saying ended.
    await waitFor(() => expect(onAgent.mock.calls.length).toBeGreaterThanOrEqual(2))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.getByTestId('composer-live').textContent).toBe('true')

    // The turn ends in the log: the run is over, whatever the poll says.
    const over = [...going, { kind: 'end', ok: true }] as OpenAgentEvent[]
    onAgent.mockResolvedValue(over)
    rerender(view({ events: over }))
    await waitFor(() => expect(screen.getByTestId('composer-live').textContent).toBe('false'))
  })

  test('an ended run whose archive holds an open turn the feed never showed starting is not read as going', async () => {
    const open = [{ kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'log', message: 'cut short' }] as OpenAgentEvent[]
    onAgent.mockResolvedValue(open)
    render(view({ events: open }))
    await waitFor(() => expect(screen.getByText(/cut short/)).toBeTruthy())
    expect(screen.getByTestId('composer-live').textContent).toBe('false')
  })
})

/** A branch with a commit of its own and no pull request: what Open PR is offered for. */
const PUSHED = {
  branch: 'agent-add-hello2',
  exists: true,
  empty: false,
  hasRemote: true,
  pushed: true,
  gitHost: true,
  commits: [{ sha: 'abc1234', subject: 'Add hello2.txt' }],
  files: [],
} as Record<string, unknown>

describe('AgentView: the bar above the message box', () => {
  test("the agent's checkout is read once, for the top bar and for the bar above the message box", async () => {
    onAgentWorktree.mockResolvedValue({ branch: 'agent-add-hello2' })
    render(view())
    await waitFor(() => expect(screen.getByTestId('work-checkout').textContent).toBe('{"branch":"agent-add-hello2"}'))
    expect(screen.getByTestId('bar-checkout').textContent).toBe('{"branch":"agent-add-hello2"}')
    expect(onAgentWorktree).toHaveBeenCalledTimes(1)
    expect(onAgentWorktree).toHaveBeenCalledWith('p1', 'run-1')
  })

  test('the checkout is read again the moment a turn ends, not at the next poll', async () => {
    const going = [{ kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'driver', event: { type: 'start', prompt: 'Add a page' } }] as OpenAgentEvent[]
    onAgentWorktree.mockResolvedValue({ branch: 'agent-x', checkout: { path: '/w', dirty: false } })
    const { rerender } = render(view({ events: going, live: true }))
    await waitFor(() => expect(screen.getByTestId('work-checkout').textContent).toContain('"dirty":false'))
    expect(onAgentWorktree).toHaveBeenCalledTimes(1)
    onAgentWorktree.mockResolvedValue({ branch: 'agent-x', checkout: { path: '/w', dirty: true } })
    rerender(view({ events: [...going, { kind: 'end', ok: true }] as OpenAgentEvent[], live: true }))
    await waitFor(() => expect(screen.getByTestId('work-checkout').textContent).toContain('"dirty":true'))
    expect(onAgentWorktree).toHaveBeenCalledTimes(2)
  })

  test('the next step is in the bar above the message box, which sits under the feed', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    onAgentHandoff.mockResolvedValue(PUSHED)
    render(view())
    const step = await screen.findByRole('button', { name: 'Open PR' })
    expect(screen.getByTestId('work-bar').contains(step)).toBe(true)
    expect(screen.getByTestId('work-bar').dataset.show).toBe('true')
    // After the top bar and before the message box, in the page's order.
    const order = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(order(screen.getByTestId('bar-ready'), screen.getByTestId('work-bar'))).toBe(true)
    expect(order(screen.getByTestId('work-bar'), screen.getByTestId('composer-live'))).toBe(true)
  })
})

describe('AgentView: when the bar above the message box is there', () => {
  const shown = () => screen.getByTestId('work-bar').dataset.show

  test('a working agent has the bar once its checkout holds changes, and none before', async () => {
    onAgentWorktree.mockResolvedValue({ branch: 'agent-x', checkout: { path: '/w', dirty: false } })
    const { unmount } = render(view({ live: true }))
    await waitFor(() => expect(screen.getByTestId('work-checkout').textContent).toContain('"dirty":false'))
    expect(shown()).toBe('false')
    unmount()
    onAgentWorktree.mockResolvedValue({ branch: 'agent-y', checkout: { path: '/w', dirty: true } })
    const { rerender } = render(view({ live: true, agentId: 'run-2' }))
    await waitFor(() => expect(shown()).toBe('true'))
    // It commits: its checkout is clean again, and the bar stays.
    onAgentWorktree.mockResolvedValue({ branch: 'agent-y', checkout: { path: '/w', dirty: false } })
    rerender(view({ live: true, agentId: 'run-2', events: [...LIVE_EVENTS, ...LIVE_EVENTS] }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(shown()).toBe('true')
  })

  test('an ended agent that changed nothing has no bar; one with a pull request has it', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    onAgentHandoff.mockResolvedValue({ ...PUSHED, empty: true, commits: [] })
    const { unmount } = render(view())
    await waitFor(() => expect(onAgentHandoff).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(shown()).toBe('false')
    unmount()
    onAgentWorktree.mockResolvedValue({ branch: 'agent-z', pr: { number: 3, url: 'https://x/pull/3', state: 'MERGED', title: 'T' } })
    render(view({ agentId: 'run-3' }))
    await waitFor(() => expect(shown()).toBe('true'))
  })

  test('as the agent ends, the bar stays while its branch is read, then says what the branch holds', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    onAgentWorktree.mockResolvedValue({ branch: 'agent-x', checkout: { path: '/w', dirty: true } })
    let answer: (handoff: unknown) => void = () => {}
    onAgentHandoff.mockReturnValue(new Promise(resolve => (answer = resolve)) as never)
    const { rerender } = render(view({ live: true }))
    await waitFor(() => expect(shown()).toBe('true'))
    // Ended: its checkout is gone, its branch not read yet.
    onAgentWorktree.mockResolvedValue({ branch: 'agent-x' })
    rerender(view({ live: false }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(shown()).toBe('true')
    answer({ ...PUSHED, empty: true, commits: [] })
    await waitFor(() => expect(shown()).toBe('false'))
  })
})

describe('AgentView branch read', () => {
  test('while the card says saving, an empty branch is not offered, and the branch is read again once it stops', async () => {
    // The checkout is cleaned up while saving, and an empty branch is deleted with it: a publish
    // offered in that window turned into "Branch gone" moments later.
    onAgent.mockResolvedValue(ARCHIVED)
    onAgentHandoff.mockResolvedValue({ ...PUSHED, empty: true, pushed: false })
    const { rerender } = render(view({ card: { status: 'done', saving: true } }))
    await waitFor(() => expect(onAgentHandoff).toHaveBeenCalledWith('p1', 'run-1'))
    expect(screen.queryByRole('button', { name: 'Open PR' })).toBeNull()
    const reads = onAgentHandoff.mock.calls.length
    onAgentHandoff.mockResolvedValue(PUSHED)
    rerender(view({ card: { status: 'done' } }))
    await waitFor(() => expect(onAgentHandoff.mock.calls.length).toBeGreaterThan(reads))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open PR' })).toBeTruthy())
  })

  test('a branch with commits, pushed or not, is offered while the card still says saving: the clean-up keeps it', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    onAgentHandoff.mockResolvedValue({ ...PUSHED, pushed: false })
    render(view({ card: { status: 'done', saving: true } }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open PR' })).toBeTruthy())
  })
})

describe('the next step of a run whose subagents still work', () => {
  const sub = (over: Record<string, unknown>) => ({ id: 'c1', parent: 'run-1', startedAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', status: 'done', ...over }) as never

  test('Open PR is not offered while a subagent works, and is once none does', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    onAgentHandoff.mockResolvedValue(PUSHED)
    const { rerender } = render(view({ card: { status: 'done' }, subagents: [sub({ status: 'running' })] }))
    await waitFor(() => expect(onAgentHandoff).toHaveBeenCalledWith('p1', 'run-1'))
    await waitFor(() => expect(screen.getByTestId('bar-ready').textContent).toBe('true'))
    expect(screen.queryByRole('button', { name: 'Open PR' })).toBeNull()
    rerender(view({ card: { status: 'done' }, subagents: [sub({ status: 'done', endedAt: '2026-10-01T10:02:00.000Z' })] }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open PR' })).toBeTruthy())
  })

  test('nor right after a subagent ended: its main agent is about to go on', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    onAgentHandoff.mockResolvedValue(PUSHED)
    render(view({ card: { status: 'done' }, subagents: [sub({ status: 'done', endedAt: new Date().toISOString() })] }))
    await waitFor(() => expect(screen.getByTestId('bar-ready').textContent).toBe('true'))
    expect(screen.queryByRole('button', { name: 'Open PR' })).toBeNull()
  })
})

describe('a subagent’s own page', () => {
  test('a run started for another run is offered no pull request: it says whether it is landed, and nothing of pushed', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    onAgentHandoff.mockResolvedValue(PUSHED)
    const { rerender } = render(view({ card: { status: 'done', parent: 'run-0' } }))
    await waitFor(() => expect(screen.getByText('not landed')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Open PR' })).toBeNull()
    expect(screen.queryByText('· pushed')).toBeNull()
    // The same branch on a run nobody started for another is offered its pull request.
    rerender(view({ card: { status: 'done' } }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open PR' })).toBeTruthy())
    expect(screen.queryByText('not landed')).toBeNull()
  })
})

// The Resume offer (#1391) moved into the composer's submit slot (#1455): its when-offered rules
// are AgentComposer's now, tested there — AgentView only hands `outcome` down.

describe('how the agent ended, for the message box', () => {
  test("the card says it until the agent's events are read, then the events do", async () => {
    let log: (v: unknown) => void = () => {}
    onAgent.mockReturnValue(new Promise(resolve => (log = resolve)))
    render(view({ card: { status: 'waiting' } }))
    // From the first frame, with no event read yet.
    expect(screen.getByTestId('composer-outcome').textContent).toBe('{"ok":false,"stopped":false,"waiting":true}')
    log([...ARCHIVED, { kind: 'end', ok: false, stopped: true }])
    await waitFor(() => expect(screen.getByTestId('composer-outcome').textContent).toBe('{"ok":false,"stopped":true}'))
  })

  test('with no card and no event it says nothing', () => {
    onAgent.mockReturnValue(new Promise(() => {}))
    render(view())
    expect(screen.getByTestId('composer-outcome').textContent).toBe('null')
  })
})

describe('the bar shows its facts together (run switch)', () => {
  test("an ended run's bar is ready once its log and its branch are read, not before", async () => {
    let log: (v: unknown) => void = () => {}
    let branch: (v: unknown) => void = () => {}
    onAgent.mockReturnValue(new Promise(resolve => (log = resolve)))
    onAgentHandoff.mockReturnValue(new Promise(resolve => (branch = resolve)))
    render(view())
    expect(screen.getByTestId('bar-ready').textContent).toBe('false')
    log(ARCHIVED)
    await waitFor(() => expect(screen.getByText(/the archive delivered this line/)).toBeTruthy())
    expect(screen.getByTestId('bar-ready').textContent).toBe('false')
    branch(null)
    await waitFor(() => expect(screen.getByTestId('bar-ready').textContent).toBe('true'))
  })

  test("the bar waits for the branch's pull request lookup too, so its facts land in one step", async () => {
    // The lookup's second answer is held until the bar has been seen waiting, so the quick re-ask
    // (0.3s) cannot land first.
    let lookup: (v: unknown) => void = () => {}
    onAgent.mockResolvedValue(ARCHIVED)
    onAgentHandoff.mockResolvedValueOnce({ branch: 'b', exists: false, commits: [], files: [], prPending: true })
    onAgentHandoff.mockReturnValueOnce(new Promise(resolve => (lookup = resolve)))
    onAgentHandoff.mockResolvedValue({ branch: 'b', exists: false, commits: [], files: [] })
    render(view())
    await waitFor(() => expect(screen.getByText(/the archive delivered this line/)).toBeTruthy())
    await waitFor(() => expect(onAgentHandoff).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('bar-ready').textContent).toBe('false')
    lookup({ branch: 'b', exists: false, commits: [], files: [] })
    await waitFor(() => expect(screen.getByTestId('bar-ready').textContent).toBe('true'))
  })

  test('a read that never answers holds the bar back one second, no longer', async () => {
    onAgent.mockReturnValue(new Promise(() => {}))
    render(view())
    expect(screen.getByTestId('bar-ready').textContent).toBe('false')
    await waitFor(() => expect(screen.getByTestId('bar-ready').textContent).toBe('true'), { timeout: 3000 })
  })

  test('a running run is ready at once: its channel is its log', () => {
    render(view({ live: true }))
    expect(screen.getByTestId('bar-ready').textContent).toBe('true')
  })
})

describe('the feed fills in one step (first visit)', () => {
  test("an ended run's feed shows nothing until its archive answers, then the archive", async () => {
    // The channel of an ended run whose checkout is gone is the project root's: shown first, it
    // was a step of someone else's events before this run's own.
    let log: (v: unknown) => void = () => {}
    onAgent.mockReturnValue(new Promise(resolve => (log = resolve)))
    render(view({ events: [{ kind: 'log', message: 'a different run wrote this line' }] as OpenAgentEvent[] }))
    expect(screen.queryByText(/a different run wrote this line/)).toBeNull()
    expect(screen.queryByText('Loading agent…')).toBeNull()
    log(ARCHIVED)
    await waitFor(() => expect(screen.getByText(/the archive delivered this line/)).toBeTruthy())
  })

  test('an agent not known to run yet says nothing and reads nothing', () => {
    render(view({ live: null, events: [] }))
    expect(screen.queryByText('Waiting for the session to start…')).toBeNull()
    expect(screen.queryByText('Loading agent…')).toBeNull()
    expect(screen.getByTestId('bar-ready').textContent).toBe('false')
    expect(onAgent).not.toHaveBeenCalled()
    expect(onAgentHandoff).not.toHaveBeenCalled()
  })

  test('an archive that never answers holds the feed back one second, no longer', async () => {
    onAgent.mockReturnValue(new Promise(() => {}))
    render(view({ events: [] }))
    expect(screen.queryByText('Loading agent…')).toBeNull()
    await waitFor(() => expect(screen.getByText('Loading agent…')).toBeTruthy(), { timeout: 3000 })
  })

  test('an agent that stops while watched keeps its events on screen while the archive is read', () => {
    onAgent.mockReturnValue(new Promise(() => {}))
    const { rerender } = render(view({ live: true }))
    expect(screen.getByText(/the channel delivered this line/)).toBeTruthy()
    rerender(view({ live: false }))
    expect(screen.getByText(/the channel delivered this line/)).toBeTruthy()
  })
})

describe('a changed file\'s row in the chat', () => {
  const WS = '/repo/.branches/agent-1'
  const events = [
    { kind: 'driver', event: { type: 'start', prompt: 'go' } },
    { kind: 'driver', event: { type: 'action', label: 'Edit', detail: `${WS}/docs/A.md`, id: 'c1' } },
    { kind: 'driver', event: { type: 'output', id: 'c1', text: 'ok', changed: [{ path: `${WS}/docs/A.md`, added: 2, removed: 1 }] } },
    { kind: 'driver', event: { type: 'text', text: 'Done.' } },
    { kind: 'end', ok: true },
  ] as OpenAgentEvent[]
  const withPanels = (ui: ReactNode, panels: MountedModules['panels']) => {
    const modules: MountedModules = { pages: [], cards: [], linkActions: [], panels, runSlots: [], settings: [], loaded: true }
    return <ModulesContext.Provider value={modules}>{ui}</ModulesContext.Provider>
  }
  const panel = (over: object) => ({ id: 'changes', label: 'Changes', help: '', Panel: () => null, package: '@openagt/files', projects: ['p1'], ...over })

  test('with a tab that lists changes, a click opens this agent\'s side panel and asks for the file by its path in the checkout', async () => {
    const { useRevealedChange, forgetRevealedChanges } = await import('../lib/reveal-change.js')
    forgetRevealedChanges()
    localStorage.removeItem('oa.side-panel')
    const Asked = () => <span data-testid="asked">{useRevealedChange('p1/run-1')?.path ?? ''}</span>
    onAgent.mockResolvedValue(events)
    render(withPanels(<>{view({ events, card: { status: 'done', workspace: WS } })}<Asked /></>, [panel({ changes: true as const })]))
    fireEvent.click(await screen.findByRole('button', { name: 'Show the change to A.md' }))
    expect(screen.getByTestId('asked').textContent).toBe('docs/A.md')
    expect(JSON.parse(localStorage.getItem('oa.side-panel') ?? '[]')).toEqual(['p1/run-1'])
  })

  test('with no such tab, or one of another project, the row is there and is no button', async () => {
    onAgent.mockResolvedValue(events)
    const { unmount } = render(withPanels(view({ events, card: { status: 'done', workspace: WS } }), [panel({})]))
    expect((await screen.findByRole('list', { name: 'Files changed' })).textContent).toBe('A.md+2 −1')
    expect(screen.queryByRole('button', { name: 'Show the change to A.md' })).toBeNull()
    unmount()
    render(withPanels(view({ events, card: { status: 'done', workspace: WS } }), [panel({ changes: true as const, projects: ['p2'] })]))
    await screen.findByRole('list', { name: 'Files changed' })
    expect(screen.queryByRole('button', { name: 'Show the change to A.md' })).toBeNull()
  })
})

describe('what the modules add to a run’s page (#817)', () => {
  const Summary = ({ agentId, working }: ModuleRunProps) => <span>summary {agentId} {String(working)}</span>
  const withSlots = (ui: ReactNode, projects = ['p1']) => {
    const modules: MountedModules = { pages: [], cards: [], linkActions: [], panels: [], runSlots: [{ summary: Summary, package: '@openagt/files', projects }], settings: [], loaded: true }
    return <ModulesContext.Provider value={modules}>{ui}</ModulesContext.Provider>
  }

  test('a working run shows the modules’ summary in the bar above the message box', async () => {
    render(withSlots(view({ live: true })))
    expect(screen.getByTestId('work-bar').contains(screen.getByText('summary run-1 true'))).toBe(true)
  })

  test('once an ended run’s branch is read, the handoff replaces the summary', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    onAgentHandoff.mockResolvedValue({ branch: 'agent-x', exists: true, commits: [], files: [], insertions: 0, deletions: 0, pushed: false })
    render(withSlots(view({ live: false })))
    await waitFor(() => expect(screen.queryByText(/^summary/)).toBeNull())
  })

  test('a project without the module gets none of it', () => {
    render(withSlots(view({ live: true }), ['p2']))
    expect(screen.queryByText(/^summary/)).toBeNull()
  })
})

describe('AgentView: what the top bar opens to', () => {
  test('an ended agent with commits: the agent, model and spend strip, and no list of commits or files', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    onAgentHandoff.mockResolvedValue(PUSHED)
    render(view())
    await screen.findByRole('button', { name: 'Open PR' })
    expect(screen.queryByText('No spend reported yet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'details' }))
    expect(screen.getByText('No spend reported yet')).toBeTruthy()
    expect(screen.queryByText('Commits')).toBeNull()
    expect(screen.queryByText('Changed files')).toBeNull()
    expect(screen.queryByLabelText('Agent handoff')).toBeNull()
  })
})

// The question an agent stopped on is asked above the message box, not in the chat.
describe('a question the agent stopped on', () => {
  const asked = [
    { kind: 'driver', event: { type: 'start', prompt: 'Pick a database' } },
    { kind: 'driver', event: { type: 'text', text: 'Two would do.' } },
    { kind: 'choice', id: 'await-choices', title: 'Which database?', options: [{ id: 'pg', label: 'Postgres' }, { id: 'lite', label: 'SQLite' }], recommended: 'pg' },
    { kind: 'end', ok: false, waiting: true },
  ] as OpenAgentEvent[]

  test('it is a panel above the message box, and the chat holds one "Asking" line and none of the choices', async () => {
    onAgent.mockResolvedValue(asked)
    render(view({ events: asked }))
    const panel = await screen.findByRole('region', { name: 'Which database?' })
    expect(panel.compareDocumentPosition(screen.getByTestId('composer-live')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByLabelText('Agent output').contains(panel)).toBe(false)
    const chat = screen.getByLabelText('Agent output')
    expect(within(chat).getByRole('button', { name: 'Asking Which database?' })).toBeTruthy()
    expect(chat.textContent).not.toContain('Postgres')
  })

  test('an answer in one\'s own words shows in the chat at once, as the message it is', async () => {
    onAgent.mockResolvedValue(asked)
    render(view({ events: asked }))
    fireEvent.change(await screen.findByLabelText('Other'), { target: { value: 'MySQL' } })
    fireEvent.focus(screen.getByLabelText('Other'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'MySQL', 'run-1'))
    await waitFor(() => expect(screen.getAllByLabelText('Your message').at(-1)!.textContent).toBe('MySQL'))
  })

  test('once the agent has gone on, the panel is gone', async () => {
    const on = [...asked, { kind: 'driver', event: { type: 'start', prompt: 'MySQL' } }] as OpenAgentEvent[]
    onAgent.mockResolvedValue(on)
    render(view({ events: on, live: true }))
    await waitFor(() => expect(screen.getAllByLabelText('Your message')).toHaveLength(2))
    expect(screen.queryByRole('region', { name: 'Which database?' })).toBeNull()
  })
})

// What was a line above the message box is said by the chat.
describe('a message sent while the agent works', () => {
  const start = (prompt: string) => ({ kind: 'driver', event: { type: 'start', prompt } }) as OpenAgentEvent
  const text = { kind: 'driver', event: { type: 'text', text: 'Hi.' } } as OpenAgentEvent
  const queuedBoxes = () => screen.queryAllByLabelText('Your message, queued')

  test('it shows in the chat as queued, each one sent, until the agent\'s next prompt arrives: then it is a read message', () => {
    const { rerender } = render(view({ live: true, events: [start('go'), text] }))
    expect(queuedBoxes()).toHaveLength(0)
    fireEvent.click(screen.getByText('queue-one'))
    fireEvent.click(screen.getByText('queue-one'))
    expect(queuedBoxes().map(n => n.textContent)).toEqual(['and then this', 'and then this'])
    rerender(view({ live: true, events: [start('go'), text, start('and then this')] }))
    expect(queuedBoxes()).toHaveLength(0)
    expect(screen.getAllByLabelText('Your message')).toHaveLength(2)
  })

  test('queued before the agent\'s first event, it is the chat\'s only row, not hidden behind the waiting words', () => {
    render(view({ live: true, events: [] }))
    fireEvent.click(screen.getByText('queue-one'))
    expect(queuedBoxes().map(n => n.textContent)).toEqual(['and then this'])
  })

  test('it is another agent\'s no longer: a switch shows none', () => {
    const { rerender } = render(view({ live: true, events: [start('go'), text] }))
    fireEvent.click(screen.getByText('queue-one'))
    expect(queuedBoxes()).toHaveLength(1)
    rerender(view({ agentId: 'run-2', live: true, events: [start('other'), text] }))
    expect(queuedBoxes()).toHaveLength(0)
  })

  test('an agent that stopped working without reading it shows it for five seconds more, not for good', () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(view({ live: true, events: [start('go'), text] }))
      fireEvent.click(screen.getByText('queue-one'))
      const ended = [start('go'), text, { kind: 'end', ok: false, stopped: true }] as OpenAgentEvent[]
      rerender(view({ live: false, events: ended }))
      act(() => void vi.advanceTimersByTime(4_000))
      expect(queuedBoxes()).toHaveLength(1)
      act(() => void vi.advanceTimersByTime(1_500))
      expect(queuedBoxes()).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('an ended agent whose subagents still work', () => {
  const sub = (over: Record<string, unknown>) => ({ id: 'c1', parent: 'run-1', startedAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', status: 'running', ...over }) as never
  const waits = () => screen.queryAllByRole('status').map(n => n.textContent).filter(t => t?.startsWith('Waiting for'))

  test('the chat\'s last line says how many it waits for; none once they ended', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    const { rerender } = render(view({ card: { status: 'done' }, subagents: [sub({}), sub({ id: 'c2' })] }))
    await waitFor(() => expect(waits()).toEqual(['Waiting for 2 subagents']))
    rerender(view({ card: { status: 'done' }, subagents: [sub({ status: 'done', endedAt: '2026-10-01T10:02:00.000Z' }), sub({ id: 'c2', status: 'done', endedAt: '2026-10-01T10:02:00.000Z' })] }))
    await waitFor(() => expect(waits()).toEqual([]))
  })

  test('a stopped or a failed agent says how it ended, not that it waits; a working one says what it does', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    const { rerender } = render(view({ card: { status: 'stopped' }, subagents: [sub({})] }))
    await waitFor(() => expect(onAgent).toHaveBeenCalled())
    await act(async () => {})
    expect(waits()).toEqual([])
    rerender(view({ card: { status: 'failed' }, subagents: [sub({})] }))
    await act(async () => {})
    expect(waits()).toEqual([])
    rerender(view({ live: true, subagents: [sub({})] }))
    await act(async () => {})
    expect(waits()).toEqual([])
  })
})

describe('where the agent runs, for the chip beside its name', () => {
  test('this machine by itself; another machine by the name it was given; the cloud and GitHub Actions by theirs', () => {
    const runsOn = () => screen.getByTestId('bar-runs-on').textContent
    const { rerender } = render(view({ live: true }))
    expect(runsOn()).toBe('This machine')
    rerender(view({ live: true, target: 'local' }))
    expect(runsOn()).toBe('This machine')
    rerender(view({ live: true, target: 'remote', remoteLabel: 'Studio' }))
    expect(runsOn()).toBe('Studio')
    rerender(view({ live: true, target: 'remote' }))
    expect(runsOn()).toBe('Another machine')
    rerender(view({ live: true, target: 'web' }))
    expect(runsOn()).toBe('Cloud')
    rerender(view({ live: true, target: 'actions' }))
    expect(runsOn()).toBe('GitHub Actions')
  })
})

describe('the model under the message box', () => {
  test('the box is handed the model the agent\'s card names, and none before the card or when it names none', () => {
    const { rerender } = render(view({ live: true, events: [] }))
    expect(screen.getByTestId('composer-model').textContent).toBe('')
    rerender(view({ live: true, events: [], card: { status: 'running', driver: 'claude-code', model: 'opus' } }))
    expect(screen.getByTestId('composer-model').textContent).toMatch(/opus/i)
    rerender(view({ live: true, events: [], card: { status: 'running', driver: 'claude-code' } }))
    expect(screen.getByTestId('composer-model').textContent).toBe('')
  })
})

// A run just started writes its prompt line seconds later: the page shows it at once, and says it is starting.
describe('a run just started', () => {
  test('its prompt shows before any event, with "Starting session" under it, until its own prompt line arrives', () => {
    const { rerender } = render(view({ live: true, events: [], startedWith: 'Say hi' }))
    expect(screen.getByText('Say hi')).toBeTruthy()
    expect(screen.getByText('Starting session')).toBeTruthy()
    const started = [{ kind: 'driver', event: { type: 'start', prompt: 'Say hi' } }, { kind: 'driver', event: { type: 'thought', text: 'hm' } }] as OpenAgentEvent[]
    rerender(view({ live: true, events: started, startedWith: 'Say hi' }))
    expect(screen.getAllByText('Say hi')).toHaveLength(1)
    expect(screen.getByText('Working…')).toBeTruthy()
  })

  test('an agent just started on a machine says nothing of a set-up before its card is listed: no checkout is made for it here', () => {
    const events = [{ kind: 'driver', event: { type: 'start', prompt: 'Say hi' } }, { kind: 'driver', event: { type: 'text', text: 'Hi.' } }] as OpenAgentEvent[]
    render(view({ live: true, events, remoteLabel: 'laptop' }))
    expect(screen.queryByText('Session set up')).toBeNull()
  })

  test('the chat says what was set up for the agent, off its card; before the card is listed the line of an agent at work has nothing to open', () => {
    const events = [{ kind: 'driver', event: { type: 'start', prompt: 'Say hi' } }, { kind: 'driver', event: { type: 'text', text: 'Hi.' } }] as OpenAgentEvent[]
    const { rerender } = render(view({ live: true, events }))
    expect(screen.getByText('Session set up')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Session set up' })).toBeNull()
    rerender(view({ live: true, events, card: { status: 'done', workspace: '/repo/.branches/agent-1', branch: 'agent-1', driver: 'codex' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Session set up' }))
    expect(screen.getByText('/repo/.branches/agent-1')).toBeTruthy()
    expect(screen.getByText('agent-1')).toBeTruthy()
    expect(screen.queryByText(/Started from the branch/)).toBeNull()
    rerender(view({ live: true, events, card: { status: 'done', workspace: '/repo/.branches/agent-1', branch: 'agent-1', base: 'my/work', driver: 'codex' } }))
    expect(screen.getByText(/Started from the branch/).textContent).toBe('Started from the branch my/work, not from the main branch.')
  })

  test('no spinner while the answer is being written, and none once the run has ended', () => {
    const events = [{ kind: 'driver', event: { type: 'start', prompt: 'Say hi' } }] as OpenAgentEvent[]
    const { rerender } = render(view({ live: true, events, writing: 'Hi th' }))
    expect(screen.queryByRole('status')).toBeNull()
    rerender(view({ live: false, events: [...events, { kind: 'end', ok: true }] as OpenAgentEvent[] }))
    expect(screen.queryByText(/Starting…|Working…/)).toBeNull()
  })
})

describe('AgentView: while the agent commits', () => {
  /** An ended run that left a file uncommitted: what the Commit button is offered for. */
  const LEFT = { ...PUSHED, empty: true, pushed: false, hasRemote: false, gitHost: false, commits: [], pendingFiles: ['index.html'] }
  const ended = [{ kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'driver', event: { type: 'start', prompt: 'Add a page' } }, { kind: 'end', ok: true }] as OpenAgentEvent[]

  test('Commit pressed: the ask shows in the feed at once and "Committing…" takes the button\'s place; an ask that did not go through gives the button back', async () => {
    onAgent.mockResolvedValue(ended)
    onAgentHandoff.mockResolvedValue(LEFT)
    let answer: (sent: { ok: boolean; error?: string }) => void = () => {}
    sendMessage.mockReturnValue(new Promise(resolve => (answer = resolve)))
    render(view({ events: ended }))
    fireEvent.click(await screen.findByRole('button', { name: 'Commit' }))
    await waitFor(() => expect(screen.getByText('Committing…')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Commit|Asking/ })).toBeNull()
    expect(screen.getByText('Commit your work.')).toBeTruthy()
    expect(sendMessage).toHaveBeenCalledWith('p1', 'Commit your work.', 'run-1')

    answer({ ok: false, error: 'this project has no resume hook' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Commit' })).toBeTruthy())
    expect(screen.queryByText('Committing…')).toBeNull()
  })

  test('a working agent whose last prompt is the Commit ask says "Committing…", also with a sentence added after it; any other prompt says nothing, and so does an agent that ended', async () => {
    onAgent.mockResolvedValue(ended)
    onAgentHandoff.mockResolvedValue(LEFT)
    const asked = (prompt: string, added?: string) => [...ended, { kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'driver', event: { type: 'start', prompt, ...(added !== undefined ? { added } : {}) } }] as OpenAgentEvent[]
    const { rerender } = render(view({ events: asked('Commit your work.'), live: true }))
    await waitFor(() => expect(screen.getByText('Committing…')).toBeTruthy())
    rerender(view({ events: asked('Commit your work.', 'When you finish, if you changed any file, commit your work, push your branch and open no pull request.'), live: true }))
    expect(screen.getByText('Committing…')).toBeTruthy()
    rerender(view({ events: asked('Commit your work. Then add a footer.'), live: true }))
    expect(screen.queryByText('Committing…')).toBeNull()
    // Ended: the next step is back, whatever the last prompt was.
    const over = [...asked('Commit your work.'), { kind: 'end', ok: true }] as OpenAgentEvent[]
    onAgent.mockResolvedValue(over)
    rerender(view({ events: over, live: false }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Commit' })).toBeTruthy())
    expect(screen.queryByText('Committing…')).toBeNull()
  })
  test('the agent ended and its checkout is being cleaned up: "Committing…" stays until the branch is read, then the next step takes its place', async () => {
    const asked = [...ended, { kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'driver', event: { type: 'start', prompt: 'Commit your work.' } }] as OpenAgentEvent[]
    const over = [...asked, { kind: 'end', ok: true }] as OpenAgentEvent[]
    onAgent.mockResolvedValue(ended)
    onAgentHandoff.mockResolvedValue(LEFT)
    // The answer read before the ask is remembered: it is not what the branch holds after it.
    const { rerender } = render(view({ events: ended }))
    await screen.findByRole('button', { name: 'Commit' })
    rerender(view({ events: asked, live: true }))
    expect(screen.getByText('Committing…')).toBeTruthy()
    let answer: (handoff: unknown) => void = () => {}
    onAgentHandoff.mockReturnValue(new Promise(resolve => (answer = resolve)) as never)
    onAgent.mockResolvedValue(over)
    rerender(view({ events: over, live: false, card: { status: 'done', saving: true } }))
    expect(screen.getByText('Committing…')).toBeTruthy()
    rerender(view({ events: over, live: false, card: { status: 'done' } }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByText('Committing…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull()
    answer({ ...LEFT, empty: false, commits: [{ sha: 'abc1234', subject: 'Add a page' }], pendingFiles: [] })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy())
    expect(screen.queryByText('Committing…')).toBeNull()
  })
})

describe('AgentView: the next step while the agent works again', () => {
  const MERGED = { ...PUSHED, hasRemote: false, gitHost: false, pushed: false, landed: true }
  const ended = [{ kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'driver', event: { type: 'start', prompt: 'Add a page' } }, { kind: 'end', ok: true }] as OpenAgentEvent[]

  test('a message sent to an ended agent takes the last step out of the bar at once, before the agents poll says it works', async () => {
    onAgent.mockResolvedValue(ended)
    onAgentHandoff.mockResolvedValue(MERGED)
    const { rerender } = render(view({ events: ended }))
    await waitFor(() => expect(screen.getByText('Merged into the main branch.')).toBeTruthy())
    expect(screen.getByTestId('work-bar').dataset.show).toBe('true')
    // The feed shows the new turn; the poll still says ended.
    const again = [...ended, { kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'driver', event: { type: 'start', prompt: 'Add a footer' } }] as OpenAgentEvent[]
    rerender(view({ events: again, live: false }))
    await waitFor(() => expect(screen.queryByText('Merged into the main branch.')).toBeNull())
    // It ends with a file left: the bar goes from empty to the new step, the old one never back.
    const over = [...again, { kind: 'end', ok: true }] as OpenAgentEvent[]
    let answer: (handoff: unknown) => void = () => {}
    onAgentHandoff.mockReturnValue(new Promise(resolve => (answer = resolve)) as never)
    onAgent.mockResolvedValue(over)
    rerender(view({ events: over, live: false }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByText('Merged into the main branch.')).toBeNull()
    answer({ ...MERGED, landed: false, empty: true, commits: [], pendingFiles: ['index.html'] })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Commit' })).toBeTruthy())
  })
})
