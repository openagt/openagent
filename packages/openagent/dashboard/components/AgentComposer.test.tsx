import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// The two writes this component makes: what the person says to the run, and the slot's Stop (#1455).
const sendMessage = vi.hoisted(() => vi.fn())
const sendStop = vi.hoisted(() => vi.fn())
vi.mock('../rpc/control.js', () => ({ sendMessage, sendStop }))

// The Composer is exercised by its own tests; here it only has to hand back a submit and report
// the props this component sets on it.
vi.mock('./Composer.js', async () => {
  const { forwardRef } = await import('react')
  const Composer = forwardRef((props: any, _ref: any) => (
    <div>
      <button type="button" disabled={props.busy} onClick={() => props.onSubmit('hello')}>
        submit
      </button>
      <span data-testid="composer-props">
        {JSON.stringify({ showDriverModel: props.showDriverModel, inAgent: props.inAgent, busyLabel: props.submitBusyLabel, placeholder: props.placeholder, sessionModel: props.sessionModel })}
      </span>
      {/* The empty-box slot control (#1455), rendered so the Stop/Resume tests can press it. */}
      {props.idleControl}
    </div>
  ))
  return { Composer }
})

const { AgentComposer, RESUME_MESSAGE } = await import('./AgentComposer.js')

function renderComposer(over: Partial<Parameters<typeof AgentComposer>[0]> = {}) {
  const onAgentStarted = vi.fn()
  render(<AgentComposer projectId="p1" agentId="run-1" live files={[]} onAgentStarted={onAgentStarted} {...over} />)
  return { onAgentStarted }
}

const props = (): { showDriverModel: boolean; inAgent: boolean; busyLabel: string; placeholder: string; sessionModel?: string } =>
  JSON.parse(screen.getByTestId('composer-props').textContent ?? '{}')

beforeEach(() => {
  sendMessage.mockReset()
  sendStop.mockReset()
})
afterEach(cleanup)

// One slot, three states (#1455): the empty box's submit slot holds Stop while the agent is live,
// Resume once it was stopped, and nothing (the launcher collapse) otherwise.
// The box sits in the chat's column: centered, at the transcript's width.
describe('AgentComposer column', () => {
  test('the box is centered at the transcript\'s column width', () => {
    const { container } = render(<AgentComposer projectId="p1" agentId="run-1" live files={[]} />)
    const box = container.firstElementChild!
    expect(box.className).toContain('mx-auto')
    expect(box.className).toContain('max-w-3xl')
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
    // A working agent reads what is sent when its turn ends: the one thing worth saying there.
    expect(props().placeholder).toBe('Send now, and the agent reads it when its turn ends')
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

  test('the Stopping… latch releases when the stop lands, so a resumed run gets a working Stop again', async () => {
    // A Resume continues the SAME agent (#762) — same id — so a latch keyed to the agent id alone
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

  test('a stopped session offers Resume, which says the stock continuation to this same run (#1391)', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    const { onAgentStarted } = renderComposer({ live: false, outcome: { ok: false, stopped: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', RESUME_MESSAGE, 'run-1'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith(RESUME_MESSAGE, 'run-1'))
  })

  test('a refused Resume shows the daemon\'s own words instead of pretending to resume (#1391)', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'this project has no resume hook' })
    const { onAgentStarted } = renderComposer({ live: false, outcome: { ok: false, stopped: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('this project has no resume hook'))
    expect(onAgentStarted).not.toHaveBeenCalled()
    // Not latched as resuming: the offer is still there to press again.
    expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('a run that finished on its own, or waits on its question, offers neither', () => {
    renderComposer({ live: false, outcome: { ok: true, stopped: false } })
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop agent' })).toBeNull()
    cleanup()
    renderComposer({ live: false, outcome: { ok: false, stopped: false, waiting: true } })
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  })

  test('after a pressed Resume the slot holds a busy Resume until the run reads live — no flicker (#1460)', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    const base = { projectId: 'p1', agentId: 'run-1', files: [] }
    const { rerender } = render(<AgentComposer {...base} live={false} outcome={{ ok: false, stopped: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    // The resumed leg's first events momentarily stop `outcome` reading `stopped` while the agents
    // poll still says not-live: the slot used to flicker Resume → collapsed → Stop through here.
    rerender(<AgentComposer {...base} live={false} outcome={undefined} />)
    const held = await screen.findByRole('button', { name: 'Resume' })
    await waitFor(() => expect((held as HTMLButtonElement).disabled).toBe(true))
    // The agent reads live: the latch releases and the slot hands over to Stop.
    rerender(<AgentComposer {...base} live outcome={undefined} />)
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Stop agent' })).toBeTruthy()
  })
})

describe('AgentComposer, live (#714)', () => {
  test('nothing is said above the box, whatever the agent\'s state: the chat says it', () => {
    const states: Partial<Parameters<typeof AgentComposer>[0]>[] = [
      {},
      { live: false, outcome: { ok: true, stopped: false } },
      { live: false, outcome: { ok: false, stopped: false } },
      { live: false, outcome: { ok: false, stopped: true } },
      { live: false, outcome: { ok: false, stopped: false, waiting: true } },
    ]
    for (const state of states) {
      const { container } = render(<AgentComposer projectId="p1" agentId="run-1" live files={[]} {...state} />)
      expect(container.querySelector('p')).toBeNull()
      expect(screen.queryByRole('status')).toBeNull()
      cleanup()
    }
  })

  test('a submit goes to the run as a message, and the page is told it waits for the turn to end', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    const onQueued = vi.fn()
    const { onAgentStarted } = renderComposer({ onQueued })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'hello', 'run-1'))
    await waitFor(() => expect(onQueued).toHaveBeenCalledWith('hello'))
    // The run was live already: nothing was started, so the shell is told nothing.
    expect(onAgentStarted).not.toHaveBeenCalled()
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
    renderComposer({ live: false, outcome: { ok: true, stopped: false } })
    expect(props().placeholder).toMatch(/continue it/)
    expect(props().busyLabel).toBe('Resuming…')
  })

  test('a message sent to an ended run is not queued: it continues the run', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    const onQueued = vi.fn()
    const { onAgentStarted } = renderComposer({ live: false, outcome: { ok: true, stopped: false }, onQueued })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalled())
    expect(onQueued).not.toHaveBeenCalled()
  })

  test('a send is the same message call: the daemon resumes the run, and the shell follows the same run', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    const { onAgentStarted } = renderComposer({ live: false, outcome: { ok: true, stopped: false } })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'hello', 'run-1'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('hello', 'run-1'))
  })

  test('a refused resume shows why and moves nowhere', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'the resume hook: no run run-1 in this project' })
    const { onAgentStarted } = renderComposer({ live: false, outcome: { ok: false, stopped: false } })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('the resume hook: no run run-1 in this project'))
    expect(onAgentStarted).not.toHaveBeenCalled()
  })

  test('offers no driver/model select and no "Run on", since a session cannot change either (#831)', () => {
    renderComposer({ live: false })
    expect(props().showDriverModel).toBe(false)
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
})
