import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '@openagt/skill-ui/module'
import { openMenu } from '../test-utils.js'

// Everything the form reads goes through a lib module, so the mocks stop at the `rpc/` stubs: an
// unmocked one reaches for `/_rpc/<name>`, and there is no daemon behind jsdom to answer.
const onCommands = vi.hoisted(() => vi.fn())
const onStartCheck = vi.hoisted(() => vi.fn())
const onCloneCheck = vi.hoisted(() => vi.fn())
const onProjects = vi.hoisted(() => vi.fn(async () => [] as unknown[]))
vi.mock('../rpc/projects.js', () => ({ onCommands, onStartCheck, onCloneCheck, onProjects }))

// Mutable so a test can pick the coding agent and the model; reset after each.
const prefs = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const updatePreferences = vi.hoisted(() => vi.fn())
// Whether the saved preferences have been read: a test turns it off to see what waits for them.
const prefsLoaded = vi.hoisted(() => ({ current: true }))
vi.mock('../lib/preferences.js', () => ({ usePreferences: () => prefs.current, usePreferencesLoaded: () => prefsLoaded.current, updatePreferences }))
const machine = vi.hoisted(() => ({ current: null as null | { id: string; url: string; label: string } }))
vi.mock('../lib/machines.js', () => ({ useMachines: () => (machine.current ? [machine.current] : []) }))
const followProjectHome = vi.hoisted(() => vi.fn())
vi.mock('../lib/remote-target.js', async () => ({
  ...(await vi.importActual<typeof import('../lib/remote-target.js')>('../lib/remote-target.js')),
  useSelectedMachineId: () => machine.current?.id ?? null,
  followProjectHome,
}))
const logins = vi.hoisted(() => ({ onAgentState: vi.fn(), sendAgentFix: vi.fn(), onGitHosts: vi.fn(), sendGitHostInstall: vi.fn(), sendGitHostLogin: vi.fn(), sendUseGitHostAccount: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
// A picked machine's own check, and how this computer's logins stand on the machines that take them.
const onMachineStartCheck = vi.hoisted(() => vi.fn())
const onMachineLogins = vi.hoisted(() => vi.fn())
vi.mock('../rpc/machines.js', () => ({ onMachineStartCheck, onMachineLogins }))
const serverLogins = vi.hoisted(() => ({ onServerLogins: vi.fn(), sendUseLoginsOn: vi.fn(), sendAllowLogins: vi.fn(), sendSettleLogin: vi.fn() }))
vi.mock('../rpc/server-logins.js', () => serverLogins)
const openSettings = vi.hoisted(() => vi.fn())
vi.mock('../lib/use-route.js', async () => ({ ...(await vi.importActual<typeof import('../lib/use-route.js')>('../lib/use-route.js')), openSettings }))

const start = vi.hoisted(() => vi.fn())
// What the start says of itself beside its answer: that the machine is cloning the project, or why there is no run.
const startSays = vi.hoisted(() => ({ cloning: false, error: null as string | null }))
vi.mock('../lib/use-start-agent.js', async () => ({
  ...(await vi.importActual<typeof import('../lib/use-start-agent.js')>('../lib/use-start-agent.js')),
  useStartAgent: () => ({ busy: false, cloning: startSays.cloning, error: startSays.error, reset: vi.fn(), start }),
}))

// The Composer is exercised by its own tests; here it hands back a typed submit, shows whether
// the form lets it submit at all, and renders the launcher's controls.
const composerProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('./Composer.js', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  const Composer = forwardRef((props: any, ref: any) => {
    composerProps.current = props
    useImperativeHandle(ref, () => ({
      clear: () => {},
      focus: () => {},
    }))
    return (
      <>
        <div data-testid="starts-at">{props.startsAt}</div>
        <div data-testid="controls">{props.controls}</div>
        <button type="button" disabled={!props.canSubmit} onClick={() => props.onSubmit('do the thing')}>
          submit-typed
        </button>
      </>
    )
  })
  return { Composer }
})

/** Where the agent starts, as the row above the box says it. */
const startsAt = (): string => screen.getByTestId('starts-at').textContent ?? ''

const { StartAgentForm } = await import('./StartAgentForm.js')

// No check hook unless a test gives one: nothing to say.
beforeEach(() => {
  onStartCheck.mockResolvedValue(null)
  onCloneCheck.mockResolvedValue({ problems: [], warnings: [] })
  onMachineStartCheck.mockResolvedValue(null)
  onMachineLogins.mockResolvedValue({ ok: true, logins: { github: { source: 'made' }, claude: { source: 'made' } } })
  serverLogins.onServerLogins.mockResolvedValue({ computer: 'Mac', servers: [] })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  start.mockReset()
  startSays.cloning = false
  startSays.error = null
  onCommands.mockReset()
  onStartCheck.mockReset()
  onCloneCheck.mockReset()
  onMachineStartCheck.mockReset()
  onMachineLogins.mockReset()
  for (const fn of Object.values(serverLogins)) fn.mockReset()
  openSettings.mockReset()
  followProjectHome.mockReset()
  updatePreferences.mockReset()
  prefs.current = {}
  prefsLoaded.current = true
  machine.current = null
})

const COMMANDS = [{ name: 'work-queue', description: 'Work the agent queue' }]
const noop = () => {}

/** The launcher's "Auto" menu button; its text says the publish pick and the cleanup. */
const autoMenu = () => screen.getByRole('button', { name: 'Auto' })
/** The labels of the publish options the open "Auto" menu lists. */
const publishOptions = () => screen.getAllByRole('menuitem').map(item => item.querySelector('span > span')!.textContent)
/** The launcher's "start from" chip, when there is one. */
const startFromChip = () => screen.queryByRole('button', { name: 'The agent starts from' })
/** A project whose start line passes the branch on, whose folder is on `my/work`. */
const WITH_BRANCHES = { commands: [], startHook: true, gitHost: true, remote: true, address: 'github.com/acme/shop', startFrom: { main: 'main', local: 'my/work' } }
const props = { projectId: 'p1', files: [], context: new Set<string>(), addContext: noop, removeContext: noop, toggleContext: noop }

describe('StartAgentForm (#1774)', () => {
  test('the project\'s commands are no buttons: they are in the box\'s `/` list, and nothing starts', async () => {
    onCommands.mockResolvedValue({ commands: COMMANDS, startHook: true, gitHost: true })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(onCommands).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: '/work-queue' })).toBeNull()
    expect(start).not.toHaveBeenCalled()
  })

  test('Start hands the picked coding agent and model to the start hook, and selects the run it answers', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    prefs.current = { driver: 'codex', model: 'gpt-5' }
    start.mockResolvedValue({ agentId: 'r1' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} onAgentStarted={onAgentStarted} />)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r1', undefined, undefined))
    expect(start).toHaveBeenCalledWith('p1', 'do the thing', { driver: 'codex', model: 'gpt-5' })
  })

  test('while the start is asked for, the form says "Starting session", the chat\'s own first line, and nothing once it answers', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    let answer!: (result: { agentId: string }) => void
    start.mockReturnValue(new Promise(resolve => (answer = resolve)))
    render(<StartAgentForm {...props} />)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Starting session'))
    answer({ agentId: 'r1' })
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  test("while this computer clones another computer's project for the run, the form says so, naming this computer", async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, address: 'github.com/acme/shop' })
    start.mockReturnValue(new Promise(() => {}))
    const { rerender } = render(<StartAgentForm {...props} projectName="shop" home="laptop" />)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Starting session'))
    startSays.cloning = true
    rerender(<StartAgentForm {...props} projectName="shop" home="laptop" />)
    // The page is open on the computer itself here: a phone's says the name the page was reached at.
    expect(screen.getByRole('status').textContent).toBe('Cloning shop on this computer, the first time only')
  })

  test('while the machine the run was sent to clones the project, the form says so, with the project and the machine by name', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, address: 'github.com/acme/shop' })
    machine.current = { id: 'm1', label: 'Studio', url: 'https://studio.example' }
    start.mockReturnValue(new Promise(() => {}))
    const { rerender } = render(<StartAgentForm {...props} projectName="shop" />)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Starting session'))
    startSays.cloning = true
    rerender(<StartAgentForm {...props} projectName="shop" />)
    expect(screen.getByRole('status').textContent).toBe('Cloning shop on Studio, the first time only')
    // The machine it was sent to, also when another is picked meanwhile.
    machine.current = { id: 'm2', label: 'Other', url: 'https://other.example' }
    rerender(<StartAgentForm {...props} projectName="shop" />)
    expect(screen.getByRole('status').textContent).toBe('Cloning shop on Studio, the first time only')
  })

  test('why no run started is a box above the message box: what is wrong as its title, in the page\'s own text size, then what follows smaller; nothing of the page shows through it', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    startSays.error = 'shop could not be cloned on Studio. Studio says: This computer has no login that can read github.com/acme/shop.'
    render(<StartAgentForm {...props} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(startSays.error)
    for (const part of ['border-danger/30', 'var(--color-danger)_8%,var(--color-background)']) expect(alert.className).toContain(part)
    const title = within(alert).getByText('shop could not be cloned on Studio.')
    expect(title.className).toContain('text-sm')
    expect(title.className).toContain('text-danger')
    expect(within(alert).getByText('Studio says: This computer has no login that can read github.com/acme/shop.').className).toContain('text-xs')
    expect(alert.parentElement!.className).toContain('bottom-full')
  })

  test('under the box: the Context picker, then the "Auto" menu', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true })
    render(<StartAgentForm {...props} />)
    const below = screen.getByTestId('controls')
    await waitFor(() => expect(below.contains(autoMenu())).toBe(true))
    const context = within(below).getAllByRole('button')[0]!
    expect(context).not.toBe(autoMenu())
    expect(context.compareDocumentPosition(autoMenu()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('the publish options: the button reads Commit until the person picks, and the Start carries no pick, left to the daemon; a saved pick is shown and carried, Off too; a change writes the saved setting', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    expect(autoMenu().textContent).toBe('Auto: Commit')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', {}))

    await openMenu(autoMenu())
    expect(publishOptions()).toEqual(['Off', 'Commit', 'Publish branch', 'Open PR', 'Merge on green'])
    fireEvent.click(screen.getByRole('menuitem', { name: /^Open PR/ }))
    expect(updatePreferences).toHaveBeenCalledWith({ publish: 'pr' })

    cleanup()
    start.mockClear()
    prefs.current = { publish: 'merge' }
    render(<StartAgentForm {...props} />)
    expect(autoMenu().textContent).toBe('Auto: Merge on green')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { publish: 'merge' }))

    cleanup()
    start.mockClear()
    prefs.current = { publish: 'nothing' }
    render(<StartAgentForm {...props} />)
    expect(autoMenu().textContent).toBe('Auto: Off')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { publish: 'nothing' }))
  })

  test('a project with no git host package is offered Off, Commit and Publish branch only, and a saved pull request pick reads as the branch, which is where the daemon holds it', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: false })
    prefs.current = { publish: 'merge' }
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(autoMenu().textContent).toBe('Auto: Publish branch'))
    await openMenu(autoMenu())
    expect(publishOptions()).toEqual(['Off', 'Commit', 'Publish branch'])
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { publish: 'merge' }))
  })

  test('a project with no remote is offered Off and Commit; its button reads Commit until the person picks, and with a saved publish pick too', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: false, remote: false })
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(autoMenu().textContent).toBe('Auto: Commit'))
    await openMenu(autoMenu())
    expect(publishOptions()).toEqual(['Off', 'Commit'])
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', {}))

    cleanup()
    start.mockClear()
    prefs.current = { publish: 'merge' }
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(autoMenu().textContent).toBe('Auto: Commit'))
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { publish: 'merge' }))
  })

  test('a project with no remote but the cleanup command: the Auto menu holds the cleanup under its two picks', async () => {
    onCommands.mockResolvedValue({ commands: [{ name: 'post-merge-cleanup' }], startHook: true, gitHost: false, remote: false })
    prefs.current = { publish: 'merge', postMergeCleanup: true }
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(autoMenu().textContent).toBe('Auto: Commit · cleanup'))
    await openMenu(autoMenu())
    expect(publishOptions()).toEqual(['Off', 'Commit'])
    expect(screen.getByRole('menuitemcheckbox', { name: /^Post-merge cleanup/ })).toBeTruthy()
  })

  test('a project with the post-merge-cleanup command has the box in the Auto menu; ticked, the start carries the command as the follow-up', async () => {
    onCommands.mockResolvedValue({ commands: [...COMMANDS, { name: 'post-merge-cleanup' }], startHook: true, gitHost: true })
    prefs.current = { postMergeCleanup: true }
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(autoMenu().textContent).toBe('Auto: Commit · cleanup'))
    await openMenu(autoMenu())
    const box = screen.getByRole('menuitemcheckbox', { name: /^Post-merge cleanup/ })
    expect(box.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { then: '/post-merge-cleanup' }))

    // The box writes the saved setting, the one Settings shows: every next run's default.
    fireEvent.click(box)
    expect(updatePreferences).toHaveBeenCalledWith({ postMergeCleanup: false })
  })

  test('without the command there is no box, and a saved setting sends nothing; unticked, nothing either', async () => {
    onCommands.mockResolvedValue({ commands: COMMANDS, startHook: true, gitHost: true })
    prefs.current = { postMergeCleanup: true }
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(onCommands).toHaveBeenCalled())
    expect(autoMenu().textContent).toBe('Auto: Commit')
    await openMenu(autoMenu())
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', {}))
    cleanup()

    start.mockClear()
    onCommands.mockResolvedValue({ commands: [{ name: 'post-merge-cleanup' }], startHook: true, gitHost: true })
    prefs.current = {}
    render(<StartAgentForm {...props} />)
    await openMenu(autoMenu())
    const box = await screen.findByRole('menuitemcheckbox', { name: /^Post-merge cleanup/ })
    expect(box.getAttribute('aria-checked')).toBe('false')
    expect(autoMenu().textContent).toBe('Auto: Commit')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', {}))
  })

  test('no pick made: neither is sent, so the hook decides', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', {}))
  })

  test('a project with no start hook cannot start: the submit is off and the form says what to add', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: false, gitHost: true })
    render(<StartAgentForm {...props} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('This project has no start hook. Add a start: line to .openagent/hooks.yml.')
    expect((screen.getByText('submit-typed') as HTMLButtonElement).disabled).toBe(true)
  })

  test('before the project is read, and with a start hook, nothing is said and the submit is on', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    render(<StartAgentForm {...props} />)
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(onCommands).toHaveBeenCalledWith('p1'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByText('submit-typed') as HTMLButtonElement).disabled).toBe(false)
  })

  test('a picked machine runs its own start hook: the start names it by its id and carries no key, and this project\'s missing hook does not block', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: false, gitHost: true, remote: true, address: 'github.com/acme/shop' })
    machine.current = { id: 'd1', url: 'http://box:4200', label: 'box' }
    start.mockResolvedValue({ agentId: 'r2' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} onAgentStarted={onAgentStarted} />)
    await waitFor(() => expect(onCommands).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r2', 'box', undefined))
    expect(start).toHaveBeenCalledWith('p1', 'do the thing', { machine: 'd1' })
    expect(onStartCheck).not.toHaveBeenCalled()
  })

  test('a project with no repository address runs here only: a machine picked on another project is not its target', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: false, remote: true })
    machine.current = { id: 'd1', url: 'http://box:4200', label: 'box' }
    start.mockResolvedValue({ agentId: 'r3' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} onAgentStarted={onAgentStarted} />)
    await waitFor(() => expect(onCommands).toHaveBeenCalled())
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(start.mock.calls[0]![2]).not.toHaveProperty('machine')
    expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r3', undefined, undefined)
  })

  test('what would stop the run is said before the Start, for the coding agent picked; a warning is said too, and neither turns Start off', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    prefs.current = { driver: 'codex' }
    onStartCheck.mockResolvedValue({ problems: ['`codex` is not logged in. Run `codex login`, then start again.'], warnings: ['`gh` is not logged in.'] })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(onStartCheck).toHaveBeenCalledWith('p1', 'codex')
    const [problem, warning] = screen.getAllByRole('alert')
    expect(problem!.textContent).toBe('`codex` is not logged in. Run `codex login`, then start again.')
    expect(within(problem!).getByText('`codex` is not logged in.').className).toContain('text-danger')
    expect(warning!.className).toContain('text-warning')
    expect((screen.getByText('submit-typed') as HTMLButtonElement).disabled).toBe(false)
    // Above the box, over the page: the box does not move when they come.
    expect(problem!.parentElement!.className).toContain('bottom-full')
  })

  test('with a machine picked, the machine is asked whether a run would start there, and its logged-out agent is said in words naming it, with this computer\'s logins to use there', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true, address: 'github.com/acme/shop' })
    machine.current = { id: 'd1', url: 'https://box/_devices/via/1', label: 'experiment' }
    const line = '`claude` is not logged in. Run `claude auth login`, then start again.'
    onMachineStartCheck.mockResolvedValue({ problems: [line, 'something else'], warnings: [], fix: { kind: 'log-in', command: 'claude auth login', problem: line } })
    serverLogins.onServerLogins.mockResolvedValue({ computer: 'Mac', servers: [{ machineId: 'd1', label: 'experiment', on: false, reachable: true, logins: [], left: [] }] })
    serverLogins.sendUseLoginsOn.mockResolvedValue({ ok: true })
    render(<StartAgentForm {...props} />)
    const press = await screen.findByRole('button', { name: 'Use them' })
    expect(onMachineStartCheck).toHaveBeenCalledWith('p1', 'd1', undefined)
    expect(onStartCheck).not.toHaveBeenCalled()
    const [refusal, other] = screen.getAllByRole('alert')
    expect(refusal!.textContent).toContain('Claude Code is not logged in on experiment.')
    expect(refusal!.textContent).not.toContain('claude auth login')
    expect(refusal!.contains(press)).toBe(true)
    expect(other!.textContent).toBe('something else')
    // This computer's own login press is no fix for the machine.
    expect(screen.queryByRole('button', { name: 'Log in to Claude Code' })).toBeNull()
    fireEvent.click(press)
    await waitFor(() => expect(serverLogins.sendUseLoginsOn).toHaveBeenCalledWith('d1'))
  })

  test('another person\'s computer that lacks this person\'s logins says so as soon as it is picked, with the way to its page where they are logged in', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true, address: 'github.com/acme/shop' })
    machine.current = { id: 'https://203.0.113.5/_devices/via/b0x1', url: 'https://203.0.113.5/_devices/via/b0x1', label: 'experiment (through 203.0.113.5)', owner: 'Suleiman' } as typeof machine.current
    onMachineLogins.mockResolvedValue({ ok: true, logins: { github: { source: 'made' } } })
    // The start a press would make anyway: its refusal says nothing the box does not.
    startSays.error = 'Your GitHub and Claude logins are not on experiment (through 203.0.113.5) yet.'
    render(<StartAgentForm {...props} />)
    const press = await screen.findByRole('button', { name: 'Log in on experiment' })
    expect(onMachineLogins).toHaveBeenCalledWith('https://203.0.113.5/_devices/via/b0x1')
    const [box, ...others] = screen.getAllByRole('alert')
    expect(others).toHaveLength(0)
    expect(within(box!).getByText('Your Claude login is not on experiment yet.')).toBeTruthy()
    expect(box!.textContent).toContain('start your first run there from your page on 203.0.113.5, which copies yours')
    expect(box!.contains(press)).toBe(true)
    fireEvent.click(press)
    expect(openSettings).toHaveBeenCalledWith('devices', 'https://203.0.113.5/_devices/via/b0x1')
  })

  test('another person\'s computer that has this person\'s logins says nothing of them', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true, address: 'github.com/acme/shop' })
    machine.current = { id: 'm2', url: 'https://203.0.113.5/_devices/via/b0x2', label: 'experiment (through 203.0.113.5)', owner: 'Suleiman' } as typeof machine.current
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(onMachineLogins).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('a machine that takes no logins of this computer\'s sends the person to Settings, Accounts', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true, address: 'github.com/acme/shop' })
    machine.current = { id: 'd2', url: 'https://box/_devices/via/2', label: 'Dani\'s PC' }
    const line = '`codex` is not logged in. Run `codex login`, then start again.'
    prefs.current = { driver: 'codex' }
    onMachineStartCheck.mockResolvedValue({ problems: [line], warnings: [], fix: { kind: 'log-in', command: 'codex login', problem: line } })
    render(<StartAgentForm {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Accounts' }))
    expect(screen.getByRole('alert').textContent).toContain('Codex is not logged in on Dani\'s PC.')
    expect(onMachineStartCheck).toHaveBeenCalledWith('p1', 'd2', 'codex')
    expect(openSettings).toHaveBeenCalledWith('accounts')
  })

  test('a machine without the picked agent says so in words naming it, and the press opens its page, where an update brings it', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true, address: 'github.com/acme/shop' })
    machine.current = { id: 'd3', url: 'https://box/_devices/via/3', label: 'experiment' }
    const line = '`codex` not found — install the Codex CLI and make sure `codex` is on your PATH: https://developers.openai.com/codex/cli'
    prefs.current = { driver: 'codex' }
    onMachineStartCheck.mockResolvedValue({ problems: [line], warnings: [], fix: { kind: 'install', command: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh', problem: line } })
    render(<StartAgentForm {...props} />)
    const press = await screen.findByRole('button', { name: 'Update experiment' })
    const box = screen.getByRole('alert')
    expect(within(box).getByText('Codex is not installed on experiment.')).toBeTruthy()
    expect(within(box).getByText('Update experiment to get it.')).toBeTruthy()
    // This computer's install command is no fix for the machine.
    expect(box.textContent).not.toContain('install.sh')
    expect(box.contains(press)).toBe(true)
    fireEvent.click(press)
    expect(openSettings).toHaveBeenCalledWith('devices', 'd3')
  })

  test('a problem a press fixes has its button on the red line, with the command it runs; once fixed, the check is asked again and the line goes', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    const line = '`claude` is not logged in. Run `claude auth login`, then start again.'
    onStartCheck.mockResolvedValue({ problems: [line], warnings: [], fix: { kind: 'log-in', command: 'claude auth login', problem: line } })
    let ready = false
    logins.onAgentState.mockImplementation(async () => (ready ? { driver: 'claude-code', ready: true } : { driver: 'claude-code', ready: false, problem: line, fix: { kind: 'log-in', command: 'claude auth login' } }))
    logins.sendAgentFix.mockImplementation(async () => {
      ready = true
      return { ok: true }
    })
    render(<StartAgentForm {...props} />)
    const press = await screen.findByRole('button', { name: 'Log in to Claude Code' })
    // The press is inside the red line, which says it in the agent's own words.
    const refusal = screen.getByRole('alert')
    expect(refusal.contains(press)).toBe(true)
    expect(within(refusal).getByText('Claude Code is not logged in.')).toBeTruthy()
    expect(refusal.textContent).not.toContain('Run `claude auth login`')
    fireEvent.click(press)
    expect(screen.getByText('claude auth login')).toBeTruthy()
    await waitFor(() => expect(logins.sendAgentFix).toHaveBeenCalledWith('claude-code'))
    onStartCheck.mockResolvedValue({ problems: [], warnings: [] })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull(), { timeout: 3000 })
  })

  test('the row above the box starts with the project\'s name, said in words, not a button', () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    render(<StartAgentForm {...props} projectName="gemstack" />)
    const project = screen.getByTestId('starts-at').firstElementChild!
    expect(startsAt()).toBe('gemstack')
    expect(project.textContent).toBe('gemstack')
    expect(project.querySelector('svg')).not.toBeNull()
    expect(project.tagName).not.toBe('BUTTON')
    // Cut short with an ellipsis where the row is too narrow for it.
    expect(screen.getByText('gemstack').className).toContain('truncate')
    // No heading over the box: the page is laid out as an agent's chat, whose box has none.
    expect(screen.queryByText('Start an agent')).toBeNull()
  })

  test('until the project\'s name is known there is no project word, and the row is asked for all the same', () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    const { rerender } = render(<StartAgentForm {...props} />)
    expect(startsAt()).toBe('')
    expect(composerProps.current.startsAt).toBeNull()
    rerender(<StartAgentForm {...props} projectName="gemstack" />)
    expect(startsAt()).toBe('gemstack')
  })

  test('the "start from" chip is after the project\'s chip and reads the main branch until the person picks; then the Start names no branch', async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(startFromChip()).not.toBeNull())
    expect(startsAt()).toBe('gemstackmain')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', {}))
  })

  test('the local pick is saved for this project alone, shown on the chip, and the Start names the local branch; the main pick takes the project out again', async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    start.mockResolvedValue({ agentId: 'r1' })
    prefs.current = { startFrom: { other: 'local' } }
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(startFromChip()).not.toBeNull())
    // Another project's pick is not this one's.
    expect(startFromChip()!.textContent).toBe('main')
    await openMenu(startFromChip()!)
    fireEvent.click(screen.getByRole('menuitem', { name: /^My local branch my\/work/ }))
    expect(updatePreferences).toHaveBeenCalledWith({ startFrom: { other: 'local', p1: 'local' } })

    cleanup()
    updatePreferences.mockClear()
    prefs.current = { startFrom: { other: 'local', p1: 'local' } }
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(startFromChip()).not.toBeNull())
    expect(startFromChip()!.textContent).toBe('my/work (local)')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { base: 'my/work' }))
    await openMenu(startFromChip()!)
    fireEvent.click(screen.getByRole('menuitem', { name: /^main/ }))
    expect(updatePreferences).toHaveBeenCalledWith({ startFrom: { other: 'local' } })
  })

  test('a project whose start line does not pass the branch on has no "start from" chip, and a saved local pick names no branch', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true })
    start.mockResolvedValue({ agentId: 'r1' })
    prefs.current = { startFrom: { p1: 'local' } }
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(onCommands).toHaveBeenCalled())
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', {}))
    expect(startFromChip()).toBeNull()
    expect(startsAt()).toBe('gemstack')
  })

  test("another computer's project has its computer picked, and on it the run starts as on a project here: that computer's branches and start line, and its own check", async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    machine.current = { id: 'laptop', url: 'http://127.0.0.1:4210', label: 'MacBook' }
    start.mockResolvedValue({ agentId: 'r5' })
    prefs.current = { startFrom: { p1: 'local' } }
    render(<StartAgentForm {...props} projectName="shop" home="laptop" />)
    expect(followProjectHome).toHaveBeenCalledWith('laptop')
    await waitFor(() => expect(startFromChip()).not.toBeNull())
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { base: 'my/work', machine: 'laptop' }))
    // Its own check is that computer's, asked as of a machine: never this one's.
    await waitFor(() => expect(onMachineStartCheck).toHaveBeenCalledWith('p1', 'laptop', undefined))
    expect(onStartCheck).not.toHaveBeenCalled()
  })

  test("another computer's project started on this one is cloned here first: no branch of that computer, and no check of a copy that is not here yet", async () => {
    onCommands.mockResolvedValue({ ...WITH_BRANCHES, startHook: false })
    start.mockResolvedValue({ agentId: 'r6', projectId: 'shop-here' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} projectName="shop" home="laptop" onAgentStarted={onAgentStarted} />)
    await waitFor(() => expect(onCommands).toHaveBeenCalled())
    expect(startFromChip()).toBeNull()
    // The copy cloned here gets its start line as it is added.
    expect(screen.queryByText(/no start hook/)).toBeNull()
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', {}))
    expect(onStartCheck).not.toHaveBeenCalled()
    // The run is in that copy, which the page goes to.
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r6', undefined, 'shop-here'))
  })

  test("before another computer's project is cloned here, this computer says what its clone and the run would hit; a start that hit it says nothing more", async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    const unread = 'This computer has no login that can read github.com/acme/shop, or there is no such repository: a private one needs a login.'
    onCloneCheck.mockResolvedValue({ problems: [unread], warnings: [] })
    startSays.error = 'shop could not be cloned here.'
    prefs.current = { driver: 'codex' }
    render(<StartAgentForm {...props} projectName="shop" home="laptop" />)
    // Asked by the repository's address, with the agent picked: the project is not here to run its own check in.
    await waitFor(() => expect(onCloneCheck).toHaveBeenCalledWith('github.com/acme/shop', 'codex'))
    expect(onStartCheck).not.toHaveBeenCalled()
    await screen.findByText(/no login that can read github.com\/acme\/shop/)
    expect(screen.queryByText('shop could not be cloned here.')).toBeNull()
  })

  test('with a machine picked there is no "start from" chip, and the Start names no branch of this machine', async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    machine.current = { id: 'd1', url: 'http://box:4200', label: 'box' }
    start.mockResolvedValue({ agentId: 'r2' })
    prefs.current = { startFrom: { p1: 'local' } }
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(onCommands).toHaveBeenCalled())
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { machine: 'd1' }))
    expect(startFromChip()).toBeNull()
  })

  test('the "start from" chip waits for the project\'s name and for the saved pick, so it never moves and its words never flip', async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    prefs.current = { startFrom: { p1: 'local' } }
    prefsLoaded.current = false
    const { rerender } = render(<StartAgentForm {...props} />)
    await waitFor(() => expect(onCommands).toHaveBeenCalled())
    // The launcher has answered, the name has not: no chip yet, the name's chip would push it.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(startsAt()).toBe('')
    rerender(<StartAgentForm {...props} projectName="gemstack" />)
    // The saved pick is not read yet: no chip that would read "main" and then flip.
    expect(startsAt()).toBe('gemstack')
    prefsLoaded.current = true
    rerender(<StartAgentForm {...props} projectName="gemstack" />)
    expect(startsAt()).toBe('gemstackmy/work (local)')
  })

  test('the picked Context rides the prompt as one line at its end, after the command\'s own words', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} context={new Set(['/repos/other', 'src/app.ts'])} />)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing\n\nContext: /repos/other, src/app.ts', {}))
  })
})
