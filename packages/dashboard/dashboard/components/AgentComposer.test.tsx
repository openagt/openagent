import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// The two writes this component makes: what the person says to the run, and the slot's Stop (#1455).
const sendMessage = vi.hoisted(() => vi.fn())
const sendStop = vi.hoisted(() => vi.fn())
vi.mock('../rpc/control.js', () => ({ sendMessage, sendStop }))
// The "Auto" menu is tested on its own; here a stand-in says the pick it shows and offers a pick.
vi.mock('./AutoMenu.js', () => ({
  AutoMenu: ({ publish, onPublish }: { publish: string; onPublish: (pick: string) => void }) => (
    <span>
      Auto: {publish}
      <button type="button" onClick={() => onPublish('pr')}>pick Open PR</button>
      <button type="button" onClick={() => onPublish('commit')}>pick Commit</button>
    </span>
  ),
}))
vi.mock('../lib/use-project-launcher.js', () => ({ useProjectLauncher: () => ({ gitHost: true, remote: true }) }))
// The Context picker reads the projects; here it is a stand-in that says what it was given.
vi.mock('./ContextMenu.js', () => ({ ProjectContextMenu: ({ context }: { context: Set<string> }) => <span>Context · {[...context].join(', ')}</span> }))
// The launcher's other items, each tested on its own: stand-ins that say what they were given.
vi.mock('./AgentMenu.js', () => ({ AgentOff: ({ agent }: { agent?: string }) => <span>Agent · {agent ?? 'default'}</span> }))
vi.mock('./SkillsMenu.js', () => ({ SkillsOff: ({ skillsOff, projectSkills, noProject }: { skillsOff?: string[]; projectSkills?: 'none' | string[]; noProject?: boolean }) => <span>Skills · {noProject ? 'no project' : `${(skillsOff ?? []).join('+') || 'all'}/${projectSkills === undefined ? 'all' : projectSkills === 'none' ? 'none' : projectSkills.join('+')}`}</span> }))
vi.mock('./GitHosts.js', () => ({ GitHostOff: ({ home, account }: { home: { name: string } | null; account?: string }) => (home ? <span>Account · {account ?? home.name}</span> : null) }))

// The Composer is exercised by its own tests; here it only has to hand back a submit and report
// the props this component sets on it.
vi.mock('./Composer.js', async () => {
  const { forwardRef } = await import('react')
  const Composer = forwardRef((props: any, _ref: any) => (
    <div>
      <button type="button" disabled={props.busy} onClick={() => props.onSubmit('hello', { later: false })}>
        submit
      </button>
      <button type="button" disabled={props.busy} onClick={() => props.onSubmit('hello', { later: true })}>
        submit later
      </button>
      <span data-testid="composer-props">
        {JSON.stringify({ inAgent: props.inAgent, busyLabel: props.submitBusyLabel, placeholder: props.placeholder, sessionModel: props.sessionModel })}
      </span>
      {/* The empty-box slot control (#1455), rendered so the Stop/Resume tests can press it. */}
      {props.idleControl}
      <span data-testid="composer-controls">{props.controls}</span>
      <span data-testid="composer-controls-end">{props.controlsEnd}</span>
      {props.sessionRow}
    </div>
  ))
  return { Composer }
})

const { AgentComposer } = await import('./AgentComposer.js')

function renderComposer(over: Partial<Parameters<typeof AgentComposer>[0]> = {}) {
  const onAgentStarted = vi.fn()
  render(<AgentComposer projectId="p1" agentId="run-1" live files={[]} onAgentStarted={onAgentStarted} {...over} />)
  return { onAgentStarted }
}

const props = (): { inAgent: boolean; busyLabel: string; placeholder: string; sessionModel?: string } =>
  JSON.parse(screen.getByTestId('composer-props').textContent ?? '{}')

beforeEach(() => {
  sendMessage.mockReset()
  sendStop.mockReset()
})
afterEach(cleanup)

