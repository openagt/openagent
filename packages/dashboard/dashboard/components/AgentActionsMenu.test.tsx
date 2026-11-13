import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// The ⋮ menu holds the git host / folder / editor / Stop / Remove / Delete actions, so it pulls
// their RPC + editor reads; stub them.
const onGitHostHome = vi.fn(async () => ({ url: 'https://github.com/o/r', name: 'GitHub' }) as { url: string; name: string } | null)
const onRepositoryOffer = vi.fn(async () => null as { repository: string; name: string } | null)
const sendCreateRepository = vi.fn(async () => ({ ok: true, url: 'https://github.com/me/shop' }) as unknown)
const sendOpenInApp = vi.fn(async () => ({ ok: true as const }))
const sendStop = vi.fn(async () => {})
const sendRemoveWorktree = vi.fn(async () => ({ ok: true as const }))
const sendDeleteAgent = vi.fn(async () => ({ ok: true as const }))
const sendRemoveProject = vi.fn(async (_projectId: string, _files: boolean) => ({ ok: true }) as unknown)
vi.mock('../rpc/reads.js', () => ({ onGitHostHome, onRepositoryOffer }))
vi.mock('../rpc/projects.js', () => ({ sendShareRecords: vi.fn(), sendRemoveProject }))
const openSettings = vi.hoisted(() => vi.fn())
vi.mock('../lib/use-route.js', async importOriginal => ({ ...(await importOriginal<object>()), openSettings }))
vi.mock('../rpc/control.js', () => ({
  sendOpenInApp,
  sendStop,
  sendRemoveWorktree,
  sendDeleteAgent,
  sendCreateRepository,
}))
// The editor picker (#727) lives in the menu's editor submenu; stub the preference store and the
// detected-editors read so the tests drive a fixed set.
const updatePreferences = vi.hoisted(() => vi.fn())
let prefs: { editor?: string } = {}
let detectedEditors: { bin: string; label: string }[] = []
vi.mock('../lib/preferences.js', () => ({ usePreferences: () => prefs, updatePreferences }))
vi.mock('../lib/editors.js', () => ({ useDetectedEditors: () => detectedEditors }))

const { AgentActionsMenu } = await import('./AgentActionsMenu.js')

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /session actions/i }))

beforeEach(() => {
  sendOpenInApp.mockClear()
  sendDeleteAgent.mockClear()
  sendCreateRepository.mockClear()
  sendCreateRepository.mockResolvedValue({ ok: true, url: 'https://github.com/me/shop' })
  onRepositoryOffer.mockClear()
  onRepositoryOffer.mockResolvedValue(null)
  updatePreferences.mockClear()
  prefs = {}
  detectedEditors = []
})
afterEach(cleanup)

