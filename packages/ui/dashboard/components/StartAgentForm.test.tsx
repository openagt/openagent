import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render as renderPage, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { forgetRemembered } from '../lib/use-async.js'
import { MARKDOWN_RENDER, openMenu } from '../test-utils.js'
import { ModulesContext, mountedOf, type MountedOption } from '../lib/use-modules.js'
import { keepDraft, keepDraftImages, keptDraft, keptDraftImages, takePendingDraft } from '../lib/draft-handoff.js'
import { resetRunHostsForTest, selectHost } from '../lib/run-hosts.js'

// Everything the form reads goes through a lib module, so the mocks stop at the `rpc/` stubs: an
// unmocked one reaches for `/_rpc/<name>`, and there is no daemon behind jsdom to answer.
const onCommands = vi.hoisted(() => vi.fn())
const onStartCheck = vi.hoisted(() => vi.fn())

const onProjects = vi.hoisted(() => vi.fn(async () => [] as unknown[]))
const onRepos = vi.hoisted(() => vi.fn(async () => ({ repos: [] as { path: string; name: string; url?: string }[], canAddFolder: false })))
// The hosts beside this computer the project's modules bring: none unless a test says.
const onRunHosts = vi.hoisted(() => vi.fn(async () => [] as { id: string; label: string }[]))
vi.mock('../rpc/projects.js', () => ({ onCommands, onStartCheck, onProjects, onRepos, onRunHosts, sendAddRepoFolder: vi.fn() }))

// Mutable so a test can pick the coding agent and the model; reset after each.
const prefs = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const updatePreferences = vi.hoisted(() => vi.fn())
// Whether the saved preferences have been read: a test turns it off to see what waits for them.
const prefsLoaded = vi.hoisted(() => ({ current: true }))
vi.mock('../lib/preferences.js', () => ({ usePreferences: () => prefs.current, usePreferencesLoaded: () => prefsLoaded.current, updatePreferences }))

const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendGitHostInstall: vi.fn(), sendGitHostLogin: vi.fn(), sendUseGitHostAccount: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
// What the modules say needs the person: nothing unless a test says.
const onAttention = vi.hoisted(() => vi.fn(async (_projectId: string | null, _options?: object) => ({ items: [] as object[], whole: true })))
vi.mock('../rpc/attention.js', () => ({ onAttention }))

// The computer's account, and a press that picks another for this session.
const runsAccount = vi.hoisted(() => ({ login: undefined as string | undefined }))
vi.mock('./GitHosts.js', () => ({
  // The account's line of the gear's menu, for a project with a remote and for a session with no project (`anyHost`): a press that picks another; what the hover says of it; and its dialog.
  useGitAccountSetup: (address: string | undefined, picked: string | undefined, onPick: (login: string) => void, anyHost = false) => {
    const account = picked ?? runsAccount.login
    const at = address !== undefined || anyHost
    return {
      line: at ? <button type="button" onClick={() => onPick('octo-agent')}>pick-octo-agent</button> : null,
      said: !at ? undefined : account !== undefined ? `@${account}` : 'no GitHub account',
      missing: at && account === undefined,
      dialog: <div data-testid="account-dialog" />,
    }
  },
  useSessionAccount: (_address: string | undefined, picked: string | undefined) => picked ?? runsAccount.login,
}))

const openSettings = vi.hoisted(() => vi.fn())
const openPage = vi.hoisted(() => vi.fn())
vi.mock('../lib/host-services.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/host-services.js')>()
  return { ...actual, INERT_HOST_SERVICES: { ...actual.INERT_HOST_SERVICES, openSettings, openPage } }
})

const start = vi.hoisted(() => vi.fn())
/** An image the box holds, by the name the dashboard kept it under. */
const SHOT = vi.hoisted(() => `${'a'.repeat(64)}.png`)
// What the start says of itself beside its answer: why there is no run.
const startReset = vi.hoisted(() => vi.fn())
const startSays = vi.hoisted(() => ({ error: null as string | null }))
vi.mock('../lib/use-start-agent.js', async () => ({
  ...(await vi.importActual<typeof import('../lib/use-start-agent.js')>('../lib/use-start-agent.js')),
  useStartAgent: () => ({ busy: false, error: startSays.error, reset: startReset, start }),
}))