// The empty box's submit slot holds Stop while the agent is live, and nothing (the launcher
// collapse) once it ended, however it ended: a message continues it.
// The box sits in the chat's column: centered, at the transcript's width.
describe('AgentComposer column', () => {
  test('the box is centered at the transcript\'s column width', () => {
    const { container } = render(<AgentComposer projectId="p1" agentId="run-1" live files={[]} />)
    const box = container.firstElementChild!
    expect(box.className).toContain('mx-auto')
    expect(box.className).toContain('max-w-3xl')
  })
})

describe('AgentComposer row', () => {
  test('the row it is given goes to the composer, which draws it above the box', () => {
    renderComposer({ row: <span>the session's row</span> })
    expect(screen.getByText("the session's row")).toBeTruthy()
  })
})

describe('AgentComposer row under the box', () => {
  test('the launcher\'s items in the launcher\'s places, the session\'s own off: the agent, Skills, Context, then the run\'s pull requests; at the right the account the run worked as, then Auto', () => {
    const contextSet = { context: new Set(['src/app.ts']), add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), reset: vi.fn() }
    renderComposer({ agent: 'reviewer', gitHost: { url: 'https://github.com/o/r', name: 'GitHub' }, gitAccount: 'octo-agent', publish: 'pr', contextSet, controls: <span>PR #7</span>, skillsOff: ['github'], projectSkills: ['deploy'] })
    expect(screen.getByTestId('composer-controls').textContent).toBe('Agent · reviewerSkills · github/deployContext · src/app.tsPR #7')
    expect(screen.getByTestId('composer-controls-end').textContent).toBe('Account · octo-agentAuto: prpick Open PRpick Commit')
  })

  test('a session with no project: the agent, its skills and its pull requests alone, no Context, Auto or account, as the launcher with no project', () => {
    renderComposer({ projectId: 'session', controls: <span>PR #7</span> })
    expect(screen.getByTestId('composer-controls').textContent).toBe('Agent · defaultSkills · no projectPR #7')
    expect(screen.getByTestId('composer-controls-end').textContent).toBe('')
  })
})

describe('AgentComposer box', () => {
  test('the model the session runs on is handed to the box, to be said under it; none when not known', () => {
    renderComposer({ model: 'Opus 5.5' })
    expect(props().sessionModel).toBe('Opus 5.5')
    cleanup()
    renderComposer()
    expect(props().sessionModel).toBeUndefined()
  })

  test('the box says what sending does, live or ended, in one short line', () => {
    renderComposer()
    // A working agent: the keys, as Claude Code's box says them.
    expect(props().placeholder).toBe('⏎ to send, ⌘⏎ to queue for later')
    cleanup()
    renderComposer({ live: false })
    expect(props().placeholder).toBe('Message the agent to continue it…')
  })
})

describe('AgentComposer slot control (#1455)', () => {
  test('a live session offers Stop in the slot, and pressing it stops this run', async () => {
    sendStop.mockResolvedValue(undefined)
    renderComposer()
    const stop = screen.getByRole('button', { name: 'Stop agent' })
    fireEvent.click(stop)
    await waitFor(() => expect(sendStop).toHaveBeenCalledWith('p1', 'run-1'))
    // A landed Stop must not be re-fireable while the end event is still in flight: the button
    // stays disabled ("Stopping…") until `live` flips — the session's menu's own latch.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Stop agent' }) as HTMLButtonElement).disabled).toBe(true))
  })

  test('the Stopping… latch releases when the stop lands, so a continued run gets a working Stop again', async () => {
    // A message continues the SAME agent (#762) — same id — so a latch keyed to the agent id alone
    // re-engaged on the resumed session and froze its Stop as a disabled spinner.
    sendStop.mockResolvedValue(undefined)
    const ui = (live: boolean) => <AgentComposer projectId="p1" agentId="run-1" live={live} files={[]} />
    const { rerender } = render(ui(true))
    fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Stop agent' }) as HTMLButtonElement).disabled).toBe(true))
    rerender(ui(false)) // the end lands: the run is no longer live
    rerender(ui(true)) // the resume brings the same run back
    expect((screen.getByRole('button', { name: 'Stop agent' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('an ended session offers nothing in the slot, a stopped one too: a message continues it', () => {
    renderComposer({ live: false })
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop agent' })).toBeNull()
  })

  test('Esc stops a live session, as in Claude Code, unless a dialog or menu took it', async () => {
    sendStop.mockResolvedValue(undefined)
    renderComposer()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(sendStop).not.toHaveBeenCalled()
    dialog.remove()
    // The box's own suggestions are open: the key closes them, and stops nothing.
    const box = document.createElement('div')
    box.className = 'ProseMirror'
    box.setAttribute('aria-expanded', 'true')
    document.body.appendChild(box)
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(sendStop).not.toHaveBeenCalled()
    // Closed, Esc in the box stops the agent, even when the box takes the key.
    box.setAttribute('aria-expanded', 'false')
    box.addEventListener('keydown', event => event.preventDefault())
    fireEvent.keyDown(box, { key: 'Escape' })
    await waitFor(() => expect(sendStop).toHaveBeenCalledWith('p1', 'run-1'))
    box.remove()
    sendStop.mockClear()
    cleanup()
    sendStop.mockReset()
    renderComposer({ live: false })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(sendStop).not.toHaveBeenCalled()
  })
})

describe('AgentComposer, live (#714)', () => {
  test('nothing is said above the box, whatever the agent\'s state: the chat says it', () => {
    const states: Partial<Parameters<typeof AgentComposer>[0]>[] = [
      {},
      { live: false },
    ]
    for (const state of states) {
      const { container } = render(<AgentComposer projectId="p1" agentId="run-1" live files={[]} {...state} />)
      expect(container.querySelector('p')).toBeNull()
      expect(screen.queryByRole('status')).toBeNull()
      cleanup()
    }
  })

  test('a submit goes to the run as a message named by an id, and the page is told it waits to be read', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    const onQueued = vi.fn()
    const { onAgentStarted } = renderComposer({ onQueued })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'hello', 'run-1', null, { id: expect.any(String) }))
    const id = (sendMessage.mock.calls[0]![4] as { id: string }).id
    await waitFor(() => expect(onQueued).toHaveBeenCalledWith({ id, text: 'hello', later: false }))
    // The run was live already: nothing was started, so the shell is told nothing.
    expect(onAgentStarted).not.toHaveBeenCalled()
  })

  test('⌘Enter sends it for after the turn', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    const onQueued = vi.fn()
    renderComposer({ onQueued })
    fireEvent.click(screen.getByText('submit later'))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'hello', 'run-1', null, { id: expect.any(String), later: true }))
    await waitFor(() => expect(onQueued).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello', later: true })))
  })

  test('a refused message shows why, and is not reported as queued', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'unknown session' })
    const onQueued = vi.fn()
    renderComposer({ onQueued })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('unknown session'))
    expect(onQueued).not.toHaveBeenCalled()
  })
})

describe('AgentComposer, ended (#720, #1774)', () => {
  test('the box\'s own words say the session can be continued, rather than leaving it a dead end', () => {
    renderComposer({ live: false })
    expect(props().placeholder).toMatch(/continue it/)
    expect(props().busyLabel).toBe('Continuing…')
  })

  test('a message sent to an ended run is not queued: it continues the run', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    const onQueued = vi.fn()
    const { onAgentStarted } = renderComposer({ live: false, onQueued })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalled())
    expect(onQueued).not.toHaveBeenCalled()
  })

  test('a send is the same message call: the daemon resumes the run, and the shell follows the same run', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    const { onAgentStarted } = renderComposer({ live: false })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'hello', 'run-1'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('hello', 'run-1'))
  })

  test('a refused resume shows why and moves nowhere', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'the resume hook: no run run-1 in this project' })
    const { onAgentStarted } = renderComposer({ live: false })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('the resume hook: no run run-1 in this project'))
    expect(onAgentStarted).not.toHaveBeenCalled()
  })

  test('offers no driver/model select and no "Run on", since a session cannot change either (#831)', () => {
    renderComposer({ live: false })
    expect(props().inAgent).toBe(true)
  })
})