describe('AgentActionsMenu (#toolbar-menu)', () => {
  test('the session\'s menu holds what belongs to the session, and the project\'s page on its git host after what opens the session\'s own', async () => {
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} label="my session" onDeleted={vi.fn()} />)
    openMenu()
    // No retained worktree here, so the folder item names the project root it will actually open.
    await waitFor(() => expect(screen.getByText('Open on GitHub')).toBeTruthy())
    expect(screen.getAllByRole('menuitem').map(item => item.textContent!.trim())).toEqual(['Open project folder', 'Open in editor', 'Open on GitHub', 'Delete session'])
    expect(screen.getByText('Open on GitHub').closest('a')!.getAttribute('href')).toBe('https://github.com/o/r')
    // The offer of a repository is the project's own page's.
    expect(onRepositoryOffer).not.toHaveBeenCalled()
  })

  test('a project with no page on a git host adds no item to the session\'s menu', async () => {
    onGitHostHome.mockResolvedValueOnce(null)
    render(<AgentActionsMenu projectId="p-none" agentId="run-1" events={[]} onDeleted={vi.fn()} />)
    openMenu()
    await waitFor(() => expect(onGitHostHome).toHaveBeenCalledWith('p-none'))
    await screen.findByText('Open project folder')
    expect(screen.queryByText(/^Open on /)).toBeNull()
  })

  test('opening the folder addresses this session, whichever checkout it resolves to', async () => {
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} onDeleted={vi.fn()} />)
    openMenu()
    fireEvent.click(await screen.findByText('Open project folder'))
    await waitFor(() => expect(sendOpenInApp).toHaveBeenCalledWith('p1', 'files', 'run-1'))
  })

  test("names the folder item for what it opens once the session's worktree is gone (#1195)", async () => {
    // A finished, non-retained run has no checkout of its own, so the item resolves to the project
    // root. Promising "the session's folder" there was a lie the user could not see.
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} onDeleted={vi.fn()} />)
    openMenu()
    expect(await screen.findByText('Open project folder')).toBeTruthy()
    expect(screen.queryByText("Open session's folder")).toBeNull()
    // The editor opens the same project root, and says so.
    fireEvent.click(screen.getByText('Open in editor'))
    expect((await screen.findByRole('menuitem', { name: 'Open the project' })).title).toBe('This session no longer has its own checkout')
    cleanup()

    // A retained worktree still exists, so the session wording is honest again.
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} retainedWorktree onDeleted={vi.fn()} />)
    openMenu()
    expect(await screen.findByText("Open session's folder")).toBeTruthy()
    fireEvent.click(screen.getByText('Open in editor'))
    expect(await screen.findByRole('menuitem', { name: "Open this session's checkout" })).toBeTruthy()
  })

  test('copies the command that reopens the session in a terminal (#1195)', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    const events = [
      { kind: 'session', driver: 'claude', workspace: '/repo/.openagent/worktrees/run-1', fake: false },
      { kind: 'session-update', sessionId: '45015d11-755b-423c-ae71-8dbfd54f7cce' },
    ] as never
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={events} onDeleted={vi.fn()} />)
    openMenu()
    // The id is visible in its own right: it is the only handle on the conversation off-dashboard.
    expect(await screen.findByText('45015d11')).toBeTruthy()
    fireEvent.click(screen.getByText('Copy resume command'))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "mkdir -p '/repo/.openagent/worktrees/run-1' && cd '/repo/.openagent/worktrees/run-1' && claude --resume 45015d11-755b-423c-ae71-8dbfd54f7cce",
      ),
    )
    // And it says so, since a click that only fills the clipboard shows nothing otherwise.
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy())
  })

  test('offers nothing to copy for a run that never reported a session', async () => {
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} onDeleted={vi.fn()} />)
    openMenu()
    await waitFor(() => expect(screen.getByText('Open in editor')).toBeTruthy())
    expect(screen.queryByText('Copy resume command')).toBeNull()
    expect(screen.queryByText('Copy session id')).toBeNull()
  })

  test('Delete asks to confirm before deleting', async () => {
    const onDeleted = vi.fn()
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} label="my session" onDeleted={onDeleted} />)
    openMenu()
    fireEvent.click(await screen.findByText('Delete session'))
    // The confirm dialog, not a bare delete: the session and its history go for good.
    await waitFor(() => expect(screen.getByText('Delete this session?')).toBeTruthy())
    expect(sendDeleteAgent).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(sendDeleteAgent).toHaveBeenCalledWith('p1', 'run-1'))
  })

  test('while the delete is on its way, the focus stays on its button in the dialog', async () => {
    let done = (_: { ok: true }) => {}
    sendDeleteAgent.mockImplementationOnce(() => new Promise(resolve => (done = resolve)))
    const onDeleted = vi.fn()
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} label="my session" onDeleted={onDeleted} />)
    openMenu()
    fireEvent.click(await screen.findByText('Delete session'))
    const confirm = await screen.findByRole('button', { name: 'Delete' })
    confirm.focus()
    fireEvent.click(confirm)
    const busy = await screen.findByRole('button', { name: 'Deleting…' })
    expect(document.activeElement).toBe(busy)
    expect(busy.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(busy)
    expect(sendDeleteAgent).toHaveBeenCalledTimes(1)
    done({ ok: true })
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
  })
})