// The Composer is exercised by its own tests; here it hands back a typed submit, shows whether
// the form lets it submit at all, and renders the launcher's controls: the gear's lines in a menu
// that stands open, as the gear's does once pressed, and what its hover says beside it.
const composerProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const composerFocus = vi.hoisted(() => vi.fn())
const composerClear = vi.hoisted(() => vi.fn())
vi.mock('./Composer.js', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } = await import('./ui/dropdown-menu.js')
  const Composer = forwardRef((props: any, ref: any) => {
    composerProps.current = props
    useImperativeHandle(ref, () => ({
      clear: composerClear,
      focus: composerFocus,
    }))
    return (
      <>
        <div data-testid="starts-at">{props.startsAt}</div>
        <div data-testid="controls">{props.controls}</div>
        {props.setup && (
          <DropdownMenu open>
            <DropdownMenuTrigger data-warn={props.setup.warn === true}>gear</DropdownMenuTrigger>
            <DropdownMenuContent aria-label="This session">{props.setup.lines}</DropdownMenuContent>
          </DropdownMenu>
        )}
        <div data-testid="said">{props.setup?.said}</div>
        <div data-testid="notes">{props.notes}</div>
        <button type="button" onClick={() => props.onSubmit('do the thing', { later: false, images: [] })}>
          submit-typed
        </button>
        <button type="button" onClick={() => props.onSubmit('what does it say?', { later: false, images: [SHOT] })}>
          submit-image
        </button>
      </>
    )
  })
  return { Composer }
})

/** What a module's control under the box picks for the next run, as a person's pick there would. */
const pickOptions = (options: object) => act(() => (composerProps.current.controlBox as { onChange: (options: object) => void }).onChange(options))
/** Codex and its model, as agent-driver's control picks them. */
const ON_CODEX = { 'agent-driver': { driver: 'codex', model: 'gpt-5' } }

/** Where the agent starts, as the row above the box says it. */
const startsAt = (): string => screen.getByTestId('starts-at').textContent ?? ''

const { StartAgentForm } = await import('./StartAgentForm.js')

// No check hook unless a test gives one: nothing to say.
beforeEach(() => {
  onStartCheck.mockResolvedValue(null)

})

afterEach(() => {
  runsAccount.login = undefined
  cleanup()
  forgetRemembered()
  start.mockReset()
  composerFocus.mockReset()
  composerClear.mockReset()

  startSays.error = null
  onCommands.mockReset()
  onStartCheck.mockReset()

  openSettings.mockReset()

  updatePreferences.mockReset()
  prefs.current = {}
  prefsLoaded.current = true

  onRunHosts.mockReset()
  onRunHosts.mockResolvedValue([])
  onAttention.mockResolvedValue({ items: [], whole: true })
  resetRunHostsForTest()
})

const COMMANDS = [{ name: 'work-queue', description: 'Work the agent queue' }]
const noop = () => {}

/** The gear's menu, open. */
const gearMenu = () => screen.getByRole('menu', { name: 'This session' })
/** The gear's "When it finishes" line (the Auto level); its text says the publish pick. */
const autoMenu = () => {
  const line = screen.queryAllByRole('menuitem').find(item => item.textContent?.startsWith('When it finishes: '))
  if (!line) throw new Error('the gear has no "When it finishes" line')
  return line
}
/** What the gear's hover says with its menu shut. */
const gearSaid = (): string => screen.getByTestId('said').textContent ?? ''
/** The labels of the publish options the open "When it finishes" list has. */
const publishOptions = () => screen.getAllByRole('menuitemradio').map(item => item.querySelector('span > span')!.textContent)
/** A project with a remote on GitHub. */
const WITH_BRANCHES = { commands: [], gitHost: true, remote: true, address: 'github.com/acme/shop' }

