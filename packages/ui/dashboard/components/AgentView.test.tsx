import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { RunEvent } from '@openagt/hooks'
import { ModulesContext, mountedOf, type MountedView } from '../lib/use-modules.js'
import { questionCard } from '../test-utils.js'
import type { UiRunNoticeProps, UiWorkProps } from '../module/index.js'

const onAgent = vi.fn(async () => [] as unknown)
const onBridgeQuestion = vi.fn(async () => null as unknown)
const onBridgeEvents = vi.fn(async () => [] as unknown)
const onBridgeAnswer = vi.fn(async () => null as unknown)
const onRunCheckout = vi.fn(async () => null as string | null)
// The models each agent lists, with what one of them holds: the daemon's read, stubbed here so the
// context circle has a window to measure against.
vi.mock('../rpc/agents.js', () => ({
  onCodingAgents: () => Promise.resolve([{ id: 'claude-code', label: 'Claude Code', logo: '<svg/>', models: { models: [{ id: 'opus', name: 'Opus 5.5', resolvedId: 'claude-opus-5-5', contextWindow: 200_000 }] } }, { id: 'codex', label: 'Codex', models: { models: [] } }]),
  onNamesRuns: () => Promise.resolve(true),
}))
vi.mock('../rpc/reads.js', () => ({ onAgent, onBridgeQuestion, onBridgeEvents, onBridgeAnswer, onRunCheckout }))
const sendMessage = vi.fn(async () => ({ ok: true }) as unknown)
const withdrawMessage = vi.fn(async () => ({ ok: true }) as unknown)
const sendNow = vi.fn(async () => ({ ok: true }) as unknown)
vi.mock('../rpc/control.js', () => ({
  sendMessage,
  withdrawMessage,
  sendNow,
  sendStart: vi.fn(async () => null),
}))
// The page's parts read the preferences module, whose RPC reads must not fetch a daemon that is
// not there.
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => ({}),
  updatePreferences: vi.fn(),
}))
// The hosts beside this computer project p1's modules bring, as the daemon would answer them.
vi.mock('../lib/run-hosts.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/run-hosts.js')>()),
  useRunHosts: (projectId: string | null) =>
    projectId === 'p1'
      ? [
          { id: 'actions', label: 'GitHub Actions' },
          { id: 'web', label: 'Claude Code on the web' },
        ]
      : [],
}))

// The frame around the feed is not under test: the bar and composer reach for session state of
// their own, and the swap decision this file cares about is visible in the feed alone.
vi.mock('./AgentActionBar.js', () => ({
  AgentActionBar: ({ live, ready, retainedWorktree, status, onToggle }: { live?: boolean; ready?: boolean; retainedWorktree?: boolean; status?: string; onToggle?: () => void }) => (
    <>
      <span data-testid="bar-status">{String(status)}</span>
      <span data-testid="bar-frame" />
      <span data-testid="bar-live">{String(live)}</span>
      <button type="button" onClick={onToggle}>details</button>
      <span data-testid="bar-ready">{String(ready)}</span>
      <span data-testid="bar-kept-checkout">{String(retainedWorktree)}</span>
    </>
  ),
}))
// The row above the box has its own tests: here it says what the view told it.
vi.mock('./SessionRow.js', async () => {
  return {
  SessionRow: ({ runsOn, elsewhere, projectName }: { runsOn: string; elsewhere: boolean; projectName?: string | null }) => (
    <div data-testid="row">
      <span data-testid="row-runs-on">{runsOn}</span>
      <span data-testid="row-elsewhere">{String(elsewhere)}</span>
      <span data-testid="row-project">{projectName ?? ''}</span>
    </div>
  ),
  }
})
// The composer shows only what the view tells it about the run going: the one fact of it under test here.
let queuedIds = 0
const edited: string[] = []
const givenBack: string[] = []
vi.mock('./AgentComposer.js', () => ({
  AgentComposer: ({ live, asked, options, context, onSending, onQueued, editInBox, giveBack, row, publish }: { publish?: string; live: boolean; asked?: boolean; options?: { skills?: { project?: 'all' | 'none' | string[] } }; context?: ReactNode; onSending?: (text: string | null) => void; onQueued?: (message: { id: string; text: string; later: boolean }) => void; editInBox?: { current: ((text: string) => void) | null }; giveBack?: { current: ((text: string) => void) | null }; row?: ReactNode }) => {
    if (editInBox) editInBox.current = text => void edited.push(text)
    if (giveBack) giveBack.current = text => void givenBack.push(text)
    return (
      <>
        {row}
        <button type="button" onClick={() => onQueued?.({ id: `m${++queuedIds}`, text: 'and then this', later: false })}>queue-one</button>
        <button type="button" onClick={() => onSending?.('add a logout button')}>continue-it</button>
        <span data-testid="composer-options">{JSON.stringify(options ?? null)}</span>
        <span data-testid="composer-auto" data-publish={publish ?? ''} />
        <span data-testid="composer-project-skills" data-value={options?.skills?.project === undefined || options.skills.project === 'all' ? 'all' : options.skills.project === 'none' ? 'none' : options.skills.project.join('+')} />
        <span data-testid="composer-context">{context}</span>
        <span data-testid="composer-live">{String(live)}</span>
        <span data-testid="composer-asked">{String(asked)}</span>
      </>
    )
  },
}))

const { AgentView } = await import('./AgentView.js')

const LIVE_EVENTS = [{ kind: 'log', message: 'the channel delivered this line' }] as RunEvent[]
const ARCHIVED = [{ kind: 'log', message: 'the archive delivered this line' }] as RunEvent[]

const view = (over: Partial<Parameters<typeof AgentView>[0]> = {}) => (
  <AgentView projectId="p1" agentId="run-1" events={LIVE_EVENTS} live={false} files={[]} {...over} />
)

/** A module's row of the session's work (`chat.work`), saying what the view told it. */
const Work = ({ agentId, working, ended, saving, projectName, pr }: UiWorkProps) => (
  <div data-testid="work-row" data-agent={agentId} data-working={String(working)} data-ended={String(ended)} data-saving={String(saving)} data-project={projectName ?? ''} data-pr={pr ? `${pr.number} ${pr.state ?? ''} ${pr.title ?? ''}` : ''} />
)
const WORK: MountedView<'chat.work'> = { place: 'chat.work', id: 'project', View: Work, package: '@openagt/git-branches', projects: ['p1'] }
const withWork = (ui: ReactNode) => <ModulesContext.Provider value={mountedOf({ views: { 'chat.work': [WORK] } })}>{ui}</ModulesContext.Provider>
const row = () => screen.getByTestId('work-row').dataset