describe('the live-session action: Stop', () => {
  const liveEvents = [{ kind: 'session-update', sessionId: 'working' }] as never

  test('a live session offers Stop, and no Merge while it works', async () => {
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={liveEvents} onDeleted={vi.fn()} />)
    openMenu()
    await waitFor(() => expect(screen.getByText('Stop agent')).toBeTruthy())
    expect(screen.queryByText(/Merge/)).toBeNull()
  })

  test('an ended session offers no Stop', async () => {
    const ended = [{ kind: 'session-update', sessionId: 'working' }, { kind: 'end', ok: true }] as never
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={ended} onDeleted={vi.fn()} />)
    openMenu()
    await waitFor(() => expect(screen.getByText('Open in editor')).toBeTruthy())
    expect(screen.queryByText('Stop agent')).toBeNull()
  })

  test('while OpenAgent is not answering, Stop is off and sends nothing', async () => {
    const { DaemonDown } = await import('../lib/use-daemon-health.js')
    sendStop.mockClear()
    render(
      <DaemonDown.Provider value>
        <AgentActionsMenu projectId="p1" agentId="run-1" events={liveEvents} onDeleted={vi.fn()} />
      </DaemonDown.Provider>,
    )
    openMenu()
    const stop = await screen.findByRole('menuitem', { name: 'Stop agent' })
    expect(stop.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(stop)
    expect(sendStop).not.toHaveBeenCalled()
  })
})

describe('the menu with no session: the project home (#809)', () => {
  const openProjectMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Project actions' }))

  test('it is named "Project actions" and opens the project folder', async () => {
    render(<AgentActionsMenu projectId="p1" events={[]} />)
    expect(screen.queryByRole('button', { name: /session actions/i })).toBeNull()
    openProjectMenu()
    expect(await screen.findByText('Open on GitHub')).toBeTruthy()
    fireEvent.click(screen.getByText('Open folder'))
    await waitFor(() => expect(sendOpenInApp).toHaveBeenCalledWith('p1', 'files', undefined))
  })

  test('its editor item opens the project in the editor', async () => {
    render(<AgentActionsMenu projectId="p1" events={[]} />)
    openProjectMenu()
    fireEvent.click(await screen.findByText('Open in editor'))
    fireEvent.click(await screen.findByText('Open in your editor'))
    await waitFor(() => expect(sendOpenInApp).toHaveBeenCalledWith('p1', 'editor', undefined))
  })

  test('it offers nothing to stop, remove or delete, and ends on its last item with no rule under it', async () => {
    render(<AgentActionsMenu projectId="p1" events={[]} retainedWorktree onDeleted={vi.fn()} />)
    openProjectMenu()
    const menu = await screen.findByRole('menu')
    expect(screen.queryByText('Stop agent')).toBeNull()
    expect(screen.queryByText('Remove worktree')).toBeNull()
    expect(screen.queryByText('Delete session')).toBeNull()
    expect(menu.querySelector('[role="separator"]')).toBeNull()
  })

  test('a finished session with something to delete has one rule above it', async () => {
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} onDeleted={vi.fn()} />)
    openMenu()
    const menu = await screen.findByRole('menu')
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1)
  })
})

describe('the editor picker in the menu (#727)', () => {
  const openEditorMenu = async () => {
    openMenu()
    fireEvent.click(await screen.findByText('Open in editor'))
  }

  test('picking a detected editor stores its CLI bin', async () => {
    detectedEditors = [
      { bin: 'code', label: 'VS Code' },
      { bin: 'cursor', label: 'Cursor' },
    ]
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} />)
    await openEditorMenu()
    fireEvent.click(await screen.findByText('Cursor'))
    expect(updatePreferences).toHaveBeenCalledWith({ editor: 'cursor' })
  })

  test('picking Default clears the editor', async () => {
    prefs = { editor: 'cursor' }
    detectedEditors = [{ bin: 'cursor', label: 'Cursor' }]
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} />)
    await openEditorMenu()
    // "Default" names the setting a person sets to choose it.
    expect(await screen.findByText('$OPENAGENT_EDITOR, or code')).toBeTruthy()
    // The pick is said as a radio's, checked or not, not only drawn.
    expect(screen.getAllByRole('menuitemradio').map(item => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Default$OPENAGENT_EDITOR, or code', 'false'],
      ['Cursorcursor', 'true'],
    ])
    fireEvent.click(await screen.findByText('Default'))
    expect(updatePreferences).toHaveBeenCalledWith({ editor: '' })
  })

  test('shows a stored editor that was not auto-detected as a custom row', async () => {
    prefs = { editor: 'mate' }
    detectedEditors = [{ bin: 'code', label: 'VS Code' }]
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} />)
    await openEditorMenu()
    await waitFor(() => expect(screen.getAllByText('mate').length).toBeGreaterThan(0))
  })
})

