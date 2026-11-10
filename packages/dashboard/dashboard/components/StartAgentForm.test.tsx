import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import { openMenu } from '../test-utils.js'
import { takePendingDraft } from '../lib/draft-handoff.js'

// Everything the form reads goes through a lib module, so the mocks stop at the `rpc/` stubs: an
// unmocked one reaches for `/_rpc/<name>`, and there is no daemon behind jsdom to answer.
const onCommands = vi.hoisted(() => vi.fn())
const onStartCheck = vi.hoisted(() => vi.fn())
const onCloneCheck = vi.hoisted(() => vi.fn())
const onProjects = vi.hoisted(() => vi.fn(async () => [] as unknown[]))
const onStartBranches = vi.hoisted(() => vi.fn(async () => ({ branches: ['feature-x'] }) as { branches?: string[] }))
const onRepos = vi.hoisted(() => vi.fn(async () => ({ repos: [] as { path: string; name: string; url?: string }[], canAddFolder: false })))
vi.mock('../rpc/projects.js', () => ({ onCommands, onStartBranches, onStartCheck, onCloneCheck, onProjects, onRepos, sendAddRepoFolder: vi.fn() }))

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
// The agents as read, and the menu as a press that picks the second one.
const agentsList = vi.hoisted(() => ({ agents: [{ id: 'default', name: 'Default', skills: ['ask', 'github'], accounts: {}, projectSkills: true }, { id: 'reviewer', name: 'Reviewer', skills: ['ask'], accounts: { github: 'octo-agent' }, projectSkills: false }] }))
vi.mock('./AgentsPage.js', () => ({ useAgentsList: () => ({ view: agentsList, reload: async () => {} }) }))
vi.mock('./AgentMenu.js', () => ({
  AgentMenu: ({ picked, onPick }: { picked: string | undefined; onPick: (id: string) => void }) => (
    <button type="button" onClick={() => onPick('reviewer')}>{`agent:${picked ?? ''}`}</button>
  ),
}))
// The skills this session gets: a press that picks some, and what it was given.
vi.mock('./SkillsMenu.js', () => ({
  agentPicks: (agent: { projectSkills: boolean } | undefined) => (agent?.projectSkills === false ? { on: [], off: [], project: 'none' } : { on: [], off: [] }),
  SkillsMenu: ({ projectId, picks, onChange }: { projectId: string | undefined; picks: { on: string[]; off: string[]; project?: 'none' | string[] }; onChange: (picks: { on: string[]; off: string[]; project?: 'none' | string[] }) => void }) => (
    <button type="button" onClick={() => onChange({ on: ['review'], off: ['github'], project: 'none' })}>{`skills:${projectId ?? 'no project'}:${picks.on.join('+')}/${picks.off.join('+')}/${picks.project === undefined ? 'all' : picks.project === 'none' ? 'none' : picks.project.join('+')}`}</button>
  ),
}))
// The computer's account, and a press that picks another for this session.
const runsAccount = vi.hoisted(() => ({ login: undefined as string | undefined }))
vi.mock('./GitHosts.js', () => ({
  GitAccountMenu: ({ onPick }: { onPick: (login: string) => void }) => <button type="button" onClick={() => onPick('octo-agent')}>pick-octo-agent</button>,
  useSessionAccount: (_address: string | undefined, _machineId: string | undefined, picked: string | undefined) => picked ?? runsAccount.login,
}))
const serverLogins = vi.hoisted(() => ({ onServerLogins: vi.fn(), sendUseLoginsOn: vi.fn(), sendAllowLogins: vi.fn(), sendSettleLogin: vi.fn() }))
vi.mock('../rpc/server-logins.js', () => serverLogins)
const openSettings = vi.hoisted(() => vi.fn())
const openPermissions = vi.hoisted(() => vi.fn())
vi.mock('../lib/use-route.js', async () => ({ ...(await vi.importActual<typeof import('../lib/use-route.js')>('../lib/use-route.js')), openSettings, openPermissions }))