beforeEach(() => {
  vi.clearAllMocks()
  onRunCheckout.mockResolvedValue(null)
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
    ] as RunEvent[]
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
    ] as RunEvent[]
    render(view({ events: foreign }))
    await waitFor(() => expect(screen.getByText(/the archive delivered this line/)).toBeTruthy())
    expect(screen.queryByText(/a different run wrote this line/)).toBeNull()
  })

  test('an archive that catches up takes back over, bringing the epilogue events with it (#1460)', async () => {
    // A line written as the run is recorded only ever lands in the archive — the worktree journal
    // dies with the teardown — so once the feed outgrows the copy on screen the archive is re-read,
    // and the re-read is how the PR line reaches the screen without a manual refresh.
    const ahead = [...ARCHIVED, { kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'end', ok: true }] as RunEvent[]
    const full = [...ahead, { kind: 'pull-request', number: 7, url: 'https://x/pr/7' }] as RunEvent[]
    onAgent.mockResolvedValueOnce(ARCHIVED).mockResolvedValue(full)
    render(view({ events: ahead }))
    await waitFor(() => expect(onAgent.mock.calls.length).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(screen.getByText('#7')).toBeTruthy())
  })
})

describe('AgentView: a continued run reads as going', () => {
  test('once the feed showed the new turn, the run stays going while the archive catches up and the poll has not said so yet, and ends with the turn', async () => {
    const ended = [{ kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'log', message: 'first turn' }, { kind: 'end', ok: true }] as RunEvent[]
    const going = [...ended, { kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'log', message: 'second turn' }] as RunEvent[]
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
    const over = [...going, { kind: 'end', ok: true }] as RunEvent[]
    onAgent.mockResolvedValue(over)
    rerender(view({ events: over }))
    await waitFor(() => expect(screen.getByTestId('composer-live').textContent).toBe('false'))
  })

  test('an ended run whose archive holds an open turn the feed never showed starting is not read as going', async () => {
    const open = [{ kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'log', message: 'cut short' }] as RunEvent[]
    onAgent.mockResolvedValue(open)
    render(view({ events: open }))
    await waitFor(() => expect(screen.getByText(/cut short/)).toBeTruthy())
    expect(screen.getByTestId('composer-live').textContent).toBe('false')
  })
})

describe("AgentView: the rows of the session's work in its Activity panel", () => {
  test("the modules' rows sit in the Changes of the Activity panel, beside the chat", () => {
    render(withWork(view()))
    const panel = screen.getByRole('complementary', { name: 'Activity panel' })
    expect(within(within(panel).getByRole('region', { name: 'Changes' })).getByTestId('work-row')).toBeTruthy()
    expect(within(screen.getByTestId('chat-bottom')).queryByTestId('work-row')).toBeNull()
  })

  test('they are told whether the run works or has ended, whether its clean-up is going, the project and the request its record names', () => {
    render(withWork(view({ live: true, projectName: 'shop' })))
    expect([row().working, row().ended, row().project]).toEqual(['true', 'false', 'shop'])
    cleanup()
    render(withWork(view({ events: [...LIVE_EVENTS, { kind: 'end', ok: true }] as RunEvent[], card: { status: 'done', saving: true, pr: { number: 4, url: 'https://x/pull/4' }, prState: 'open', prTitle: 'Add a page' } })))
    expect([row().working, row().ended, row().saving, row().pr]).toEqual(['false', 'true', 'true', '4 open Add a page'])
    cleanup()
    // A run not known yet to be going or ended is neither.
    render(withWork(view({ live: null, events: [] })))
    expect([row().working, row().ended]).toEqual(['false', 'false'])
  })

  test("a message sent to an ended agent tells them it works at once, before the agents poll says so; its end tells them it ended", () => {
    const ended = [{ kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'driver', event: { type: 'start', prompt: 'Add a page' } }, { kind: 'end', ok: true }] as RunEvent[]
    const { rerender } = render(withWork(view({ events: ended })))
    expect(row().ended).toBe('true')
    // The feed shows the new turn; the poll still says ended.
    const again = [...ended, { kind: 'session', driver: 'claude-code', workspace: '/w' }, { kind: 'driver', event: { type: 'start', prompt: 'Add a footer' } }] as RunEvent[]
    rerender(withWork(view({ events: again, live: false })))
    expect([row().working, row().ended]).toEqual(['true', 'false'])
    rerender(withWork(view({ events: [...again, { kind: 'end', ok: true }] as RunEvent[], live: false })))
    expect([row().working, row().ended]).toEqual(['false', 'true'])
  })

  test("an ended run that kept its checkout, as its host finds it, has its menu open that folder", async () => {
    onRunCheckout.mockResolvedValue('/w')
    render(view())
    await waitFor(() => expect(screen.getByTestId('bar-kept-checkout').textContent).toBe('true'))
    expect(onRunCheckout).toHaveBeenCalledWith('p1', 'run-1')
    cleanup()
    onRunCheckout.mockResolvedValue(null)
    render(view({ agentId: 'run-2' }))
    await waitFor(() => expect(onRunCheckout).toHaveBeenCalledWith('p1', 'run-2'))
    expect(screen.getByTestId('bar-kept-checkout').textContent).toBe('false')
  })
})

// The Resume offer (#1391) moved into the composer's submit slot (#1455): its when-offered rules
// are AgentComposer's now, tested there — AgentView only hands `outcome` down.