describe('Where the agent data is, in the project\u2019s menu', () => {
  test('the project\u2019s menu opens the project\u2019s Agent data page; a session\u2019s menu has no such item', async () => {
    render(<AgentActionsMenu projectId="p1" events={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }))
    fireEvent.click(await screen.findByText('Agent data\u2026'))
    expect(openSettings).toHaveBeenCalledWith('project-agent-data', 'p1')
    cleanup()

    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /session actions/i }))
    await waitFor(() => expect(screen.getByText('Open project folder')).toBeTruthy())
    expect(screen.queryByText('Agent data\u2026')).toBeNull()
  })
})

describe('Create a repository, for a project that lives on this machine only', () => {
  const openProjectMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Project actions' }))

  test('the project menu offers it only when the project is offered a repository, and asks before creating', async () => {
    onRepositoryOffer.mockResolvedValue({ repository: 'me/shop', name: 'GitHub' })
    render(<AgentActionsMenu projectId="p1" events={[]} />)
    openProjectMenu()
    fireEvent.click(await screen.findByText('Create a repository on GitHub…'))
    await waitFor(() => expect(screen.getByText('Create a private repository on GitHub?')).toBeTruthy())
    expect(screen.getByText('me/shop')).toBeTruthy()
    expect(sendCreateRepository).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create and push' }))
    await waitFor(() => expect(sendCreateRepository).toHaveBeenCalledWith('p1'))
    // The project is asked again: it has a page on its git host now, and nothing left to create.
    await waitFor(() => expect(onRepositoryOffer.mock.calls.length).toBeGreaterThan(1))
  })

  test('a refusal stays in the dialog in the provider\'s words; no offer, no item; a session\'s menu never offers it', async () => {
    onRepositoryOffer.mockResolvedValue({ repository: 'me/shop', name: 'GitHub' })
    sendCreateRepository.mockResolvedValue({ ok: false, error: 'the repository could not be created: Name already exists on this account' })
    render(<AgentActionsMenu projectId="p1" events={[]} />)
    openProjectMenu()
    fireEvent.click(await screen.findByText('Create a repository on GitHub…'))
    fireEvent.click(await screen.findByRole('button', { name: 'Create and push' }))
    await waitFor(() => expect(screen.getByText(/Name already exists on this account/)).toBeTruthy())
    cleanup()

    onRepositoryOffer.mockResolvedValue(null)
    render(<AgentActionsMenu projectId="p1" events={[]} />)
    openProjectMenu()
    await waitFor(() => expect(screen.getByText('Open folder')).toBeTruthy())
    expect(screen.queryByText(/Create a repository/)).toBeNull()
    cleanup()

    onRepositoryOffer.mockClear()
    onRepositoryOffer.mockResolvedValue({ repository: 'me/shop', name: 'GitHub' })
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /session actions/i }))
    await waitFor(() => expect(screen.getByText('Open project folder')).toBeTruthy())
    expect(screen.queryByText(/Create a repository/)).toBeNull()
    expect(onRepositoryOffer).not.toHaveBeenCalled()
  })
})

