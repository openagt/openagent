import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// The two writes this component makes: what the person says to the run, and the slot's Stop (#1455).
const sendMessage = vi.hoisted(() => vi.fn())
const sendStop = vi.hoisted(() => vi.fn())
vi.mock('../rpc/control.js', () => ({ sendMessage, sendStop }))
// The "Auto" menu is tested on its own; here a stand-in says the pick it shows and offers a pick.
vi.mock('./AutoMenu.js', () => ({
  autoSaid: (publish: string, target?: { into: string }) => `auto ${publish}${target ? ` → ${target.into}` : ''}`,
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
vi.mock('./ContextMenu.js', () => ({
  SessionContextMenu: ({ context, repos }: { context: Set<string>; repos: readonly { name: string }[] }) => <span>Context · {[...repos.map(repo => repo.name), ...context].join(', ')}</span>,
}))
// The launcher's other items, each tested on its own: stand-ins that say what they were given.
vi.mock('./ProfileMenu.js', () => ({ ProfileOff: ({ profile }: { profile?: string }) => <span>Profile · {profile ?? 'default'}</span> }))
// How many skills the session got, for the gear's hover: a test sets it.
const skillCount = vi.hoisted(() => ({ current: undefined as number | undefined }))
vi.mock('./ProfilesPage.js', () => ({ useProfileName: (id: string) => (id === 'unread' ? undefined : id === 'default' ? 'Default' : id) }))
vi.mock('./SkillsMenu.js', () => ({ useRecordedSkillCount: () => skillCount.current, SkillsOff: ({ projectId, pluginsWithout, projectSkills }: { projectId?: string; pluginsWithout?: string[]; projectSkills?: 'all' | 'none' | string[] }) => <span>Skills · {projectId === undefined ? 'no project' : `${(pluginsWithout ?? []).join('+') || 'all'}/${projectSkills === undefined || projectSkills === 'all' ? 'all' : projectSkills === 'none' ? 'none' : projectSkills.join('+')}`}</span> }))
vi.mock('./GitHosts.js', () => ({ GitHostOff: ({ home, account }: { home: { name: string } | null; account?: string }) => (home ? <span>Account · {account ?? home.name}</span> : null) }))

// The Composer is exercised by its own tests; here it only has to hand back a submit and report
// the props this component sets on it.
const box = vi.hoisted(() => ({ clear: vi.fn((): unknown => ({ text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] }, images: [] })), restore: vi.fn(), focus: vi.fn(), edit: vi.fn(), append: vi.fn() }))
vi.mock('./Composer.js', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  const Composer = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => box)
    return (
    <div>
      <button type="button" disabled={props.busy} onClick={() => props.onSubmit('hello', { later: false, images: [] })}>
        submit
      </button>
      <button type="button" disabled={props.busy} onClick={() => props.onSubmit('hello', { later: true, images: [] })}>
        submit later
      </button>
      <button type="button" disabled={props.busy} onClick={() => props.onSubmit('and this?', { later: false, images: [`${'a'.repeat(64)}.png`] })}>
        submit with image
      </button>
      {props.notes}
      <span data-testid="composer-props">
        {JSON.stringify({ inAgent: props.inAgent, busyLabel: props.submitBusyLabel, placeholder: props.placeholder, sessionModel: props.sessionModel, autoFocus: props.autoFocus })}
      </span>
      {/* The empty-box slot control (#1455), rendered so the Stop/Resume tests can press it. */}
      {props.idleControl}
      <span data-testid="composer-setup" data-said={props.setup?.said} data-warn={props.setup?.warn === true}>{props.setup?.lines}</span>
      <span data-testid="composer-controls">{props.controls}</span>
      {props.sessionRow}
    </div>
    )
  })
  return { Composer }
})

const { AgentComposer } = await import('./AgentComposer.js')
const { keepDraft, keptDraft } = await import('../lib/draft-handoff.js')
const { ConfirmDialog } = await import('./ui/confirm-dialog.js')