/** git-branches' levels of the "When it finishes" menu (`composer.auto`), Publish branch offered where the project has a remote. */
const level = (id: string, label: string, description: string, offered?: (project: { remote?: string } | undefined) => boolean): MountedOption<'composer.auto'> => ({
  place: 'composer.auto',
  id,
  label,
  description,
  sentence: `${label}.`,
  ...(offered ? { offered } : {}),
  package: '@openagt/git-branches',
  module: 'git-branches',
  projects: ['p1'],
  sessions: true,
})
const AUTO = mountedOf({ options: { 'composer.auto': [level('commit', 'Commit', 'It commits its work on its branch.'), level('branch', 'Publish branch', 'It commits and pushes its branch.', project => project === undefined || project.remote !== undefined)] } })
/** The form, with the levels git-branches brings mounted. */
const render = (page: ReactElement) => renderPage(page, { wrapper: ({ children }) => <ModulesContext.Provider value={AUTO}>{children}</ModulesContext.Provider> })
const props = { projectId: 'p1', files: [], context: new Set<string>(), addContext: noop, removeContext: noop, toggleContext: noop, projects: [], onPickProject: noop, onProjectAdded: noop }

describe('StartAgentForm (#1774)', () => {
  test('the project\'s commands are no buttons: they are in the box\'s `/` list, and nothing starts', async () => {
    onCommands.mockResolvedValue({ commands: COMMANDS, gitHost: true })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(onCommands).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: '/work-queue' })).toBeNull()
    expect(start).not.toHaveBeenCalled()
  })

  test("Start hands what the modules' controls picked to the run, and selects the run it answers", async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    start.mockResolvedValue({ agentId: 'r1' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} onAgentStarted={onAgentStarted} />)
    pickOptions(ON_CODEX)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r1', undefined, expect.anything()))
    expect(start).toHaveBeenCalledWith('p1', 'do the thing', { options: ON_CODEX })
  })

  test('the images go with the Start and to the run\'s page, and the draft lets them go with the words once the run is started', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    start.mockResolvedValue({ agentId: 'r1' })
    keepDraftImages('launcher:p1', [SHOT])
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} onAgentStarted={onAgentStarted} />)
    fireEvent.click(screen.getByText('submit-image'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('what does it say?', 'r1', undefined, expect.objectContaining({ images: [SHOT] })))
    expect(start).toHaveBeenCalledWith('p1', 'what does it say?', { images: [SHOT] })
    expect(keptDraftImages('launcher:p1')).toEqual([])
  })

  test('a start carries the words: the box keeps them for the move\'s picture, its update drops the draft, and the box is emptied once the move is over, also where the page stayed', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    start.mockResolvedValue({ agentId: 'r1' })
    keepDraft('launcher:p1', 'do the thing')
    let update: (() => void) | undefined
    let over = () => {}
    const finished = new Promise<void>(resolve => (over = resolve))
    const reduced = window.matchMedia
    window.matchMedia = (query: string) => ({ ...reduced(query), matches: false })
    document.startViewTransition = ((callback: () => void) => {
      update = callback
      return { finished }
    }) as unknown as typeof document.startViewTransition
    try {
      const onAgentStarted = vi.fn()
      render(<StartAgentForm {...props} onAgentStarted={onAgentStarted} />)
      fireEvent.click(screen.getByText('submit-typed'))
      await waitFor(() => expect(update).toBeDefined())
      expect(keptDraft('launcher:p1')).toBe('do the thing')
      expect(onAgentStarted).not.toHaveBeenCalled()
      update!()
      expect(onAgentStarted).toHaveBeenCalled()
      expect(keptDraft('launcher:p1')).toBeUndefined()
      expect(composerClear).not.toHaveBeenCalled()
      over()
      await waitFor(() => expect(composerClear).toHaveBeenCalled())
    } finally {
      window.matchMedia = reduced
      delete (document as { startViewTransition?: unknown }).startViewTransition
    }
  })

  test('while the start is asked for, the form says "Starting session", the chat\'s own first line, and nothing once it answers', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    let answer!: (result: { agentId: string }) => void
    start.mockReturnValue(new Promise(resolve => (answer = resolve)))
    render(<StartAgentForm {...props} />)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Starting session'))
    answer({ agentId: 'r1' })
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  test('on the Overview the notes hang under the box\'s row: the page\'s own line is right above the box, and a note there would be drawn across it', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    const { unmount } = render(<StartAgentForm {...props} onOverview />)
    await waitFor(() => expect(composerProps.current.notesUnder).toBe(true))
    unmount()
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(composerProps.current.notesUnder).toBe(false))
  })

  test('a loaded prompt is said above the box, over the page, so the box does not move', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    render(<StartAgentForm {...props} />)
    act(() => (composerProps.current.onLoaded as (label: string, replaced: boolean) => void)('footer', false))
    expect(screen.getByRole('status').textContent).toBe('footer loaded — review or edit, then Start')
    expect(screen.getByRole('status').parentElement!.dataset.testid).toBe('notes')
  })

  test('a start refused in a moment is not preceded by a flash of "Starting session"', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    let answer!: (result: undefined) => void
    start.mockReturnValue(new Promise(resolve => (answer = resolve)))
    render(<StartAgentForm {...props} />)
    fireEvent.click(screen.getByText('submit-typed'))
    await act(async () => {})
    expect(screen.queryByText('Starting session')).toBeNull()
    await act(async () => answer(undefined))
    expect(screen.queryByText('Starting session')).toBeNull()
  })

  test('a refused start gives the prompt the focus, however Start was pressed: typing goes on in it', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    start.mockResolvedValue(undefined)
    render(<StartAgentForm {...props} />)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(composerFocus).toHaveBeenCalledTimes(1))
  })

  test('the prompt takes the caret when the launcher opens, except on a phone, where the keyboard would rise over the page', () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    render(<StartAgentForm {...props} />)
    expect(composerProps.current.autoFocus).toBe(true)
    cleanup()
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    render(<StartAgentForm {...props} />)
    expect(composerProps.current.autoFocus).toBe(false)
    vi.unstubAllGlobals()
  })

  test('why no run started is a box above the message box: what is wrong as its title, in the page\'s own text size, then what follows smaller; nothing of the page shows through it', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    startSays.error = 'The run could not start: its worktree could not be made. Git says: fatal: invalid reference: my/work.'
    render(<StartAgentForm {...props} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(startSays.error)
    // Said wrong by its tint and its mark; the words in the text's own colour, which reads on the tint.
    expect(alert.className).toContain('var(--color-danger)_8%,var(--color-background)')
    expect(alert.className).toContain('text-foreground')
    expect(alert.querySelector('svg')!.getAttribute('class')).toContain('text-danger')
    const title = within(alert).getByText('The run could not start: its worktree could not be made.')
    expect(title.className).toContain('text-sm')
    expect(within(alert).getByText('Git says: fatal: invalid reference: my/work.').className).toContain('text-xs')
    expect(alert.parentElement!.dataset.testid).toBe('notes')
  })

  test("the gear's lines, in order, after the modules': the account, then, set apart, \"When it finishes\"; after the gear, the Context picker alone", async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true, remote: true, address: 'github.com/acme/shop' })
    runsAccount.login = 'octo'
    render(<StartAgentForm {...props} />)
    await screen.findByText('pick-octo-agent')
    expect(within(gearMenu()).getAllByRole('button').map(button => button.textContent)).toEqual(['pick-octo-agent'])
    const auto = autoMenu()
    expect(auto.textContent).toBe('When it finishes: Commit')
    expect(auto.previousElementSibling?.getAttribute('role')).toBe('separator')
    expect(screen.getByText('pick-octo-agent').compareDocumentPosition(auto) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(screen.getByTestId('controls')).getAllByRole('combobox').map(button => button.textContent)).toEqual(['Context'])
  })

  test("the gear's hover says its picks with the menu shut: the account and the level", async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    runsAccount.login = 'octo'
    prefs.current = { publish: 'merge' }
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(gearSaid()).toBe('@octo · Merge on green'))
  })

  test("a host with no account logged in: the gear is in the warning's colour, and its hover says so; with an account, or no remote, it is not", async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(gearSaid()).toBe('no GitHub account · Commit'))
    expect(screen.getByText('gear').dataset.warn).toBe('true')
    cleanup()
    runsAccount.login = 'octo'
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(gearSaid()).toContain('@octo'))
    expect(screen.getByText('gear').dataset.warn).toBe('false')
    cleanup()
    // No remote: no account to be missing, and no line for one.
    runsAccount.login = undefined
    onCommands.mockResolvedValue({ commands: [], gitHost: false, remote: false, address: 'github.com/acme/shop' })
    render(<StartAgentForm {...props} projectName="gemstack" />)
    await waitFor(() => expect(gearSaid()).toBe('Commit'))
    expect(screen.queryByText('pick-octo-agent')).toBeNull()
    expect(screen.getByText('gear').dataset.warn).toBe('false')
  })

  test('a session with no project: the gear has the account, which goes with the Start, and no "When it finishes"; after it, Context is the repos it works with', async () => {
    onCommands.mockResolvedValue(null)
    runsAccount.login = 'octo'
    start.mockResolvedValue({ agentId: 'r1' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} projectId="session" onAgentStarted={onAgentStarted} />)
    await waitFor(() => expect(gearSaid()).toBe('@octo'))
    expect(within(gearMenu()).getAllByRole('button').map(button => button.textContent)).toEqual(['pick-octo-agent'])
    expect(screen.queryAllByRole('menuitem')).toEqual([])
    expect(within(screen.getByTestId('controls')).getByRole('combobox', { name: 'Context' })).toBeTruthy()
    // One picked for the session goes with it, and to the run's page.
    fireEvent.click(screen.getByText('pick-octo-agent'))
    expect(gearSaid()).toBe('@octo-agent')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('session', 'do the thing', { account: 'octo-agent' }))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r1', undefined, { gitAccount: 'octo-agent' }))
  })

  test('a session with no project and no account is not held by it: the gear has no warning, since such a session may need none', async () => {
    onCommands.mockResolvedValue(null)
    runsAccount.login = undefined
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} projectId="session" />)
    await waitFor(() => expect(gearSaid()).toBe('no GitHub account'))
    expect(screen.getByText('gear').dataset.warn).toBe('false')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('session', 'do the thing', {}))
  })

  test("the dialog that adds an account stands beside the box, outside the gear's menu, which a press closes", () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    render(<StartAgentForm {...props} projectName="gemstack" />)
    expect(gearMenu().contains(screen.getByTestId('account-dialog'))).toBe(false)
  })

  test('the publish options: the line reads Commit until the person picks, and the Start carries no pick, left to the daemon; a saved pick is shown and carried, Off too; a change writes the saved setting', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    expect(autoMenu().textContent).toBe('When it finishes: Commit')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', {}))

    await openMenu(autoMenu())
    expect(publishOptions()).toEqual(['Off', 'Commit', 'Publish branch', 'Open PR', 'Merge on green'])
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Open PR/ }))
    expect(updatePreferences).toHaveBeenCalledWith({ publish: 'pr' })

    cleanup()
    start.mockClear()
    prefs.current = { publish: 'merge' }
    render(<StartAgentForm {...props} />)
    expect(autoMenu().textContent).toBe('When it finishes: Merge on green')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { publish: 'merge' }))

    cleanup()
    start.mockClear()
    prefs.current = { publish: 'nothing' }
    render(<StartAgentForm {...props} />)
    expect(autoMenu().textContent).toBe('When it finishes: Auto off')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { publish: 'nothing' }))
  })

  test('a project with no git host package is offered Off, Commit and Publish branch only, and a saved pull request pick reads as the branch, which is where the daemon holds it', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: false })
    prefs.current = { publish: 'merge' }
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(autoMenu().textContent).toBe('When it finishes: Publish branch'))
    await openMenu(autoMenu())
    expect(publishOptions()).toEqual(['Off', 'Commit', 'Publish branch'])
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { publish: 'merge' }))
  })

  test('a project with no remote is offered Off and Commit; its line reads Commit until the person picks, and with a saved publish pick too', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: false, remote: false })
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(autoMenu().textContent).toBe('When it finishes: Commit'))
    await openMenu(autoMenu())
    expect(publishOptions()).toEqual(['Off', 'Commit'])
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', {}))

    cleanup()
    start.mockClear()
    prefs.current = { publish: 'merge' }
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(autoMenu().textContent).toBe('When it finishes: Commit'))
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', { publish: 'merge' }))
  })

  test('what this page says goes with the Start, for the run\'s page until its record says it: the account, the level, the controls\' picks', async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    runsAccount.login = 'octo'
    prefs.current = { publish: 'pr' }
    start.mockResolvedValue({ agentId: 'r1' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} projectName="gemstack" onAgentStarted={onAgentStarted} />)
    await waitFor(() => expect(autoMenu().textContent).toBe('When it finishes: Open PR'))
    pickOptions(ON_CODEX)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalled())
    expect(onAgentStarted.mock.lastCall![3]).toEqual({ gitAccount: 'octo', publish: 'pr', options: ON_CODEX })
    expect((start.mock.lastCall![2] as { account?: string }).account).toBe('octo')
    runsAccount.login = undefined
  })

  test('the git host account picked for this session goes with the Start, and to the run\'s page; the computer\'s pick is sent when none is made', async () => {
    onCommands.mockResolvedValue(WITH_BRANCHES)
    runsAccount.login = 'octo'
    start.mockResolvedValue({ agentId: 'r1' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} projectName="gemstack" onAgentStarted={onAgentStarted} />)
    fireEvent.click(await screen.findByText('pick-octo-agent'))
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalled())
    expect((start.mock.lastCall![2] as { account?: string }).account).toBe('octo-agent')
    expect((onAgentStarted.mock.lastCall![3] as { gitAccount?: string }).gitAccount).toBe('octo-agent')
    runsAccount.login = undefined
  })

  test("no pick made: neither is sent, so the run's own default holds", async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} />)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing', {}))
  })

  test('before the project is read, and once it is, nothing is said and the submit is on', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    render(<StartAgentForm {...props} />)
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(onCommands).toHaveBeenCalledWith('p1'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByText('submit-typed') as HTMLButtonElement).disabled).toBe(false)
  })

  test("a host picked in \"Run on\" runs the run: the check is that host's, the Start names it, and the run's page says it by its name (#2394)", async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true, remote: true, address: 'github.com/acme/shop' })
    onRunHosts.mockResolvedValue([{ id: 'actions', label: 'GitHub Actions' }])
    // This computer's check finds nothing; the host's what would stop a run there.
    onStartCheck.mockImplementation(async (_projectId: string, _options: unknown, on?: string) => (on === 'actions' ? { problems: ['Its repository has no workflow openagent-agent.yml yet.'], warnings: [] } : null))
    selectHost('actions')
    start.mockResolvedValue({ agentId: 'r4' })
    const onAgentStarted = vi.fn()
    render(<StartAgentForm {...props} onAgentStarted={onAgentStarted} />)
    await waitFor(() => expect(onStartCheck).toHaveBeenCalledWith('p1', {}, 'actions'))
    // What stops a run there is the host's check to say: the modules are asked of this project alone, not of a run here.
    await waitFor(() => expect(onAttention).toHaveBeenLastCalledWith('p1', undefined))
    expect((await screen.findByRole('alert')).textContent).toContain('Its repository has no workflow openagent-agent.yml yet.')
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r4', 'GitHub Actions', expect.anything()))
    expect(start.mock.calls[0]![2]).toMatchObject({ host: 'actions' })
  })

  test('a host picked on a project that has none is no target: the run starts on this computer', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    selectHost('actions')
    start.mockResolvedValue({ agentId: 'r5' })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(onStartCheck).toHaveBeenCalledWith('p1', {}))
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(start.mock.calls[0]![2]).not.toHaveProperty('host')
  })

  test("what would stop the run is said before the Start, for the controls' picks; a warning is said too, and neither turns Start off", async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    onStartCheck.mockResolvedValue({ problems: ['`codex` is not logged in. Run `codex login`, then start again.'], warnings: ['`gh` is not logged in.'] })
    render(
      <ModulesContext.Provider value={mountedOf({ renders: [MARKDOWN_RENDER] })}>
        <StartAgentForm {...props} />
      </ModulesContext.Provider>,
    )
    pickOptions(ON_CODEX)
    await waitFor(() => expect(onStartCheck).toHaveBeenCalledWith('p1', ON_CODEX))
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    const [problem, warning] = screen.getAllByRole('alert')
    // Its sentences are lines of markdown, as the chat draws a line: what they put in backticks is code, not the backticks themselves.
    const lines = (alert: HTMLElement) => [...alert.querySelectorAll('[data-markdown-look="inline"]')].map(line => line.textContent)
    expect(lines(problem!)).toEqual(['`codex` is not logged in.', 'Run `codex login`, then start again.'])
    expect(lines(warning!)).toEqual(['`gh` is not logged in.'])
    expect(problem!.querySelector('svg')!.getAttribute('class')).toContain('text-danger')
    expect(warning!.querySelector('svg')!.getAttribute('class')).toContain('text-warning')
    expect((screen.getByText('submit-typed') as HTMLButtonElement).disabled).toBe(false)
    // Above the box, over the page: the box does not move when they come.
    expect(problem!.parentElement!.dataset.testid).toBe('notes')
  })

  test("a problem a module's item about the run says is said once, by the item with its press; with no such item, by the check's line", async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    const line = '`claude` is not logged in. Run `claude auth login`, then start again.'
    onStartCheck.mockResolvedValue({ problems: [line], warnings: [], fix: { kind: 'log-in', command: 'claude auth login', problem: line } })
    const item = { module: '@openagt/agent-driver', kind: 'setup', scope: 'run', id: 'agent:claude-code', words: 'Claude Code is not logged in', fix: { label: 'Add account', href: '/permissions' } }
    onAttention.mockResolvedValue({ items: [item], whole: true })
    render(<StartAgentForm {...props} />)
    const press = await screen.findByRole('button', { name: 'Add account' })
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1))
    const [said] = screen.getAllByRole('alert')
    expect(said!.contains(press)).toBe(true)
    expect(said!.textContent).not.toContain('then start again')
    cleanup()
    forgetRemembered()
    onAttention.mockResolvedValue({ items: [], whole: true })
    render(<StartAgentForm {...props} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('then start again'))
  })

  test('the row above the box starts with where the session works: the project\'s name, on the button of the picker', () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
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
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    const { rerender } = render(<StartAgentForm {...props} />)
    expect(startsAt()).toBe('')
    expect(screen.queryByRole('combobox', { name: 'The session works in' })).toBeNull()
    rerender(<StartAgentForm {...props} projectName="gemstack" />)
    expect(startsAt()).toBe('gemstack')
  })

  test('another project picked takes the typed prompt along to its page', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    const onPickProject = vi.fn()
    const alpha = { id: 'alpha-1', path: '/home/me/alpha', name: 'alpha', activated: true, gitHost: true }
    render(<StartAgentForm {...props} projectId="session" projects={[alpha]} onPickProject={onPickProject} />)
    ;(composerProps.current.onPromptChange as (value: string) => void)('fix the login page')
    await openMenu(screen.getByRole('combobox', { name: 'The session works in' }))
    fireEvent.click(await screen.findByRole('option', { name: 'alpha' }))
    expect(onPickProject).toHaveBeenCalledWith('alpha-1')
    expect(takePendingDraft()).toBe('fix the login page')
  })

  test("with no project, Context ticks repos on and off, a project's or one that is none, as many as wanted; its button says how many, and the Start sends their folders; nothing is made a project", async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    onRepos.mockResolvedValue({ repos: [{ path: '/home/me/oss/vike', name: 'vike', url: 'https://github.com/vikejs/vike.git' }], canAddFolder: false })
    start.mockResolvedValue({ agentId: 'r1' })
    const onAgentStarted = vi.fn()
    const onPickProject = vi.fn()
    const alpha = { id: 'alpha-1', path: '/home/me/alpha', name: 'alpha', activated: true, gitHost: true }
    render(<StartAgentForm {...props} projectId="session" projects={[alpha]} onPickProject={onPickProject} onAgentStarted={onAgentStarted} />)
    const context = () => within(screen.getByTestId('controls')).getByRole('combobox', { name: /^Context/ })
    // The row above the box says where the session works, and nothing of its repos.
    expect(startsAt()).toBe('No project')
    expect(context().textContent).toBe('Context')
    await openMenu(context())
    // The menu stays open while its rows are ticked.
    fireEvent.click(await screen.findByRole('option', { name: /vike/ }))
    fireEvent.click(await screen.findByRole('option', { name: /alpha/ }))
    expect(context().getAttribute('aria-label')).toBe('Context: 2 repos')
    expect(context().textContent).toBe('Context · 2 repos')
    // A ticked repo stays in the list, marked, and a press on it takes it out.
    expect(screen.getByRole('option', { name: /alpha/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: /alpha/ }))
    expect(context().textContent).toBe('Context · 1 repo')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onPickProject).not.toHaveBeenCalled()
    expect(startsAt()).toBe('No project')

    fireEvent.click(screen.getByText('submit-typed'))
    // The level in force goes with the repos it is for: Commit until the person picks.
    await waitFor(() => expect(start).toHaveBeenCalledWith('session', 'do the thing', { repos: ['/home/me/oss/vike'], publish: 'commit' }))
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('do the thing', 'r1', undefined, { publish: 'commit', repos: [{ name: 'vike', from: '/home/me/oss/vike' }] }))
    // Started: the next session starts with none.
    await waitFor(() => expect(context().textContent).toBe('Context'))
  })

  test("a project's Context is the same menu, and a repo ticked there is pointed at, not copied: it is told to the Context, and the Start sends no repos", async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    onRepos.mockResolvedValue({ repos: [{ path: '/home/me/oss/vike', name: 'vike' }], canAddFolder: false })
    start.mockResolvedValue({ agentId: 'r1' })
    const toggleContext = vi.fn()
    render(<StartAgentForm {...props} projectName="gemstack" toggleContext={toggleContext} />)
    const context = within(screen.getByTestId('controls')).getByRole('combobox', { name: 'Context' })
    await openMenu(context)
    fireEvent.click(await screen.findByRole('option', { name: /vike/ }))
    expect(toggleContext).toHaveBeenCalledWith('/home/me/oss/vike')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(start.mock.calls[0]![2]).not.toHaveProperty('repos')
  })

  test('typing after a failed start drops the red line', () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    startReset.mockClear()
    startSays.error = 'Could not start: the prompt is empty.'
    render(<StartAgentForm {...props} />)
    act(() => (composerProps.current.onPromptChange as (value: string) => void)('a'))
    expect(startReset).toHaveBeenCalledTimes(1)
    startSays.error = null
  })

  test('the picked files ride the prompt as one line at its end, after the command\'s own words; the picked repos go with the Start, to be copied', async () => {
    onCommands.mockResolvedValue({ commands: [], gitHost: true })
    start.mockResolvedValue({ agentId: 'r1' })
    render(<StartAgentForm {...props} context={new Set(['/repos/other', 'src/app.ts'])} />)
    fireEvent.click(screen.getByText('submit-typed'))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 'do the thing\n\nContext: src/app.ts', { repos: ['/repos/other'] }))
  })
})