// An ended run's continuation takes seconds to write its first line: the message shows at once.
describe('AgentComposer sending to an ended run', () => {
  test('the message is handed to the feed before the send resolves', async () => {
    let resolve: (value: unknown) => void = () => {}
    sendMessage.mockReturnValue(new Promise(r => (resolve = r)))
    const onSending = vi.fn()
    renderComposer({ live: false, onSending })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(onSending).toHaveBeenCalledWith('hello')
    resolve(undefined)
    await waitFor(() => expect(sendMessage).toHaveBeenCalled())
    expect(onSending).toHaveBeenCalledTimes(1)
  })

  test('a send that fails takes the message back', async () => {
    sendMessage.mockRejectedValue(new Error('nope'))
    const onSending = vi.fn()
    renderComposer({ live: false, onSending })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    await waitFor(() => expect(onSending).toHaveBeenLastCalledWith(null))
  })

  test('a live run is not shown this way: its message waits in the inbox, under its own note', async () => {
    sendMessage.mockResolvedValue(undefined)
    const onSending = vi.fn()
    renderComposer({ live: true, onSending })
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalled())
    expect(onSending).not.toHaveBeenCalled()
  })

  test('the Context picked goes with the next message, at its end, and is cleared once it went (his pick)', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    const reset = vi.fn()
    const contextSet = { context: new Set(['src/app.ts']), add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), reset }
    renderComposer({ contextSet })
    expect(screen.getByText('Context · src/app.ts')).toBeTruthy()
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(reset).toHaveBeenCalled())
    expect(sendMessage).toHaveBeenCalledWith('p1', 'hello\n\nContext: src/app.ts', 'run-1', null, { id: expect.any(String) })
  })

  test('a refused message keeps the Context picked', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'no' })
    const reset = vi.fn()
    renderComposer({ contextSet: { context: new Set(['a.ts']), add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), reset } })
    fireEvent.click(screen.getByText('submit'))
    await screen.findByRole('alert')
    expect(reset).not.toHaveBeenCalled()
  })

  test('"Auto" shows the run\'s level; a pick goes with the next message, and shows until the run\'s record says it (his pick)', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    render(<AgentComposer projectId="p1" agentId="run-1" live files={[]} publish="commit" />)
    expect(screen.getByText(/Auto: commit/)).toBeTruthy()
    fireEvent.click(screen.getByText('submit'))
    // No pick: no level.
    await waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith('p1', 'hello', 'run-1', null, { id: expect.any(String) }))
    fireEvent.click(screen.getByText('pick Open PR'))
    expect(screen.getByText(/Auto: pr/)).toBeTruthy()
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith('p1', 'hello', 'run-1', 'pr', { id: expect.any(String) }))
    expect(screen.getByText(/Auto: pr/), 'still shown while the run has not taken it').toBeTruthy()
    // Picked back to what the record says: nothing to send.
    fireEvent.click(screen.getByText('pick Commit'))
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith('p1', 'hello', 'run-1', null, { id: expect.any(String) }))
  })

  test('sent to an ended run, the menu goes back to what the record says: a resume line that cannot take the level must not read as changed', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    render(<AgentComposer projectId="p1" agentId="run-1" live={false} files={[]} publish="commit" />)
    fireEvent.click(screen.getByText('pick Open PR'))
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith('p1', 'hello', 'run-1', 'pr'))
    await waitFor(() => expect(screen.getByText(/Auto: commit/)).toBeTruthy())
  })

  test('a run with no level shows Off', () => {
    render(<AgentComposer projectId="p1" agentId="run-1" live files={[]} />)
    expect(screen.getByText(/Auto: nothing/)).toBeTruthy()
  })
})