function renderComposer(over: Partial<Parameters<typeof AgentComposer>[0]> = {}) {
  const onAgentStarted = vi.fn()
  render(<AgentComposer projectId="p1" agentId="run-1" live files={[]} onAgentStarted={onAgentStarted} {...over} />)
  return { onAgentStarted }
}

const props = (): { inAgent: boolean; busyLabel: string; placeholder: string; sessionModel?: { driver?: string; name?: string; effort?: string }; autoFocus?: boolean } =>
  JSON.parse(screen.getByTestId('composer-props').textContent ?? '{}')

beforeEach(() => {
  sendMessage.mockReset()
  sendStop.mockReset()
  skillCount.current = undefined
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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
  test('the launcher\'s gear, line for line in its places, the session\'s own said and not offered: the profile, Skills, the account the run worked as, then Auto; after the gear, Context alone', () => {
    const contextSet = { context: new Set(['src/app.ts']), add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), reset: vi.fn() }
    renderComposer({ profile: 'reviewer', gitHost: { url: 'https://github.com/o/r', name: 'GitHub' }, gitAccount: 'octo-agent', publish: 'pr', contextSet, pluginsWithout: ['tickets'], projectSkills: ['deploy'] })
    expect(screen.getByTestId('composer-setup').textContent).toBe('Profile · reviewerSkills · tickets/deployAccount · octo-agentAuto: prpick Open PRpick Commit')
    expect(screen.getByTestId('composer-controls').textContent).toBe('Context · src/app.ts')
  })

  test('a session in a project says the repos it started with, its copies, beside the files picked for the next message', () => {
    const contextSet = { context: new Set(['src/app.ts']), add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), reset: vi.fn() }
    renderComposer({ contextSet, repos: [{ name: 'api', from: '/w/api' }] })
    expect(screen.getByTestId('composer-controls').textContent).toBe('Context · api, src/app.ts')
  })

  test("a session with no project: the profile and its skills in the gear, no Auto; after it Context is the launcher's button, saying how many repos it started with", () => {
    renderComposer({ projectId: 'session', repos: [{ name: 'vike', from: '/home/me/oss/vike' }, { name: 'notes', from: '/home/me/notes' }] })
    expect(screen.getByTestId('composer-setup').textContent).toBe('Profile · defaultSkills · no project')
    const controls = screen.getByTestId('composer-controls')
    expect(within(controls).getByRole('button', { name: 'Context: 2 repos' }).textContent).toBe('Context · 2 repos')
    expect(within(controls).queryByRole('combobox')).toBeNull()
  })

  test('a session with no project and no repo has its Context all the same', () => {
    renderComposer({ projectId: 'session' })
    expect(within(screen.getByTestId('composer-controls')).getByRole('button', { name: 'Context' }).textContent).toBe('Context')
  })

  test("the gear's hover says the setup with its menu shut: the profile, how many skills, the account, the level and where its pull request goes; each once it is known", () => {
    skillCount.current = 12
    renderComposer({ profile: 'reviewer', gitAccount: 'octo-agent', publish: 'pr', prBase: 'login-page' })
    expect(screen.getByTestId('composer-setup').dataset.said).toBe('Profile reviewer · 12 skills · @octo-agent · auto pr → login-page')
    cleanup()
    skillCount.current = 1
    renderComposer()
    expect(screen.getByTestId('composer-setup').dataset.said).toBe('Profile Default · 1 skill · auto nothing')
    // Nothing read yet, and no project: neither the profile, the count nor a level is said.
    cleanup()
    skillCount.current = undefined
    renderComposer({ projectId: 'session', profile: 'unread' })
    expect(screen.getByTestId('composer-setup').dataset.said).toBe('')
    expect(screen.getByTestId('composer-setup').dataset.warn).toBe('false')
  })
})

