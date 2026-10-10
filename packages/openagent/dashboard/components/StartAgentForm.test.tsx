import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { openMenu } from '../test-utils.js'

// Everything the form reads goes through a lib module, so the mocks stop at the `rpc/` stubs: an
// unmocked one reaches for `/_rpc/<name>`, and there is no daemon behind jsdom to answer.
const onCommands = vi.hoisted(() => vi.fn())
const onStartCheck = vi.hoisted(() => vi.fn())
const onProjects = vi.hoisted(() => vi.fn(async () => [] as unknown[]))
vi.mock('../rpc/projects.js', () => ({ onCommands, onStartCheck, onProjects }))

// Mutable so a test can pick the coding agent and the model; reset after each.
const prefs = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const updatePreferences = vi.hoisted(() => vi.fn())
// Whether the saved preferences have been read: a test turns it off to see what waits for them.
const prefsLoaded = vi.hoisted(() => ({ current: true }))
vi.mock('../lib/preferences.js', () => ({ usePreferences: () => prefs.current, usePreferencesLoaded: () => prefsLoaded.current, updatePreferences }))
const machine = vi.hoisted(() => ({ current: null as null | { id: string; url: string; label: string } }))
vi.mock('../lib/machines.js', () => ({ useMachines: () => (machine.current ? [machine.current] : []) }))
vi.mock('../lib/remote-target.js', () => ({ useSelectedMachineId: () => machine.current?.id ?? null }))

const start = vi.hoisted(() => vi.fn())
vi.mock('../lib/use-start-agent.js', async () => ({
  ...(await vi.importActual<typeof import('../lib/use-start-agent.js')>('../lib/use-start-agent.js')),
  useStartAgent: () => ({ busy: false, error: null, reset: vi.fn(), start }),
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
        <div data-testid="above">{props.aboveControls}</div>
        <div data-testid="below">{props.belowControls}</div>
        <button type="button" disabled={!props.canSubmit} onClick={() => props.onSubmit('do the thing')}>
          submit-typed
        </button>
      </>
    )
  })
  return { Composer }
})

const { StartAgentForm } = await import('./StartAgentForm.js')

// No check hook unless a test gives one: nothing to say.
beforeEach(() => {
  onStartCheck.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  start.mockReset()
  onCommands.mockReset()
  onStartCheck.mockReset()
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
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r1', undefined))
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

  test('under the box: the Context picker, then the "Auto" menu', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true })
    render(<StartAgentForm {...props} />)
    const below = screen.getByTestId('below')
    await waitFor(() => expect(below.contains(autoMenu())).toBe(true))
    const context = within(below).getAllByRole('button')[0]!
    expect(context).not.toBe(autoMenu())
    expect(context.compareDocumentPosition(autoMenu()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('the publish options: the button reads Commit until the person picks, and the Start carries no pick, left to the daemon; a saved pick is shown and carried, Nothing too; a change writes the saved setting', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    expect(autoMenu().textContent).toBe('Auto: Commit')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', {}))

    await openMenu(autoMenu())
    expect(publishOptions()).toEqual(['Nothing', 'Commit', 'Publish branch', 'Open PR', 'Merge on green'])
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
    expect(autoMenu().textContent).toBe('Auto: Nothing')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { publish: 'nothing' }))
  })

  test('a project with no git host package is offered Nothing, Commit and Publish branch only, and a saved pull request pick reads as the branch, which is where the daemon holds it', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: false })
    prefs.current = { publish: 'merge' }
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(autoMenu().textContent).toBe('Auto: Publish branch'))
    await openMenu(autoMenu())
    expect(publishOptions()).toEqual(['Nothing', 'Commit', 'Publish branch'])
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { publish: 'merge' }))
  })

  test('a project with no remote is offered Nothing and Commit; its button reads Commit until the person picks, and with a saved publish pick too', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: false, remote: false })
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(autoMenu().textContent).toBe('Auto: Commit'))
    await openMenu(autoMenu())
    expect(publishOptions()).toEqual(['Nothing', 'Commit'])
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
    expect(publishOptions()).toEqual(['Nothing', 'Commit'])
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
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r2', 'box'))
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
    expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r3', undefined)
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
    expect(problem!.className).toContain('text-danger')
    expect(warning!.className).toContain('text-warning')
    expect((screen.getByText('submit-typed') as HTMLButtonElement).disabled).toBe(false)
  })

  test('the chip above the box reads the project\'s name, and is a plain chip, not a button', () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    render(<StartAgentForm {...props} projectName="gemstack" />)
    const above = screen.getByTestId('above')
    expect(above.textContent).toBe('gemstack')
    expect(above.querySelector('svg')).not.toBeNull()
    expect(above.querySelector('button')).toBeNull()
    // Cut short with an ellipsis where the row is too narrow for it.
    expect(screen.getByText('gemstack').className).toContain('truncate')
    // No heading over the chips: the page is laid out as an agent's chat, whose box has none.
    expect(screen.queryByText('Start an agent')).toBeNull()
  })

  test('until the project\'s name is known there is no project chip, and the row of chips is asked for all the same', () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    const { rerender } = render(<StartAgentForm {...props} />)
    expect(screen.getByTestId('above').textContent).toBe('')
    expect(composerProps.current.aboveControls).toBeNull()
    rerender(<StartAgentForm {...props} projectName="gemstack" />)
    expect(screen.getByTestId('above').textContent).toBe('gemstack')
  })

  test('the "start from" chip is after the project\'s chip and reads the main branch until the person picks; then the Start names no branch', async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(startFromChip()).not.toBeNull())
    expect(screen.getByTestId('above').textContent).toBe('gemstackmain')
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
    expect(screen.getByTestId('above').textContent).toBe('gemstack')
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
    expect(screen.getByTestId('above').textContent).toBe('')
    rerender(<StartAgentForm {...props} projectName="gemstack" />)
    // The saved pick is not read yet: no chip that would read "main" and then flip.
    expect(screen.getByTestId('above').textContent).toBe('gemstack')
    prefsLoaded.current = true
    rerender(<StartAgentForm {...props} projectName="gemstack" />)
    expect(screen.getByTestId('above').textContent).toBe('gemstackmy/work (local)')
  })

  test('the picked Context rides the prompt as one line at its end, after the command\'s own words', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} context={new Set(['/repos/other', 'src/app.ts'])} />)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing\n\nContext: /repos/other, src/app.ts', {}))
  })
})