// An agent's page has one menu, whose button is the session's name.
describe('the menu of an agent\'s page', () => {
  test('the session\'s menu button is the session\'s name with a small arrow; the whole name on hover', () => {
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} label="Fix the login page" />)
    // Named by the name it shows, so a person who says or reads the name finds it.
    const button = screen.getByRole('button', { name: 'Fix the login page, session actions' })
    expect(button.textContent).toBe('Fix the login page')
    expect(button.getAttribute('title')).toBe('Fix the login page')
    expect(button.querySelector('svg')).toBeTruthy()
    expect(screen.queryByTestId('title-placeholder')).toBeNull()
  })

  test('a name not known yet is a grey bar in its place, and the menu opens all the same', async () => {
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} />)
    expect(screen.getByTestId('title-placeholder').className).toContain('bg-muted')
    openMenu()
    await waitFor(() => expect(screen.getByText('Open project folder')).toBeTruthy())
  })

  test('a name the run was being given comes in letter by letter, as the session\'s row in the list does; one that was only slow to load, or was there from the start, is plain', () => {
    const { rerender } = render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} naming />)
    rerender(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} label="Header comes in" />)
    const button = screen.getByRole('button', { name: /session actions/i })
    expect(button.textContent).toBe('Header comes in')
    expect(button.querySelectorAll('.letter-in').length).toBe('Header comes in'.length)
    cleanup()
    render(<AgentActionsMenu projectId="p1" agentId="run-2" events={[]} label="Plain from the start" />)
    expect(screen.getByRole('button', { name: /session actions/i }).querySelectorAll('.letter-in').length).toBe(0)
    cleanup()
    // The bar stays up when the next session is opened: its name was not waited for.
    const next = render(<AgentActionsMenu projectId="p1" agentId="run-4" events={[]} naming />)
    next.rerender(<AgentActionsMenu projectId="p1" agentId="run-4" events={[]} label="First name" />)
    next.rerender(<AgentActionsMenu projectId="p1" agentId="run-5" events={[]} label="Another session" />)
    expect(screen.getByRole('button', { name: /session actions/i }).querySelectorAll('.letter-in').length).toBe(0)
    cleanup()
    // An old session opened: the bar waits for the page's reads, with no name coming.
    const slow = render(<AgentActionsMenu projectId="p1" agentId="run-3" events={[]} />)
    slow.rerender(<AgentActionsMenu projectId="p1" agentId="run-3" events={[]} label="Opened later" />)
    expect(screen.getByRole('button', { name: /session actions/i }).querySelectorAll('.letter-in').length).toBe(0)
  })

  test('the session\'s menu shows and hides the details strip, when the page has one', async () => {
    const onToggle = vi.fn()
    const { rerender } = render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} label="x" details={{ open: false, onToggle }} />)
    openMenu()
    fireEvent.click(await screen.findByText('Show details'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    rerender(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} label="x" details={{ open: true, onToggle }} />)
    openMenu()
    expect(await screen.findByText('Hide details')).toBeTruthy()
    cleanup()
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} label="x" />)
    openMenu()
    await waitFor(() => expect(screen.getByText('Open project folder')).toBeTruthy())
    expect(screen.queryByText(/details/)).toBeNull()
  })

  test('"Remove worktree" says the worktree\'s size on disk beside it', async () => {
    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} label="x" retainedWorktree size="1.2 MB" />)
    openMenu()
    expect((await screen.findByText('Remove worktree')).closest('[role=menuitem]')!.textContent!.trim()).toBe('Remove worktree1.2 MB')
  })
})