describe('the bar shows its facts together (run switch)', () => {
  test("an ended run's bar is ready once its log is read, not before", async () => {
    let log: (v: unknown) => void = () => {}
    onAgent.mockReturnValue(new Promise(resolve => (log = resolve)))
    render(view())
    expect(screen.getByTestId('bar-ready').textContent).toBe('false')
    log(ARCHIVED)
    await waitFor(() => expect(screen.getByTestId('bar-ready').textContent).toBe('true'))
  })

  test('a read that never answers holds the bar back one second, no longer', async () => {
    onAgent.mockReturnValue(new Promise(() => {}))
    render(view())
    expect(screen.getByTestId('bar-ready').textContent).toBe('false')
    await waitFor(() => expect(screen.getByTestId('bar-ready').textContent).toBe('true'), { timeout: 3000 })
  })

  test("an ended run's state is said from the first frame, as its row says it, and stays while the page's reads are out", async () => {
    let log: (v: unknown) => void = () => {}
    onAgent.mockReturnValue(new Promise(resolve => (log = resolve)))
    render(view({ card: { status: 'done', prState: 'merged' } }))
    expect(screen.getByTestId('bar-ready').textContent).toBe('false')
    expect(screen.getByTestId('bar-status').textContent).toBe('merged')
    // The log answers: still merged, never "done" in between.
    log(ARCHIVED)
    await waitFor(() => expect(screen.getByTestId('bar-ready').textContent).toBe('true'))
    expect(screen.getByTestId('bar-status').textContent).toBe('merged')
  })

  test("an ended run with no merged request says how it ended from the first frame", () => {
    onAgent.mockReturnValue(new Promise(() => {}))
    render(view({ card: { status: 'stopped' } }))
    expect(screen.getByTestId('bar-status').textContent).toBe('stopped')
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
    render(view({ events: [{ kind: 'log', message: 'a different run wrote this line' }] as RunEvent[] }))
    expect(screen.queryByText(/a different run wrote this line/)).toBeNull()
    expect(screen.queryByText('Loading agent…')).toBeNull()
    log(ARCHIVED)
    await waitFor(() => expect(screen.getByText(/the archive delivered this line/)).toBeTruthy())
  })

  test('the feed waits for the plugins that draw its texts, then shows whole', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    const { rerender } = render(<ModulesContext.Provider value={mountedOf({ loaded: false })}>{view()}</ModulesContext.Provider>)
    await waitFor(() => expect(onAgent).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByText(/the archive delivered this line/)).toBeNull()
    rerender(<ModulesContext.Provider value={mountedOf({ loaded: true })}>{view()}</ModulesContext.Provider>)
    await waitFor(() => expect(screen.getByText(/the archive delivered this line/)).toBeTruthy())
  })

  test('an agent not known to run yet says nothing and reads nothing', () => {
    render(view({ live: null, events: [] }))
    expect(screen.queryByText('Waiting for the session to start…')).toBeNull()
    expect(screen.queryByText('Loading agent…')).toBeNull()
    expect(screen.getByTestId('bar-ready').textContent).toBe('false')
    expect(onAgent).not.toHaveBeenCalled()
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
  ] as RunEvent[]
  const withPanels = (ui: ReactNode, panes: MountedView<'chat.pane'>[]) => <ModulesContext.Provider value={mountedOf({ views: { 'chat.pane': panes } })}>{ui}</ModulesContext.Provider>
  const panel = (over: object) => ({ place: 'chat.pane' as const, id: 'changes', label: 'Changes', icon: () => null, View: () => null, package: '@openagt/ui-pane-changes', projects: ['p1'], ...over })

  test('with a pane that lists changes, a click asks this agent\'s page for the file by its path in the checkout', async () => {
    const { useRevealedChange, forgetRevealedChanges } = await import('../lib/reveal-change.js')
    forgetRevealedChanges()
    const Asked = () => <span data-testid="asked">{useRevealedChange('p1/run-1')?.path ?? ''}</span>
    onAgent.mockResolvedValue(events)
    render(withPanels(<>{view({ events, card: { status: 'done', workspace: WS } })}<Asked /></>, [panel({ changes: true as const })]))
    fireEvent.click(await screen.findByRole('button', { name: 'Show the change to A.md' }))
    expect(screen.getByTestId('asked').textContent).toBe('docs/A.md')
  })

  test('with no such pane, or one of another project, the row is there and is no button', async () => {
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

describe("a strip above the chat, a module's word on the run (#2394)", () => {
  const Notice = ({ agentId, working, host }: UiRunNoticeProps) => <span>notice {agentId} {String(working)} {host ?? 'here'}</span>
  const withNotice = (ui: ReactNode, projects = ['p1']) => {
    const modules = mountedOf({ views: { 'chat.notice': [{ place: 'chat.notice', id: 'actions-run', View: Notice, package: '@openagt/host-github-actions', projects }] } })
    return <ModulesContext.Provider value={modules}>{ui}</ModulesContext.Provider>
  }

  test('each strip of the modules on in the project is drawn, told the run, whether it works and the host it is on', () => {
    render(withNotice(view({ live: true, target: 'actions' })))
    expect(screen.getByText('notice run-1 true actions')).toBeTruthy()
    cleanup()
    render(withNotice(view({ live: false })))
    expect(screen.getByText('notice run-1 false here'), "a run on this computer is on no host").toBeTruthy()
  })

  test('a project without the module gets none of it', () => {
    render(withNotice(view({ live: true, target: 'actions' }), ['p2']))
    expect(screen.queryByText(/^notice/)).toBeNull()
  })
})

describe('AgentView: what the top bar opens to', () => {
  test('an ended agent: the agent, model and spend strip, and no list of commits or files', async () => {
    onAgent.mockResolvedValue(ARCHIVED)
    render(view())
    await screen.findByText(/the archive delivered this line/)
    expect(screen.queryByText('No spend reported yet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'details' }))
    expect(screen.getByText('No spend reported yet')).toBeTruthy()
    expect(screen.queryByText('Commits')).toBeNull()
    expect(screen.queryByText('Changed files')).toBeNull()
    expect(screen.queryByLabelText('Agent handoff')).toBeNull()
  })
})

// The question an agent stopped on is asked in the chat, by the card of the module that asks (ask's, a stand-in here).
describe('a question the agent stopped on', () => {
  const asked = [
    { kind: 'driver', event: { type: 'start', prompt: 'Pick a database' } },
    { kind: 'driver', event: { type: 'text', text: 'Two would do.' } },
    { kind: 'choice', id: 'question', title: 'Which database?', options: [{ id: 'pg', label: 'Postgres' }, { id: 'lite', label: 'SQLite' }], recommended: 'pg' },
    { kind: 'end', ok: false, waiting: true },
  ] as RunEvent[]
  const withAsk = (ui: ReactNode) => <ModulesContext.Provider value={questionCard().modules}>{ui}</ModulesContext.Provider>

  test('it is a card in the chat, the only place it is asked', async () => {
    onAgent.mockResolvedValue(asked)
    render(withAsk(view({ events: asked })))
    const card = await screen.findByRole('region', { name: 'Which database?' })
    expect(screen.getByLabelText('Agent output').contains(card)).toBe(true)
    expect(screen.getAllByRole('region', { name: 'Which database?' })).toHaveLength(1)
    expect(within(card).getByRole('button', { name: /Postgres/ })).toBeTruthy()
  })

  test('an answer the card took shows in the chat at once, as the question and the answer, before the agent is going again, and the card goes', async () => {
    onAgent.mockResolvedValue(asked)
    render(withAsk(view({ events: asked })))
    fireEvent.click(await screen.findByRole('button', { name: /SQLite/ }))
    await waitFor(() => expect(screen.getByRole('group', { name: 'Your answer' }).textContent).toBe('Which database?SQLite'))
    expect(screen.queryByRole('region', { name: 'Which database?' })).toBeNull()
    // The card's module said it to the run: the page sends no message of its own.
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test('once the agent has gone on, the card is gone', async () => {
    const on = [...asked, { kind: 'driver', event: { type: 'start', prompt: 'MySQL' } }] as RunEvent[]
    onAgent.mockResolvedValue(on)
    render(withAsk(view({ events: on, live: true })))
    await waitFor(() => expect(screen.getAllByLabelText('Your message')).toHaveLength(2))
    expect(screen.queryByRole('region', { name: 'Which database?' })).toBeNull()
  })
})

// What was a line above the message box is said by the chat.
describe('a message sent while the agent works', () => {
  const start = (prompt: string) => ({ kind: 'driver', event: { type: 'start', prompt } }) as RunEvent
  const text = { kind: 'driver', event: { type: 'text', text: 'Hi.' } } as RunEvent
  const queuedBoxes = () => screen.queryAllByLabelText('Your message, waiting')

  test('it shows in the chat as waiting, each one sent, until the agent\'s next prompt arrives: then it is a read message', () => {
    const { rerender } = render(view({ live: true, events: [start('go'), text] }))
    expect(queuedBoxes()).toHaveLength(0)
    fireEvent.click(screen.getByText('queue-one'))
    fireEvent.click(screen.getByText('queue-one'))
    expect(queuedBoxes().map(n => n.textContent)).toEqual(['and then this', 'and then this'])
    rerender(view({ live: true, events: [start('go'), text, start('and then this')] }))
    expect(queuedBoxes()).toHaveLength(0)
    expect(screen.getAllByLabelText('Your message')).toHaveLength(2)
  })

  test('read at the agent\'s next step, it is no longer waiting: its own line shows it where it landed', () => {
    const { rerender } = render(view({ live: true, events: [start('go'), text] }))
    fireEvent.click(screen.getByText('queue-one'))
    const id = `m${queuedIds}`
    expect(queuedBoxes()).toHaveLength(1)
    rerender(view({ live: true, events: [start('go'), text, { kind: 'driver', event: { type: 'steered', text: 'and then this', id } } as RunEvent] }))
    expect(queuedBoxes()).toHaveLength(0)
    expect(screen.getAllByLabelText('Your message').map(n => n.textContent)).toEqual(['go', 'and then this'])
  })

  test('Cancel and edit takes it back from the run and puts it in the box; Send now asks the run to read it now', () => {
    render(view({ live: true, events: [start('go'), text] }))
    fireEvent.click(screen.getByText('queue-one'))
    const id = `m${queuedIds}`
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    expect(sendNow).toHaveBeenCalledWith('p1', 'run-1')
    edited.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and edit message' }))
    expect(withdrawMessage).toHaveBeenCalledWith('p1', 'run-1', id)
    expect(edited).toEqual(['and then this'])
    expect(queuedBoxes()).toHaveLength(0)
  })

  test('Send now, which sends every waiting message, is under the last of them, says it is on its way and says why the run refused it', async () => {
    let answer: (outcome: unknown) => void = () => {}
    sendNow.mockReturnValueOnce(new Promise(resolve => (answer = resolve)))
    render(view({ live: true, events: [start('go'), text] }))
    fireEvent.click(screen.getByText('queue-one'))
    fireEvent.click(screen.getByText('queue-one'))
    // Each box with what is said under it: the whole message.
    const [first, last] = queuedBoxes().map(box => box.closest<HTMLElement>('.group\\/prompt')!)
    expect(within(first!).queryByRole('button', { name: 'Send now' })).toBeNull()
    expect(within(first!).getByText("Read at the agent's next step")).toBeTruthy()
    fireEvent.click(within(last!).getByRole('button', { name: 'Send now' }))
    expect((await within(last!).findByRole('button', { name: 'Sending…' })) as HTMLButtonElement).toHaveProperty('disabled', true)
    act(() => answer({ ok: false, error: 'could not reach the run' }))
    expect((await screen.findByRole('alert')).textContent).toBe('could not reach the run')
  })

  test('what Send now said is the session’s it was pressed in: another session picked shows its own, and an answer that comes back later shows in its session alone', async () => {
    sendNow.mockResolvedValueOnce({ ok: false, error: 'session A could not be reached' })
    const page = render(view({ live: true, events: [start('go'), text] }))
    fireEvent.click(screen.getByText('queue-one'))
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    expect((await screen.findByRole('alert')).textContent).toBe('session A could not be reached')
    page.rerender(view({ agentId: 'run-2', live: true, events: [start('go'), text] }))
    fireEvent.click(screen.getByText('queue-one'))
    expect(screen.queryByRole('alert')).toBeNull()
    let answer: (outcome: unknown) => void = () => {}
    sendNow.mockReturnValueOnce(new Promise(resolve => (answer = resolve)))
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    page.rerender(view({ live: true, events: [start('go'), text] }))
    expect(screen.getByRole('button', { name: 'Send now' })).toBeTruthy()
    await act(async () => answer({ ok: false, error: 'session B refused it late' }))
    expect(screen.getByRole('alert').textContent).toBe('session A could not be reached')
    page.rerender(view({ agentId: 'run-2', live: true, events: [start('go'), text] }))
    expect(screen.getByRole('alert').textContent).toBe('session B refused it late')
  })

  test('it is still waiting after the page is left or reloaded, with Send now and Cancel and edit, until the agent reads it', () => {
    const before = [start('go'), text]
    render(view({ live: true, events: before }))
    fireEvent.click(screen.getByText('queue-one'))
    const first = `m${queuedIds}`
    fireEvent.click(screen.getByText('queue-one'))
    const second = `m${queuedIds}`
    cleanup()
    const { rerender } = render(view({ live: true, events: before }))
    expect(queuedBoxes().map(n => n.textContent)).toEqual(['and then this', 'and then this'])
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    expect(sendNow).toHaveBeenCalledWith('p1', 'run-1')
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel and edit message' })[0]!)
    expect(withdrawMessage).toHaveBeenCalledWith('p1', 'run-1', first)
    const read = [...before, { kind: 'driver', event: { type: 'steered', text: 'and then this', id: second } } as RunEvent]
    rerender(view({ live: true, events: read }))
    expect(queuedBoxes()).toHaveLength(0)
    cleanup()
    render(view({ live: true, events: before }))
    expect(queuedBoxes()).toHaveLength(0)
  })

  test('two tabs open on the run each keep the message the other sent: both show both, and both are still waiting after a reload', () => {
    const before = [start('go'), text]
    const one = render(view({ live: true, events: before }))
    const two = render(view({ live: true, events: before }))
    // The browser tells every other tab of a write, never the one that wrote.
    const sendIn = (tab: typeof one) => {
      fireEvent.click(within(tab.container).getByText('queue-one'))
      act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'oa.waiting:run-1' })))
    }
    sendIn(one)
    sendIn(two)
    for (const tab of [one, two]) expect(within(tab.container).queryAllByLabelText('Your message, waiting')).toHaveLength(2)
    cleanup()
    render(view({ live: true, events: before }))
    expect(queuedBoxes()).toHaveLength(2)
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

  test('a run whose record says it was stopped gives its words back to the box at once', async () => {
    vi.useFakeTimers()
    try {
      givenBack.length = 0
      const { rerender } = render(view({ live: true, events: [start('go'), text] }))
      fireEvent.click(screen.getByText('queue-one'))
      rerender(view({ live: false, card: { status: 'stopped' }, events: [start('go'), text, { kind: 'end', ok: false, stopped: true }] as RunEvent[] }))
      await act(async () => {})
      act(() => void vi.advanceTimersByTime(0))
      expect(queuedBoxes()).toHaveLength(0)
      expect(givenBack).toEqual(['and then this'])
    } finally {
      vi.useRealTimers()
    }
  })

  test('a tab in the background leaves the words for the tab that is shown, and takes them once it is shown and they still wait', async () => {
    vi.useFakeTimers()
    const setShown = (shown: boolean) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (shown ? 'visible' : 'hidden') })
      act(() => void document.dispatchEvent(new Event('visibilitychange')))
    }
    try {
      givenBack.length = 0
      const { rerender } = render(view({ live: true, events: [start('go'), text] }))
      fireEvent.click(screen.getByText('queue-one'))
      setShown(false)
      rerender(view({ live: false, card: { status: 'stopped' }, events: [start('go'), text, { kind: 'end', ok: false, stopped: true }] as RunEvent[] }))
      await act(async () => {})
      act(() => void vi.advanceTimersByTime(10_000))
      expect(queuedBoxes()).toHaveLength(1)
      expect(givenBack).toEqual([])
      setShown(true)
      act(() => void vi.advanceTimersByTime(0))
      expect(queuedBoxes()).toHaveLength(0)
      expect(givenBack).toEqual(['and then this'])
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState
      vi.useRealTimers()
    }
  })

  test('a run whose feed shows its end is ended at once, its Stop gone with the end line, before the list of runs says so', () => {
    const { rerender } = render(view({ live: true, events: [start('go'), text] }))
    expect(screen.getByTestId('composer-live').textContent).toBe('true')
    rerender(view({ live: true, events: [start('go'), text, { kind: 'end', ok: false, stopped: true, at: new Date().toISOString() }] as RunEvent[] }))
    expect(screen.getByTestId('composer-live').textContent).toBe('false')
    expect(screen.getByTestId('bar-live').textContent).toBe('false')
  })

  test('a run continued by a message is live from the list of runs on, its Stop in the box and the menu, before its new leg writes a line', () => {
    const before = [start('go'), text, { kind: 'end', ok: true, at: '2026-01-01T10:00:00.000Z' }] as RunEvent[]
    const { rerender } = render(view({ live: false, events: before }))
    expect(screen.getByTestId('composer-live').textContent).toBe('false')
    rerender(view({ live: true, events: before }))
    expect(screen.getByTestId('composer-live').textContent).toBe('true')
    expect(screen.getByTestId('bar-live').textContent).toBe('true')
  })

  test('a run that ended on a question tells the box so: a message is the answer', async () => {
    const asking = [start('go'), { kind: 'end', ok: true, waiting: true }] as RunEvent[]
    onAgent.mockResolvedValue(asking)
    render(view({ live: false, events: asking }))
    await waitFor(() => expect(screen.getByTestId('composer-asked').textContent).toBe('true'))
  })

  test('a continued run opened afresh is live while its feed replays the leg before, and ends with its own end', () => {
    const before = [start('go'), text, { kind: 'end', ok: true, at: '2026-01-01T10:00:00.000Z' }] as RunEvent[]
    const { rerender } = render(view({ live: true, events: [], replayed: false }))
    rerender(view({ live: true, events: before.slice(0, 2), replayed: false }))
    rerender(view({ live: true, events: before, replayed: false }))
    expect(screen.getByTestId('composer-live').textContent).toBe('true')
    rerender(view({ live: true, events: before }))
    expect(screen.getByTestId('composer-live').textContent).toBe('true')
    rerender(view({ live: true, events: [...before, { kind: 'end', ok: false, stopped: true, at: '2026-01-01T10:00:00.000Z' }] as RunEvent[] }))
    expect(screen.getByTestId('composer-live').textContent).toBe('false')
  })

  // The browser may be another device, its clock its own: the daemon's times say nothing of this page's.
  describe.each([
    ['five minutes ahead of', 300_000],
    ['five minutes behind', -300_000],
    ['the same as', 0],
  ])('with this browser\'s clock %s the daemon\'s', (_, skew) => {
    const daemonNow = () => new Date(Date.now() - skew).toISOString()
    afterEach(() => vi.restoreAllMocks())

    test('a continued run is live from the list of runs on, before its new leg writes a line', () => {
      const before = [start('go'), text, { kind: 'end', ok: true, at: new Date(Date.now() - 1000).toISOString() }] as RunEvent[]
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now + skew)
      const { rerender } = render(view({ live: false, events: before }))
      rerender(view({ live: true, events: before }))
      expect(screen.getByTestId('composer-live').textContent).toBe('true')
    })

    test('a continued run\'s own end ends it at once, its Stop gone with the end line', () => {
      const before = [start('go'), text, { kind: 'end', ok: true, at: new Date(Date.now() - 1000).toISOString() }] as RunEvent[]
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now + skew)
      const { rerender } = render(view({ live: false, events: before }))
      rerender(view({ live: true, events: before }))
      rerender(view({ live: true, events: [...before, start('more'), { kind: 'end', ok: false, stopped: true, at: daemonNow() }] as RunEvent[] }))
      expect(screen.getByTestId('composer-live').textContent).toBe('false')
      expect(screen.getByTestId('bar-live').textContent).toBe('false')
    })
  })

  test('a session whose run is not known yet has no message box, which would say an ended run\'s words; it comes once the record or the feed says', () => {
    const { rerender } = render(view({ live: null, events: [] }))
    expect(screen.queryByTestId('composer-live')).toBeNull()
    // The feed says it works before any list has the run.
    rerender(view({ live: null, events: [start('go'), text] }))
    expect(screen.getByTestId('composer-live').textContent).toBe('true')
    cleanup()
    render(view({ live: false, events: [] }))
    expect(screen.getByTestId('composer-live').textContent).toBe('false')
  })

  test('a page slow to learn that the run still works keeps showing it waiting', () => {
    vi.useFakeTimers()
    try {
      render(view({ live: true, events: [start('go'), text] }))
      fireEvent.click(screen.getByText('queue-one'))
      cleanup()
      // Reloaded: the list of runs is not read yet, and the run's feed has not come.
      const { rerender } = render(view({ live: null, events: [] }))
      act(() => void vi.advanceTimersByTime(10_000))
      rerender(view({ live: true, events: [start('go'), text] }))
      expect(queuedBoxes().map(n => n.textContent)).toEqual(['and then this'])
    } finally {
      vi.useRealTimers()
    }
  })

  test('an agent that stopped working without reading it shows it for five seconds more, then its words go back to the box', async () => {
    vi.useFakeTimers()
    try {
      givenBack.length = 0
      const { rerender } = render(view({ live: true, events: [start('go'), text] }))
      fireEvent.click(screen.getByText('queue-one'))
      fireEvent.click(screen.getByText('queue-one'))
      const ended = [start('go'), text, { kind: 'end', ok: false, stopped: true }] as RunEvent[]
      rerender(view({ live: false, events: ended }))
      // The ended run's feed is read.
      await act(async () => {})
      act(() => void vi.advanceTimersByTime(4_000))
      expect(queuedBoxes()).toHaveLength(2)
      expect(givenBack).toEqual([])
      act(() => void vi.advanceTimersByTime(1_500))
      expect(queuedBoxes()).toHaveLength(0)
      expect(givenBack).toEqual(['and then this\n\nand then this'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('where the agent runs, for the row above the message box', () => {
  test("this machine by itself; a host by the name the project's module gives it", () => {
    const runsOn = () => screen.getByTestId('row-runs-on').textContent
    const { rerender } = render(view({ live: true }))
    expect(runsOn()).toBe('This machine')
    rerender(view({ live: true, target: 'local' }))
    expect(runsOn()).toBe('This machine')
    rerender(view({ live: true, target: 'web' }))
    expect(runsOn()).toBe('Claude Code on the web')
    rerender(view({ live: true, target: 'actions' }))
    expect(runsOn()).toBe('GitHub Actions')
    // A host whose module is no longer on in the project.
    rerender(view({ live: true, target: 'elsewhere' }))
    expect(runsOn()).toBe('Another host')
  })

  test('a run of another computer is named by that computer: it did not run on this one', () => {
    const card = { status: 'done' as const, host: 'rom-thinkpad-x280', otherHost: true }
    render(view({ card }))
    expect(screen.getByTestId('row-runs-on').textContent).toBe('rom-thinkpad-x280')
  })

  test('a run of another computer is only read: in place of the message box, a line says where to continue it', () => {
    const { rerender } = render(view({ card: { status: 'done' as const, host: 'rom-thinkpad-x280', otherHost: true } }))
    expect(screen.getByRole('note').textContent).toBe('This run is on rom-thinkpad-x280. Continue it there.')
    expect(screen.queryByTestId('composer-live')).toBeNull()
    // Its row stays, above that line: with no box to sit on, the page still says where it started.
    expect(within(screen.getByTestId('chat-bottom')).getByTestId('row-runs-on').textContent).toBe('rom-thinkpad-x280')
    expect(screen.getByTestId('row').compareDocumentPosition(screen.getByRole('note')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('row-elsewhere').textContent).toBe('true')
    // This computer's own run keeps its box.
    rerender(view({ card: { status: 'done' as const, host: 'this-mac' } }))
    expect(screen.getByTestId('composer-live')).toBeTruthy()
    expect(screen.queryByRole('note')).toBeNull()
  })

})

describe('the page\'s two bars', () => {
  test('the top bar and its notices are the page\'s first row; the message box and what sits on it lie over the chat\'s end', () => {
    render(view({ live: true }))
    expect(within(screen.getByTestId('chat-top')).getByTestId('bar-frame')).toBeTruthy()
    for (const part of ['row', 'composer-live']) expect(within(screen.getByTestId('chat-bottom')).getByTestId(part)).toBeTruthy()
    expect(screen.getByTestId('chat-top').contains(screen.getByText(/the channel delivered this line/))).toBe(false)
  })

  test('a lost live stream is said under the top bar, whatever the chat shows', () => {
    const { rerender } = render(view({ live: true }))
    expect(screen.queryByText(/Live stream lost/)).toBeNull()
    rerender(view({ live: true, lost: true }))
    expect(within(screen.getByTestId('chat-top')).getByRole('status').textContent).toMatch(/^Live stream lost/)
    rerender(view({ live: true, lost: true, events: [] }))
    expect(within(screen.getByTestId('chat-top')).getByRole('status')).toBeTruthy()
  })

  test('an agent on a host has no notice of it: the row above the box says where it runs', () => {
    render(view({ live: true, target: 'web' }))
    expect(screen.getByTestId('row-runs-on').textContent).toBe('Claude Code on the web')
    expect(screen.queryByText(/Running on/)).toBeNull()
    expect(within(screen.getByTestId('chat-top')).queryByRole('status')).toBeNull()
  })
})

describe('a run the launcher just started, before its record is there', () => {
  const picks = { publish: 'pr', effort: 'high', options: { skills: { project: 'none' as const } } }
  const row = (id: string, name: string) => screen.getByTestId(id).dataset[name]

  test('its page says what the launcher said at once; the record says it from then on', () => {
    const { rerender } = render(view({ live: true, events: [], picks }))
    expect(row('composer-project-skills', 'value')).toBe('none')
    expect(row('composer-auto', 'publish')).toBe('pr')
    rerender(view({ live: true, events: [], picks, card: { status: 'running' as const, base: 'other', publish: 'commit' } }))
    expect(row('composer-auto', 'publish')).toBe('commit')
    // The record says no pick: the launcher's does not come back.
    expect(row('composer-project-skills', 'value')).toBe('all')
  })

  test('a record with no level has none: a message took it away, and the launcher\'s does not come back', () => {
    render(view({ live: true, events: [], picks, card: { status: 'running' as const } }))
    expect(row('composer-auto', 'publish')).toBe('')
  })
})

describe('the row under the message box', () => {
  test("the box is handed the run's options as its card keeps them, the coding agent's with them, for its controls to say", () => {
    const { rerender } = render(view({ live: true, events: [] }))
    expect(screen.getByTestId('composer-options').textContent).toBe('null')
    const options = { 'agent-driver': { driver: 'claude-code', model: 'opus', effort: 'medium' } }
    rerender(view({ live: true, events: [], card: { status: 'running', driver: 'claude-code', model: 'opus', options } }))
    expect(JSON.parse(screen.getByTestId('composer-options').textContent!)).toEqual(options)
  })

  test('how full the context is shows beside the model, empty until there is a reading, and only when the window is known', async () => {
    const { rerender } = render(view({ live: true, events: [], card: { status: 'running', driver: 'claude-code', model: 'opus', contextTokens: 50_000 } }))
    // Opus holds 200k, says the stubbed model list: a quarter of it is used.
    await waitFor(() => expect(screen.getByRole('img', { name: '50.0k of 200k used · 75% of the context left' })).toBeTruthy())
    // No reading yet: the ring is there and empty, as Claude Code's is from the first frame.
    rerender(view({ live: true, events: [], card: { status: 'running', driver: 'claude-code', model: 'opus' } }))
    expect(screen.getByRole('img', { name: '0 of 200k used · 100% of the context left' })).toBeTruthy()
    // A model nobody said a window of draws nothing: a fullness no one can measure is worse than none.
    rerender(view({ live: true, events: [], card: { status: 'running', driver: 'codex', model: 'gpt-5.6-luna', contextTokens: 50_000 } }))
    expect(screen.queryByRole('img', { name: /of the context left/ })).toBeNull()
  })
})

// A run just started writes its prompt line seconds later: the page shows it at once, and says it is starting.
describe('a run just started', () => {
  test('its prompt shows before any event, with "Starting session" under it, until its own prompt line arrives', () => {
    const { rerender } = render(view({ live: true, events: [], startedWith: 'Say hi' }))
    expect(screen.getByText('Say hi')).toBeTruthy()
    expect(screen.getByText('Starting session')).toBeTruthy()
    const started = [{ kind: 'driver', event: { type: 'start', prompt: 'Say hi' } }, { kind: 'driver', event: { type: 'thought', text: 'hm' } }] as RunEvent[]
    rerender(view({ live: true, events: started, startedWith: 'Say hi' }))
    expect(screen.getAllByText('Say hi')).toHaveLength(1)
    // The set-up line has given way to the moving line, which names no step while the agent thinks;
    // its words are only the ones fading out.
    expect(screen.queryByText('Starting session')?.closest('.cross-fade-out') ?? null).not.toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  test('its prompt is the chat\'s first row from the first frame, and stays the same row as the run\'s lines land before and after its own line', () => {
    const rows = () => [...document.querySelectorAll('[data-message-id]')]
    const { rerender } = render(view({ live: true, events: [], startedWith: 'Say hi' }))
    const prompt = rows()[0]!
    expect(prompt.textContent).toContain('Say hi')
    const session = { kind: 'session', driver: 'claude-code', workspace: '/repo', fake: false } as RunEvent
    rerender(view({ live: true, events: [session], startedWith: 'Say hi' }))
    expect(rows()[0]).toBe(prompt)
    rerender(view({ live: true, events: [session, { kind: 'driver', event: { type: 'start', prompt: 'Say hi' } }], startedWith: 'Say hi' }))
    expect(rows()[0]).toBe(prompt)
    expect(screen.getAllByText('Say hi')).toHaveLength(1)
  })

  test('a run stopped before its first turn keeps its prompt, stops counting, and says it stopped', async () => {
    const stopped = [{ kind: 'end', ok: false, stopped: true }] as RunEvent[]
    // Its archive is its one line: the stop.
    onAgent.mockResolvedValue(stopped)
    const { rerender } = render(view({ live: true, events: [], startedWith: 'Say hi' }))
    expect(screen.getByText('Starting session')).toBeTruthy()
    rerender(view({ live: false, events: stopped, startedWith: 'Say hi', card: { status: 'stopped', intent: 'Say hi', branch: 'agent-x' } }))
    await waitFor(() => expect(screen.getByText('Stopped')).toBeTruthy())
    expect(screen.getAllByText('Say hi')).toHaveLength(1)
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('a run with no prompt line yet shows the prompt its card says, on a page that did not start it', () => {
    render(view({ live: true, events: [], card: { status: 'running', intent: 'Move the cart', branch: 'agent-x', startedAt: new Date().toISOString() } }))
    expect(screen.getByText('Move the cart')).toBeTruthy()
    expect(screen.getByText('Starting the coding agent')).toBeTruthy()
  })

  test('a run long at work, switched to while its replay is out, never shows its prompt alone with the start line: its chat comes when its log does', () => {
    const card = { status: 'running' as const, intent: 'Move the cart', workspace: '/repo/.branches/agent-1', branch: 'agent-1', driver: 'claude-code', startedAt: new Date(Date.now() - 756_000).toISOString() }
    const { rerender } = render(view({ agentId: 'run-2', live: true, events: [], replayed: false, card }))
    expect(screen.queryByText(/^Starting/)).toBeNull()
    expect(screen.queryByText('Move the cart')).toBeNull()
    expect(screen.queryByText('Waiting for the session to start…')).toBeNull()
    const log = [
      { kind: 'driver', event: { type: 'start', prompt: 'Move the cart' } },
      { kind: 'session-update' },
      { kind: 'driver', event: { type: 'text', text: 'The cart is moved.' } },
    ] as RunEvent[]
    rerender(view({ agentId: 'run-2', live: true, events: log, card }))
    expect(screen.getByText('Move the cart')).toBeTruthy()
    expect(screen.getByText('The cart is moved.')).toBeTruthy()
    expect(screen.queryByText(/^Starting/)).toBeNull()
  })

  test('an agent just started on a host says nothing of a set-up before its card is listed: no checkout is made for it here', () => {
    const events = [{ kind: 'driver', event: { type: 'start', prompt: 'Say hi' } }, { kind: 'driver', event: { type: 'text', text: 'Hi.' } }] as RunEvent[]
    render(view({ live: true, events, startedOn: 'GitHub Actions' }))
    expect(screen.queryByText('Initialized session')).toBeNull()
  })

  test('the chat says what was set up for the agent, off its card; before the card is listed the line of an agent at work has nothing to open', () => {
    const events = [{ kind: 'driver', event: { type: 'start', prompt: 'Say hi' } }, { kind: 'driver', event: { type: 'text', text: 'Hi.' } }] as RunEvent[]
    const { rerender } = render(view({ live: true, events }))
    expect(screen.getByText('Initialized session')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Initialized session' })).toBeNull()
    rerender(view({ live: true, events, card: { status: 'done', workspace: '/repo/.branches/agent-1', branch: 'agent-1', driver: 'codex' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Initialized session' }))
    expect(screen.getByText('/repo/.branches/agent-1')).toBeTruthy()
    // The branch is in the chat's line, and in the Activity panel's Environment beside it.
    expect(screen.getAllByText('agent-1')).toHaveLength(2)
    expect(within(screen.getByRole('region', { name: 'Environment' })).getByText('agent-1')).toBeTruthy()
    expect(screen.queryByText(/Started from the branch/)).toBeNull()
    rerender(view({ live: true, events, card: { status: 'done', workspace: '/repo/.branches/agent-1', branch: 'agent-1', base: 'my/work', driver: 'codex' } }))
    expect(screen.getByText(/Started from the branch/).textContent).toBe('Started from the branch my/work, not from the main branch.')
  })

  test('what was opened in one agent\'s chat is not open in the next agent\'s: each chat is its own', () => {
    const events = [{ kind: 'driver', event: { type: 'start', prompt: 'Say hi' } }, { kind: 'driver', event: { type: 'text', text: 'Hi.' } }] as RunEvent[]
    const card = { status: 'running' as const, workspace: '/repo/.branches/agent-1', branch: 'agent-1', driver: 'codex' }
    const { rerender } = render(view({ live: true, events, card }))
    const scroller = document.querySelector('[data-slot="message-scroller"]')
    fireEvent.click(screen.getByRole('button', { name: 'Initialized session' }))
    expect(screen.getByRole('button', { name: 'Initialized session' }).getAttribute('aria-expanded')).toBe('true')
    // The same agent, with more to show: its line stays open, in the same scroller.
    rerender(view({ live: true, events: [...events, { kind: 'driver', event: { type: 'text', text: 'More.' } }] as RunEvent[], card }))
    expect(screen.getByRole('button', { name: 'Initialized session' }).getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[data-slot="message-scroller"]')).toBe(scroller)
    // Another agent: its line is folded, and its chat is a scroller of its own, at its own place.
    rerender(view({ agentId: 'run-2', live: true, events, card: { ...card, workspace: '/repo/.branches/agent-2', branch: 'agent-2' } }))
    expect(screen.getByRole('button', { name: 'Initialized session' }).getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-slot="message-scroller"]')).not.toBe(scroller)
  })

  test('the dots stay under the answer being written, and go once the run has ended', () => {
    const events = [{ kind: 'driver', event: { type: 'start', prompt: 'Say hi' } }] as RunEvent[]
    const { rerender } = render(view({ live: true, events, writing: 'Hi th' }))
    // Still at it, naming no step: Claude Code on the web keeps its dots under the streaming reply.
    expect(screen.getByRole('status').textContent).toBe('')
    rerender(view({ live: false, events: [...events, { kind: 'end', ok: true }] as RunEvent[] }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('AgentView: a message sent to continue an ended run', () => {
  const start = (prompt: string) => ({ kind: 'driver', event: { type: 'start', prompt } }) as RunEvent
  const ended = [start('Add a page'), { kind: 'end', ok: true, at: '2026-01-01T10:00:00.000Z' }] as RunEvent[]

  test('is still shown after a reload, until the run writes it as its prompt', async () => {
    onAgent.mockResolvedValue(ended)
    const first = render(view({ events: ended }))
    fireEvent.click(screen.getByRole('button', { name: 'continue-it' }))
    expect(await screen.findByText('add a logout button')).toBeTruthy()
    first.unmount()
    // Reloaded before the list of runs has seen the run continued: its record still says the leg before ended.
    const { rerender } = render(view({ events: ended, card: { status: 'done', endedAt: '2026-01-01T10:00:00.000Z' } as never }))
    expect(await screen.findByText('add a logout button')).toBeTruthy()
    rerender(view({ live: true, events: ended }))
    expect(screen.getByText('add a logout button')).toBeTruthy()
    rerender(view({ live: true, events: [...ended, start('add a logout button')] }))
    await waitFor(() => expect(screen.getAllByText('add a logout button')).toHaveLength(1))
    cleanup()
    render(view({ live: true, events: [...ended, start('add a logout button')] }))
    expect(screen.getAllByText('add a logout button')).toHaveLength(1)
  })

  test('stays out of the box when the run began on it, its record ending before its feed shows the prompt line', async () => {
    onAgent.mockResolvedValue(ended)
    givenBack.length = 0
    const { rerender } = render(view({ events: ended }))
    fireEvent.click(screen.getByRole('button', { name: 'continue-it' }))
    // The list of runs says the new leg ended before this page read its lines.
    const over = { status: 'done', endedAt: new Date(Date.now() + 1000).toISOString() } as never
    rerender(view({ events: ended, card: over }))
    await new Promise(resolve => setTimeout(resolve, 50))
    rerender(view({ events: [...ended, start('add a logout button'), { kind: 'end', ok: true }] as RunEvent[], card: over }))
    await waitFor(() => expect(screen.getAllByText('add a logout button')).toHaveLength(1))
    expect(givenBack).toEqual([])
  })

  test('goes back to the box when the run ends after it without beginning on it, five seconds on', async () => {
    onAgent.mockResolvedValue(ended)
    givenBack.length = 0
    const first = render(view({ events: ended }))
    fireEvent.click(screen.getByRole('button', { name: 'continue-it' }))
    first.unmount()
    vi.useFakeTimers()
    try {
      render(view({ live: false, events: ended, card: { status: 'failed', endedAt: new Date(Date.now() + 1000).toISOString() } as never }))
      // The ended run's feed is read.
      await act(async () => {})
      act(() => void vi.advanceTimersByTime(4_000))
      expect(givenBack).toEqual([])
      act(() => void vi.advanceTimersByTime(1_500))
      expect(givenBack).toEqual(['add a logout button'])
      expect(screen.queryByText('add a logout button')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // The browser may be another device, its clock its own: the daemon's times say nothing of this page's.
  describe.each([
    ['five minutes ahead of', 300_000],
    ['five minutes behind', -300_000],
  ])('with this browser\'s clock %s the daemon\'s', (_, skew) => {
    const daemonAt = (ms: number) => new Date(Date.now() - skew + ms).toISOString()

    test('goes back to the box when the run ends again without beginning on it, five seconds on', async () => {
      const legBefore = { status: 'done', endedAt: daemonAt(-60_000) } as never
      const endedThen = [start('Add a page'), { kind: 'end', ok: true, at: daemonAt(-60_000) }] as RunEvent[]
      onAgent.mockResolvedValue(endedThen)
      givenBack.length = 0
      const first = render(view({ events: endedThen, card: legBefore }))
      fireEvent.click(screen.getByRole('button', { name: 'continue-it' }))
      first.unmount()
      vi.useFakeTimers()
      try {
        render(view({ live: false, events: endedThen, card: { status: 'failed', endedAt: daemonAt(1000) } as never }))
        await act(async () => {})
        act(() => void vi.advanceTimersByTime(5_500))
        expect(givenBack).toEqual(['add a logout button'])
      } finally {
        vi.useRealTimers()
      }
    })

    test('stays on screen while the record still says the leg before ended, the run not yet continued', async () => {
      const legBefore = { status: 'done', endedAt: daemonAt(-60_000) } as never
      const endedThen = [start('Add a page'), { kind: 'end', ok: true, at: daemonAt(-60_000) }] as RunEvent[]
      onAgent.mockResolvedValue(endedThen)
      givenBack.length = 0
      vi.useFakeTimers()
      try {
        render(view({ events: endedThen, card: legBefore }))
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', { name: 'continue-it' }))
        // Its checkout is being made again: the record is written running only once it is there.
        act(() => void vi.advanceTimersByTime(10_000))
        expect(givenBack).toEqual([])
        expect(screen.getByText('add a logout button')).toBeTruthy()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