describe('AgentComposer box', () => {
  test('a session opened takes what is typed next in its box; on a phone it waits for a tap', () => {
    renderComposer()
    expect(props().autoFocus).toBe(true)
    cleanup()
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    try {
      renderComposer()
      expect(props().autoFocus).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })


  test('the model the session runs on is handed to the box, to be said under it; none when not known', () => {
    renderComposer({ model: { driver: 'claude-code', name: 'Opus 5.5', effort: 'High' } })
    expect(props().sessionModel).toEqual({ driver: 'claude-code', name: 'Opus 5.5', effort: 'High' })
    cleanup()
    renderComposer()
    expect(props().sessionModel).toBeUndefined()
  })

  test('the box says what sending does, live or ended, in one short line', () => {
    renderComposer()
    // A working agent: the keys, as Claude Code's box says them.
    expect(props().placeholder).toMatch(/^Enter to send, (⌘Enter|Ctrl\+Enter) to queue for later$/)
    cleanup()
    renderComposer({ live: false })
    expect(props().placeholder).toBe('Message the agent to continue it…')
    cleanup()
    // Ended on a question its card asks: a message answers it.
    renderComposer({ live: false, asked: true })
    expect(props().placeholder).toBe('Or answer in your own words…')
  })

  test('on a touch screen the box names no keys', () => {
    const matchMedia = window.matchMedia
    window.matchMedia = (query: string) => ({ ...matchMedia(query), matches: query === '(pointer: coarse)' || matchMedia(query).matches })
    try {
      renderComposer()
      expect(props().placeholder).toBe('Message the agent…')
    } finally {
      window.matchMedia = matchMedia
    }
  })

  test("on a phone's width the box names no keys either: they would not fit", () => {
    const matchMedia = window.matchMedia
    window.matchMedia = (query: string) => ({ ...matchMedia(query), matches: query === '(width < 48rem)' || matchMedia(query).matches })
    try {
      renderComposer()
      expect(props().placeholder).toBe('Message the agent…')
    } finally {
      window.matchMedia = matchMedia
    }
  })
})

describe('AgentComposer slot control (#1455)', () => {
  test('a live session offers Stop in the slot, and pressing it stops this run', async () => {
    sendStop.mockResolvedValue({ ok: true })
    renderComposer({ agentId: 'run-stopped' })
    const stop = screen.getByRole('button', { name: 'Stop agent' })
    fireEvent.click(stop)
    await waitFor(() => expect(sendStop).toHaveBeenCalledWith('p1', 'run-stopped'))
    // A landed Stop must not be re-fireable while the end event is still in flight: the button
    // waits ("Stopping…") until `live` flips, and takes no second press.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop agent' }).getAttribute('aria-disabled')).toBe('true'))
    fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }))
    expect(sendStop).toHaveBeenCalledTimes(1)
  })

  test('a Stop that reached nothing says why, and Stop is offered again', async () => {
    sendStop.mockResolvedValue({ ok: false, error: 'It had already ended.' })
    renderComposer({ agentId: 'run-refused' })
    fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'It had already ended.')
    expect(screen.getByRole('button', { name: 'Stop agent' }).getAttribute('aria-disabled')).toBeNull()
  })

  test('the Stopping… latch releases when the stop lands, so a continued run gets a working Stop again', async () => {
    // A message continues the SAME agent (#762) — same id — so a latch keyed to the agent id alone
    // re-engaged on the resumed session and froze its Stop as a disabled spinner.
    sendStop.mockResolvedValue({ ok: true })
    const ui = (live: boolean) => <AgentComposer projectId="p1" agentId="run-continued" live={live} files={[]} />
    const { rerender } = render(ui(true))
    fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop agent' }).getAttribute('aria-disabled')).toBe('true'))
    rerender(ui(false)) // the end lands: the run is no longer live
    rerender(ui(true)) // the resume brings the same run back
    expect(screen.getByRole('button', { name: 'Stop agent' }).getAttribute('aria-disabled')).toBeNull()
  })

  test('a Stop that failed says so and can be pressed again, by the button or by Esc', async () => {
    sendStop.mockRejectedValueOnce('offline').mockResolvedValue(undefined)
    renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not stop the agent.'))
    expect((screen.getByRole('button', { name: 'Stop agent' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(sendStop).toHaveBeenCalledTimes(2))
  })

  test('while OpenAgent is not answering, Stop is off, and Esc stops nothing', async () => {
    const { DaemonDown } = await import('../lib/use-daemon-health.js')
    render(
      <DaemonDown.Provider value>
        <AgentComposer projectId="p1" agentId="run-1" live files={[]} />
      </DaemonDown.Provider>,
    )
    expect((screen.getByRole('button', { name: 'Stop agent' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(sendStop).not.toHaveBeenCalled()
  })

  test('an ended session offers nothing in the slot, a stopped one too: a message continues it', () => {
    renderComposer({ live: false })
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop agent' })).toBeNull()
  })

  test('Esc stops a live session, as in Claude Code, unless a question or the box took it', async () => {
    // The clock alone is stood in for: a double press is told by it.
    vi.useFakeTimers({ toFake: ['Date'] })
    sendStop.mockResolvedValue({ ok: true })
    renderComposer({ agentId: 'run-esc' })
    // A question over the session: the key is its Cancel.
    const question = render(<ConfirmDialog open onOpenChange={() => {}} title="Delete this session?" body="It goes for good." confirmLabel="Delete" />)
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(sendStop).not.toHaveBeenCalled()
    question.unmount()
    // The box's own suggestions are open: the key closes them, and stops nothing.
    const box = document.createElement('div')
    box.className = 'ProseMirror'
    box.setAttribute('aria-expanded', 'true')
    document.body.appendChild(box)
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(sendStop).not.toHaveBeenCalled()
    // Closed, an Esc straight after the one that closed them is the same press, said twice; so is a key held down.
    box.setAttribute('aria-expanded', 'false')
    box.addEventListener('keydown', event => event.preventDefault())
    fireEvent.keyDown(box, { key: 'Escape' })
    vi.setSystemTime(Date.now() + 600)
    fireEvent.keyDown(box, { key: 'Escape', repeat: true })
    expect(sendStop).not.toHaveBeenCalled()
    // A press of its own in the box stops the agent, even when the box takes the key.
    fireEvent.keyDown(box, { key: 'Escape' })
    await waitFor(() => expect(sendStop).toHaveBeenCalledWith('p1', 'run-esc'))
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

  test('the box is emptied as the message goes, so what is typed meanwhile stays; a refused one comes back to it', async () => {
    let answer: (outcome: unknown) => void = () => {}
    sendMessage.mockReturnValue(new Promise(resolve => (answer = resolve)))
    box.clear.mockClear()
    box.restore.mockClear()
    renderComposer()
    fireEvent.click(screen.getByText('submit'))
    expect(box.clear).toHaveBeenCalledTimes(1)
    act(() => answer({ ok: false, error: 'unknown session' }))
    // What the box held, as it handed it over (AgentComposer.editor.test.tsx: its chips and Context too).
    await waitFor(() => expect(box.restore).toHaveBeenCalledWith(box.clear.mock.results[0]!.value))
    expect(box.clear).toHaveBeenCalledTimes(1)
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

describe('AgentComposer, another session picked', () => {
  const composer = (agentId: string) => <AgentComposer projectId="p1" agentId={agentId} live files={[]} />

  test('a send going and its refusal are its own session’s, the refusal said there however late it comes back', async () => {
    let answer: (outcome: unknown) => void = () => {}
    sendMessage.mockReturnValueOnce(new Promise(resolve => (answer = resolve)))
    const page = render(composer('run-1'))
    fireEvent.click(screen.getByText('submit'))
    expect((screen.getByText('submit') as HTMLButtonElement).disabled).toBe(true)
    page.rerender(composer('run-2'))
    expect((screen.getByText('submit') as HTMLButtonElement).disabled).toBe(false)
    await act(async () => answer({ ok: false, error: 'session A refused it' }))
    expect(screen.queryByRole('alert')).toBeNull()
    page.rerender(composer('run-1'))
    expect(screen.getByRole('alert').textContent).toBe('session A refused it')
  })

  test('a Stop that failed is said in its own session, not in the next one picked', async () => {
    sendStop.mockRejectedValueOnce(new Error('session A could not be stopped'))
    const page = render(composer('run-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('session A could not be stopped'))
    page.rerender(composer('run-2'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('a send refused once another session is shown gives its words back to its own session’s box, after what it holds, and leaves the shown box and its focus alone', async () => {
    let answer: (outcome: unknown) => void = () => {}
    sendMessage.mockReturnValueOnce(new Promise(resolve => (answer = resolve)))
    const page = render(composer('run-1'))
    fireEvent.click(screen.getByText('submit'))
    // Typed in run-1's box while the message went.
    keepDraft('p1:run-1', 'and one more thing')
    page.rerender(composer('run-2'))
    box.append.mockClear()
    box.restore.mockClear()
    box.focus.mockClear()
    await act(async () => answer({ ok: false, error: 'session A refused it' }))
    expect([box.append.mock.calls, box.restore.mock.calls, box.focus.mock.calls]).toEqual([[], [], []])
    page.rerender(composer('run-1'))
    // What run-1's box opens with (Composer's own test).
    expect(keptDraft('p1:run-1')).toBe('and one more thing\n\nhello')
  })

  test('a late successful Stop for A leaves B stoppable', async () => {
    let finish!: () => void
    sendStop.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    const ui = (agentId: string) => <AgentComposer projectId="p1" agentId={agentId} live files={[]} />
    const page = render(ui('A'))
    fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }))
    page.rerender(ui('B'))
    expect((screen.getByRole('button', { name: 'Stop agent' }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => finish())
    expect((screen.getByRole('button', { name: 'Stop agent' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('AgentComposer, given back what the run never read', () => {
  test('says the words were not sent, until the next message goes', async () => {
    const giveBack: { current: ((text: string) => void) | null } = { current: null }
    sendMessage.mockResolvedValue({ ok: true })
    renderComposer({ live: false, giveBack })
    expect(screen.queryByText('Not sent: the session stopped first.')).toBeNull()
    act(() => giveBack.current!('and add a test'))
    expect(screen.getByRole('status').textContent).toBe('Not sent: the session stopped first.')
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => expect(screen.queryByText('Not sent: the session stopped first.')).toBeNull())
  })
})

describe('AgentComposer, ended (#720, #1774)', () => {
  test('the box\'s own words say the session can be continued, rather than leaving it a dead end', () => {
    renderComposer({ live: false })
    expect(props().placeholder).toMatch(/continue it/)
    expect(props().busyLabel).toBe('Continuing…')
  })

  test('a message\'s images go with it: to a working run, and shown waiting with it; to an ended run, and shown with it as it goes', async () => {
    const shot = `${'a'.repeat(64)}.png`
    sendMessage.mockResolvedValue({ ok: true })
    const onQueued = vi.fn()
    renderComposer({ onQueued })
    fireEvent.click(screen.getByText('submit with image'))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'and this?', 'run-1', null, { id: expect.any(String), images: [shot] }))
    await waitFor(() => expect(onQueued).toHaveBeenCalledWith({ id: expect.any(String), text: 'and this?', later: false, images: [shot] }))
    cleanup()
    sendMessage.mockClear()
    const onSending = vi.fn()
    renderComposer({ live: false, onSending })
    fireEvent.click(screen.getByText('submit with image'))
    expect(onSending).toHaveBeenCalledWith('and this?', [shot])
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'and this?', 'run-1', null, { images: [shot] }))
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
    const remove = vi.fn()
    const contextSet = { context: new Set(['src/app.ts']), add: vi.fn(), remove, toggle: vi.fn(), reset: vi.fn() }
    renderComposer({ contextSet })
    expect(screen.getByText('Context · src/app.ts')).toBeTruthy()
    fireEvent.click(screen.getByText('submit'))
    // Cleared of what it went with, which is all of it here (AgentComposer.editor.test.tsx: what was picked meanwhile stays).
    await waitFor(() => expect(remove).toHaveBeenCalledWith('src/app.ts'))
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

  test('sent to an ended run, the menu goes back to what the record says: a resume that never records the level must not read as changed', async () => {
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