describe('Remove project, in the project’s menu', () => {
  const openProjectMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Project actions' }))

  test('it asks first, says nothing in the folder is deleted and what stays, then removes the project, says so, and tells the page', async () => {
    sendRemoveProject.mockClear()
    sendRemoveProject.mockResolvedValue({ ok: true })
    const onProjectRemoved = vi.fn()
    render(<AgentActionsMenu projectId="p1" events={[]} onProjectRemoved={onProjectRemoved} />)
    openProjectMenu()
    fireEvent.click(await screen.findByText('Remove project…'))
    await waitFor(() => expect(screen.getByText('Remove this project?')).toBeTruthy())
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toMatch(/Nothing in the folder is deleted/)
    for (const kept of ['.openagent', '.branches', '.agent-runner', '~/.openagent', 'agent-data']) expect(dialog.textContent).toContain(kept)
    expect(dialog.textContent).toMatch(/Add the folder again to bring\s+the project back/)
    // The box is there, not ticked, and what it would delete is not said until it is.
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
    expect(dialog.textContent).toContain('Also delete OpenAgent’s files in this folder')
    expect(dialog.textContent).not.toMatch(/This deletes/)
    expect(sendRemoveProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(sendRemoveProject).toHaveBeenCalledWith('p1', false))
    await waitFor(() => expect(screen.getByText('Project removed')).toBeTruthy())
    expect(screen.getByRole('alertdialog').textContent).toMatch(/nothing in the folder was deleted\. Add the folder again to bring the project back/)
    expect(onProjectRemoved).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(onProjectRemoved).toHaveBeenCalledTimes(1))
  })

  test('with the box ticked it says what goes and what never does, removes with the files, and shows what went and what stayed before the page is told', async () => {
    sendRemoveProject.mockClear()
    sendRemoveProject.mockResolvedValue({
      ok: true,
      cleanup: {
        removed: ['.branches/agent-data', 'branch agent-data', '.openagent'],
        kept: [{ path: '.branches/agent-1', reason: 'agent-1 has uncommitted work; the checkout was kept' }],
        failed: ['my-tool: took too long'],
      },
    })
    const onProjectRemoved = vi.fn()
    render(<AgentActionsMenu projectId="p1" events={[]} onProjectRemoved={onProjectRemoved} />)
    openProjectMenu()
    fireEvent.click(await screen.findByText('Remove project…'))
    fireEvent.click(await screen.findByRole('checkbox'))
    const dialog = screen.getByRole('alertdialog')
    await waitFor(() => expect(dialog.textContent).toMatch(/This deletes, on this machine/))
    expect(dialog.textContent).not.toMatch(/Nothing in the folder is deleted/)
    expect(dialog.textContent).toMatch(/Your files and your commits stay\./)
    expect(dialog.textContent).toMatch(/hooks\.yml, the project’s start lines/)
    expect(dialog.textContent).toMatch(/An agent that waits for your answer cannot be\s+continued after this/)
    expect(dialog.textContent).toMatch(/A tool that\s+worked in the project removes its own files too/)
    expect(dialog.textContent).toMatch(/A scheduler\s+you set to keep running is not stopped/)
    expect(dialog.textContent).toMatch(/The agents’ conversations go with them/)
    expect(dialog.textContent).toMatch(/this is\s+their only copy/)
    expect(dialog.textContent).toMatch(/It never touches the remote, your files, your commits, a branch with work on it, or a file git tracks/)
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove and delete' }))
    await waitFor(() => expect(sendRemoveProject).toHaveBeenCalledWith('p1', true))

    await waitFor(() => expect(screen.getByText('Project removed')).toBeTruthy())
    const report = screen.getByRole('alertdialog').textContent ?? ''
    for (const line of ['Deleted', '.branches/agent-data', 'branch agent-data', '.openagent', 'Kept', '.branches/agent-1: agent-1 has uncommitted work; the checkout was kept', 'Could not be cleaned', 'my-tool: took too long']) {
      expect(report).toContain(line)
    }
    // The page moves on only once the person has read it.
    expect(onProjectRemoved).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(onProjectRemoved).toHaveBeenCalledTimes(1))
  })

  test('once removed, the focus is on "Done", the dialog’s one way on', async () => {
    sendRemoveProject.mockClear()
    sendRemoveProject.mockResolvedValue({ ok: true })
    render(<AgentActionsMenu projectId="p1" events={[]} onProjectRemoved={vi.fn()} />)
    openProjectMenu()
    fireEvent.click(await screen.findByText('Remove project…'))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.getByText('Project removed')).toBeTruthy())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done' })))
    cleanup()
  })

  test('a box ticked and then cancelled is unticked the next time the dialog opens', async () => {
    sendRemoveProject.mockClear()
    render(<AgentActionsMenu projectId="p1" events={[]} onProjectRemoved={vi.fn()} />)
    openProjectMenu()
    fireEvent.click(await screen.findByText('Remove project…'))
    fireEvent.click(await screen.findByRole('checkbox'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove and delete' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    openProjectMenu()
    fireEvent.click(await screen.findByText('Remove project…'))
    expect((await screen.findByRole('checkbox')).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect(sendRemoveProject).not.toHaveBeenCalled()
    cleanup()
  })

  test('a refusal is said in the dialog and the page is not told; with nobody to tell, or in a session’s menu, it is not offered', async () => {
    sendRemoveProject.mockClear()
    sendRemoveProject.mockResolvedValue({ ok: false, error: 'An agent is working in this project. Stop it, then remove the project.' })
    const onProjectRemoved = vi.fn()
    render(<AgentActionsMenu projectId="p1" events={[]} onProjectRemoved={onProjectRemoved} />)
    openProjectMenu()
    fireEvent.click(await screen.findByText('Remove project…'))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.getByText(/An agent is working in this project/)).toBeTruthy())
    expect(onProjectRemoved).not.toHaveBeenCalled()
    cleanup()

    render(<AgentActionsMenu projectId="p1" events={[]} />)
    openProjectMenu()
    await waitFor(() => expect(screen.getByText('Open folder')).toBeTruthy())
    expect(screen.queryByText('Remove project…')).toBeNull()
    cleanup()

    render(<AgentActionsMenu projectId="p1" agentId="run-1" events={[]} onDeleted={vi.fn()} onProjectRemoved={onProjectRemoved} />)
    fireEvent.click(screen.getByRole('button', { name: /session actions/i }))
    await waitFor(() => expect(screen.getByText('Open in editor')).toBeTruthy())
    expect(screen.queryByText('Remove project…')).toBeNull()
  })
})