const start = vi.hoisted(() => vi.fn())
// What the start says of itself beside its answer: that the machine is cloning the project, or why there is no run.
const startReset = vi.hoisted(() => vi.fn())
const startSays = vi.hoisted(() => ({ cloning: false, error: null as string | null }))
vi.mock('../lib/use-start-agent.js', async () => ({
  ...(await vi.importActual<typeof import('../lib/use-start-agent.js')>('../lib/use-start-agent.js')),
  useStartAgent: () => ({ busy: false, cloning: startSays.cloning, error: startSays.error, reset: startReset, start }),
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
        <div data-testid="controls-end">{props.controlsEnd}</div>
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
  runsAccount.login = undefined
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

/** The launcher's "Auto" menu button; its text says the publish pick. */
const autoMenu = () => screen.getByRole('button', { name: 'Auto' })
/** The labels of the publish options the open "Auto" menu lists. */
const publishOptions = () => screen.getAllByRole('menuitem').map(item => item.querySelector('span > span')!.textContent)
/** The launcher's "start from" chip, when there is one. */
const LOCAL = { kind: 'local' } as const
const startFromChip = () => screen.queryByRole('combobox', { name: 'The agent starts from' })
/** A project whose start line passes the branch on, whose folder is on `my/work`. */
const WITH_BRANCHES = { commands: [], startHook: true, gitHost: true, remote: true, address: 'github.com/acme/shop', startFrom: { main: 'main', local: 'my/work' } }
const props = { projectId: 'p1', files: [], context: new Set<string>(), addContext: noop, removeContext: noop, toggleContext: noop, projects: [], onPickProject: noop, onProjectAdded: noop }

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
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r1', undefined, undefined, expect.anything()))
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

  test('under the box, at the left: the agent, then Skills, then the Context picker; at the right, before the model: the account, then the "Auto" menu', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true })
    render(<StartAgentForm {...props} />)
    const below = screen.getByTestId('controls')
    const end = screen.getByTestId('controls-end')
    await waitFor(() => expect(end.contains(autoMenu())).toBe(true))
    expect(within(below).getAllByRole('button').map(button => button.textContent)).toEqual(['agent:default', 'skills:p1://all', 'Context'])
    expect(within(end).getAllByRole('button').map(button => button.textContent)).toEqual(['pick-octo-agent', 'Auto: Commit'])
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

  describe('where the pull request goes', () => {
    const TARGETS = { ...WITH_BRANCHES, prBase: true }
    const FEATURE = { kind: 'published', branch: 'feature-x' } as const
    const sent = async () => {
      start.mockResolvedValue({ agentId: 'r1' })
      fireEvent.click(screen.getByText('submit-typed'))
      await waitFor(() => expect(start).toHaveBeenCalled())
      return start.mock.lastCall![2] as { prBase?: string; base?: string }
    }

    test('a picked branch on origin at Open PR: the button names it, it goes with the Start, and picking main sends none and reads so', async () => {
      onCommands.mockResolvedValue(TARGETS)
      prefs.current = { publish: 'pr', startFrom: { p1: FEATURE } }
      render(<StartAgentForm {...props} projectName="gemstack" />)
      await waitFor(() => expect(autoMenu().textContent).toBe('Auto: Open PR → feature-x'))
      expect((await sent()).prBase).toBe('feature-x')
      start.mockClear()
      await openMenu(autoMenu())
      fireEvent.click(screen.getByRole('menuitem', { name: 'main' }))
      await waitFor(() => expect(autoMenu().textContent).toBe('Auto: Open PR → main'))
      expect((await sent()).prBase).toBeUndefined()
    })

    test('the main branch picked to start from: no target', async () => {
      onCommands.mockResolvedValue(TARGETS)
      prefs.current = { publish: 'merge' }
      render(<StartAgentForm {...props} projectName="gemstack" />)
      await waitFor(() => expect(startFromChip()).not.toBeNull())
      expect(autoMenu().textContent).toBe('Auto: Merge on green')
    })

    test('a start line that does not pass it on: no target', async () => {
      onCommands.mockResolvedValue({ ...WITH_BRANCHES, prBase: false })
      prefs.current = { publish: 'pr', startFrom: { p1: FEATURE } }
      render(<StartAgentForm {...props} projectName="gemstack" />)
      await waitFor(() => expect(startFromChip()).not.toBeNull())
      expect(autoMenu().textContent).toBe('Auto: Open PR')
      expect((await sent()).prBase).toBeUndefined()
    })

    test('My local branch: a target once origin is read to have it; not on origin, none and the pull request goes to main', async () => {
      onCommands.mockResolvedValue(TARGETS)
      onStartBranches.mockResolvedValueOnce({ branches: ['my/work'] })
      prefs.current = { publish: 'pr', startFrom: { p1: LOCAL } }
      render(<StartAgentForm {...props} projectName="gemstack" />)
      await waitFor(() => expect(autoMenu().textContent).toBe('Auto: Open PR → my/work'))
      cleanup()
      onStartBranches.mockResolvedValueOnce({ branches: ['feature-x'] })
      render(<StartAgentForm {...props} projectName="gemstack" />)
      await waitFor(() => expect(onStartBranches).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(startFromChip()).not.toBeNull())
      expect(autoMenu().textContent).toBe('Auto: Open PR')
      expect((await sent()).prBase).toBeUndefined()
    })

    test('at Commit the section is not offered, and the branch still goes with the Start, for a later Open PR', async () => {
      onCommands.mockResolvedValue(TARGETS)
      prefs.current = { publish: 'commit', startFrom: { p1: FEATURE } }
      render(<StartAgentForm {...props} projectName="gemstack" />)
      await waitFor(() => expect(startFromChip()).not.toBeNull())
      expect(autoMenu().textContent).toBe('Auto: Commit')
      expect((await sent()).prBase).toBe('feature-x')
    })
  })

  test('what this page says goes with the Start, for the run\'s page until its record says it: the branch, the account, the level, the target, the model', async () => {
    onCommands.mockResolvedValue({ ...WITH_BRANCHES, prBase: true })
    runsAccount.login = 'octo'
    prefs.current = { publish: 'pr', driver: 'codex', model: 'gpt-5', effort: 'high', startFrom: { p1: { kind: 'published', branch: 'feature-x' } } }
    start.mockResolvedValue({ agentId: 'r1' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} projectName="gemstack" onAgentStarted={onAgentStarted} />)
    await waitFor(() => expect(autoMenu().textContent).toBe('Auto: Open PR → feature-x'))
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalled())
    expect(onAgentStarted.mock.lastCall![4]).toEqual({ branch: 'feature-x', gitAccount: 'octo', publish: 'pr', prBase: 'feature-x', driver: 'codex', model: 'gpt-5', effort: 'high' })
    expect((start.mock.lastCall![2] as { account?: string }).account).toBe('octo')
    runsAccount.login = undefined
  })

  test('the agent picked goes with the Start and to the run\'s page, and its GitHub account is the session\'s until another is picked; the default agent sends none', async () => {
    onCommands.mockResolvedValue({ ...WITH_BRANCHES, prBase: true })
    runsAccount.login = 'octo'
    start.mockResolvedValue({ agentId: 'r1' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} projectName="gemstack" onAgentStarted={onAgentStarted} />)
    expect((await screen.findByText('agent:default')).textContent).toBe('agent:default')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalled())
    expect((start.mock.lastCall![2] as { agent?: string; account?: string }).agent).toBeUndefined()
    expect((start.mock.lastCall![2] as { account?: string }).account).toBe('octo')
    // The reviewer picked: the pick is saved, and with it the session goes as its account.
    fireEvent.click(screen.getByText('agent:default'))
    expect(updatePreferences).toHaveBeenCalledWith({ agent: 'reviewer' })
    prefs.current = { ...prefs.current, agent: 'reviewer' }
    cleanup()
    render(<StartAgentForm {...props} projectName="gemstack" onAgentStarted={onAgentStarted} />)
    await screen.findByText('agent:reviewer')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2))
    expect((start.mock.lastCall![2] as { agent?: string; account?: string })).toMatchObject({ agent: 'reviewer', account: 'octo-agent' })
    expect((onAgentStarted.mock.lastCall![4] as { agent?: string; gitAccount?: string })).toMatchObject({ agent: 'reviewer', gitAccount: 'octo-agent' })
    runsAccount.login = undefined
  })

  test('the git host account picked for this session goes with the Start, and to the run\'s page; the computer\'s pick is sent when none is made', async () => {
    onCommands.mockResolvedValue({ ...WITH_BRANCHES, prBase: true })
    runsAccount.login = 'octo'
    start.mockResolvedValue({ agentId: 'r1' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} projectName="gemstack" onAgentStarted={onAgentStarted} />)
    fireEvent.click(await screen.findByText('pick-octo-agent'))
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalled())
    expect((start.mock.lastCall![2] as { account?: string }).account).toBe('octo-agent')
    expect((onAgentStarted.mock.lastCall![4] as { gitAccount?: string }).gitAccount).toBe('octo-agent')
    runsAccount.login = undefined
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
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r2', 'box', undefined, expect.anything()))
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
    expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r3', undefined, undefined, expect.anything())
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

  test('the skills picked for this session go with the Start and to the run\'s page; none picked, nothing is sent; the next session starts from none again', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true, address: 'github.com/acme/shop' })
    start.mockResolvedValue({ agentId: 'r1' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} projectName="gemstack" onAgentStarted={onAgentStarted} />)
    fireEvent.click(await screen.findByText('skills:p1://all'))
    expect(screen.getByText('skills:p1:review/github/none')).toBeTruthy()
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalled())
    expect(start.mock.lastCall![2]).toMatchObject({ skillsOn: ['review'], skillsOff: ['github'], projectSkills: 'none' })
    expect(onAgentStarted.mock.lastCall![4]).toMatchObject({ skillsOn: ['review'], skillsOff: ['github'], projectSkills: 'none' })
    expect(screen.getByText('skills:p1://all')).toBeTruthy()
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2))
    const sent = start.mock.lastCall![2] as Record<string, unknown>
    expect('skillsOn' in sent || 'skillsOff' in sent || 'projectSkills' in sent).toBe(false)
  })

  test('on an agent set to never pick up project skills, the session starts from none and the Start says so; the next session starts from none again', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true, address: 'github.com/acme/shop' })
    start.mockResolvedValue({ agentId: 'r1' })
    prefs.current = { ...prefs.current, agent: 'reviewer' }
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await screen.findByText('agent:reviewer')
    expect(await screen.findByText('skills:p1://none')).toBeTruthy()
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(start.mock.lastCall![2]).toMatchObject({ agent: 'reviewer', projectSkills: 'none' })
    expect(screen.getByText('skills:p1://none')).toBeTruthy()
  })

  test('a machine that takes no logins of this computer\'s sends the person to the Permissions page', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true, address: 'github.com/acme/shop' })
    machine.current = { id: 'd2', url: 'https://box/_devices/via/2', label: 'Dani\'s PC' }
    const line = '`codex` is not logged in. Run `codex login`, then start again.'
    prefs.current = { driver: 'codex' }
    onMachineStartCheck.mockResolvedValue({ problems: [line], warnings: [], fix: { kind: 'log-in', command: 'codex login', problem: line } })
    render(<StartAgentForm {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Accounts' }))
    expect(screen.getByRole('alert').textContent).toContain('Codex is not logged in on Dani\'s PC.')
    expect(onMachineStartCheck).toHaveBeenCalledWith('p1', 'd2', 'codex')
    expect(openPermissions).toHaveBeenCalled()
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

  test('the row above the box starts with where the session works: the project\'s name, on the button of the picker', () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    render(<StartAgentForm {...props} projectName="gemstack" />)
    expect(startsAt()).toBe('gemstack')
    const picker = screen.getByRole('combobox', { name: 'The session works in' })
    expect(picker.textContent).toBe('gemstack')
    expect(picker.querySelector('svg')).not.toBeNull()
    // Cut short with an ellipsis where the row is too narrow for it.
    expect(screen.getByText('gemstack').className).toContain('truncate')
    // No heading over the box: the page is laid out as an agent's chat, whose box has none.
    expect(screen.queryByText('Start an agent')).toBeNull()
  })

  test('until the project\'s name is known there is no project word, and the row is asked for all the same', () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    const { rerender } = render(<StartAgentForm {...props} />)
    expect(startsAt()).toBe('')
    expect(screen.queryByRole('combobox', { name: 'The session works in' })).toBeNull()
    rerender(<StartAgentForm {...props} projectName="gemstack" />)
    expect(startsAt()).toBe('gemstack')
  })

  test('another project picked takes the typed prompt along to its page', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    const onPickProject = vi.fn()
    const alpha = { id: 'alpha-1', path: '/home/me/alpha', name: 'alpha', activated: true, gitHost: true }
    render(<StartAgentForm {...props} projectId="session" projects={[alpha]} onPickProject={onPickProject} />)
    ;(composerProps.current.onPromptChange as (value: string) => void)('fix the login page')
    await openMenu(screen.getByRole('combobox', { name: 'The session works in' }))
    fireEvent.click(await screen.findByRole('option', { name: 'alpha' }))
    expect(onPickProject).toHaveBeenCalledWith('alpha-1')
    expect(takePendingDraft()).toBe('fix the login page')
  })

  test('with no project, "Add repo" adds repos as chips, a project\'s or one that is none, and the Start sends their folders; nothing is made a project', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    onRepos.mockResolvedValue({ repos: [{ path: '/home/me/oss/vike', name: 'vike', url: 'https://github.com/vikejs/vike.git' }], canAddFolder: false })
    start.mockResolvedValue({ agentId: 'r1' })
    const onAgentStarted = vi.fn()
    const onPickProject = vi.fn()
    const alpha = { id: 'alpha-1', path: '/home/me/alpha', name: 'alpha', activated: true, gitHost: true }
    render(<StartAgentForm {...props} projectId="session" projects={[alpha]} onPickProject={onPickProject} onAgentStarted={onAgentStarted} />)
    const addRepo = () => screen.getByRole('combobox', { name: 'Add repo' })
    await openMenu(addRepo())
    fireEvent.click(await screen.findByRole('option', { name: /vike/ }))
    await openMenu(addRepo())
    fireEvent.click(await screen.findByRole('option', { name: /alpha/ }))
    expect(startsAt()).toBe('No projectvikealphaAdd repo')
    // A repo picked once is not offered again.
    await openMenu(addRepo())
    await waitFor(() => expect(screen.queryAllByRole('option')).toEqual([]))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onPickProject).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove alpha' }))
    expect(startsAt()).toBe('No projectvikeAdd repo')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('session', 'do the thing', { repos: ['/home/me/oss/vike'] }))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r1', undefined, undefined, { repos: [{ name: 'vike', from: '/home/me/oss/vike' }] }))
    // Started: the next session starts with none.
    expect(startsAt()).toBe('No projectAdd repo')
  })

  test('a project has no "Add repo", and its Start sends no repos', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true })
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} projectName="gemstack" />)
    expect(screen.queryByRole('combobox', { name: 'Add repo' })).toBeNull()
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(start.mock.calls[0]![2]).not.toHaveProperty('repos')
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
    prefs.current = { startFrom: { other: LOCAL } }
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(startFromChip()).not.toBeNull())
    // Another project's pick is not this one's.
    expect(startFromChip()!.textContent).toBe('main')
    await openMenu(startFromChip()!)
    fireEvent.click(screen.getByRole('option', { name: /^My local branch my\/work/ }))
    expect(updatePreferences).toHaveBeenCalledWith({ startFrom: { other: LOCAL, p1: LOCAL } })

    cleanup()
    updatePreferences.mockClear()
    prefs.current = { startFrom: { other: LOCAL, p1: LOCAL } }
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(startFromChip()).not.toBeNull())
    expect(startFromChip()!.textContent).toBe('my/work (local)')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { base: 'my/work' }))
    await openMenu(startFromChip()!)
    fireEvent.click(screen.getByRole('option', { name: /^main/ }))
    expect(updatePreferences).toHaveBeenCalledWith({ startFrom: { other: LOCAL } })
  })

  test('a published pick is saved for this project, read on the chip by its name, and the Start names origin\'s copy of it', async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(startFromChip()).not.toBeNull())
    await openMenu(startFromChip()!)
    fireEvent.click(await screen.findByRole('option', { name: 'feature-x' }))
    expect(updatePreferences).toHaveBeenCalledWith({ startFrom: { p1: { kind: 'published', branch: 'feature-x' } } })

    cleanup()
    prefs.current = { startFrom: { p1: { kind: 'published', branch: 'feature-x' } } }
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(startFromChip()).not.toBeNull())
    expect(startFromChip()!.textContent).toBe('feature-x')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { base: 'refs/remotes/origin/feature-x' }))
    // The waiting commands are read for that pick.
    expect(onCommands).toHaveBeenCalledWith('p1', { kind: 'published', branch: 'feature-x' })
  })

  test('picking another branch drops the red line a Start left about the last one', async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    startReset.mockClear()
    startSays.error = 'The branch gone is no longer on origin. Pick another branch to start from.'
    prefs.current = { startFrom: { p1: { kind: 'published', branch: 'gone' } } }
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(startFromChip()).not.toBeNull())
    await openMenu(startFromChip()!)
    expect(startReset).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: /^main/ }))
    expect(startReset).toHaveBeenCalledTimes(1)
    startSays.error = null
  })

  test('a project whose start line does not pass the branch on has no "start from" chip, and a saved local pick names no branch', async () => {
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true })
    start.mockResolvedValue({ agentId: 'r1' })
    prefs.current = { startFrom: { p1: LOCAL } }
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
    prefs.current = { startFrom: { p1: LOCAL } }
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
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r6', undefined, 'shop-here', expect.anything()))
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
    prefs.current = { startFrom: { p1: LOCAL } }
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(onCommands).toHaveBeenCalled())
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { machine: 'd1' }))
    expect(startFromChip()).toBeNull()
  })

  test('the "start from" chip waits for the project\'s name and for the saved pick, so it never moves and its words never flip', async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    prefs.current = { startFrom: { p1: LOCAL } }
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
