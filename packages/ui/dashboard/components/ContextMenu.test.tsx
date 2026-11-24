import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { hoverTooltip, openMenu } from '../test-utils.js'
import { forgetRemembered } from '../lib/use-async.js'

const onProjects = vi.hoisted(() => vi.fn())
const onRepos = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onProjects, onRepos }))

const { ProjectContextMenu, SessionContextMenu, isRepoPath } = await import('./ContextMenu.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
  vi.clearAllMocks()
})

const PROJECTS = [
  { id: 'shop', name: 'shop', path: '/w/shop' },
  { id: 'a', name: 'api', path: '/w/api' },
  { id: 'b', name: 'ui', path: '/w/ui' },
]
const REPOS = { repos: [{ path: '/w/shop', name: 'shop' }, { path: '/home/me/oss/vike', name: 'vike' }], hosted: [], reposLoading: false, hostedLoading: false, canAddFolder: false }

function renderMenu(context: string[] = [], busy = false) {
  onProjects.mockResolvedValue(PROJECTS)
  onRepos.mockResolvedValue(REPOS)
  const onToggle = vi.fn()
  render(<ProjectContextMenu projectId="shop" context={new Set(context)} busy={busy} onToggle={onToggle} />)
  return { onToggle }
}
const button = () => screen.getByRole('combobox', { name: /^Context/ })

// The Context picker of a project's box (#1046, #665): the menu a session with no project has, with the project's files over its repos.
describe("a project's Context", () => {
  test('a path of the Context is a repo when it is a folder on this computer, a file of the project otherwise', () => {
    expect(isRepoPath('/w/api')).toBe(true)
    expect(isRepoPath('C:\\code\\site')).toBe(true)
    expect(isRepoPath('src/app.ts')).toBe(false)
    expect(isRepoPath('README.md')).toBe(false)
  })

  test('it lists the other projects and the repos of this computer, never the project itself, and marks the ones in the Context', async () => {
    renderMenu(['/w/api'])
    await openMenu(button())
    await screen.findByRole('option', { name: /vike/ })
    expect(screen.getAllByRole('option').map(option => option.textContent?.split('/')[0])).toEqual(['api', 'ui', 'vike'])
    expect(screen.getByRole('option', { name: /api/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('option', { name: /ui/ }).getAttribute('aria-selected')).toBe('false')
  })

  test('its heading says what a tick does, the same as with no project: the repo is copied', async () => {
    renderMenu()
    await openMenu(button())
    expect(screen.getByText("Repos copied into the session's folder")).toBeTruthy()
  })

  test('a press ticks a repo on or off, a project or one that is none: the Context is told its path, and the menu stays open', async () => {
    const { onToggle } = renderMenu(['/w/api'])
    await openMenu(button())
    fireEvent.click(await screen.findByRole('option', { name: /vike/ }))
    expect(onToggle).toHaveBeenLastCalledWith('/home/me/oss/vike')
    fireEvent.click(screen.getByRole('option', { name: /api/ }))
    expect(onToggle).toHaveBeenLastCalledWith('/w/api')
    expect(onToggle).toHaveBeenCalledTimes(2)
    expect(button().getAttribute('aria-expanded')).toBe('true')
  })

  test('the button says Context, then how many repos and how many files are picked; its name says the same, and its hover the repos by name', async () => {
    renderMenu()
    expect(button().textContent).toBe('Context')
    expect(button().getAttribute('aria-label')).toBe('Context')
    expect((await hoverTooltip(button())).textContent).toBe("Repos to copy into the session's folder")
    cleanup()
    renderMenu(['/w/api', '/home/me/oss/vike', 'src/app.ts'])
    expect(button().textContent).toBe('Context · 2 repos · 1 file')
    expect(button().getAttribute('aria-label')).toBe('Context: 2 repos · 1 file')
    expect((await hoverTooltip(button())).textContent).toBe("Copied into the session's folder: api, vike")
    cleanup()
    renderMenu(['src/app.ts', 'README.md'])
    expect(button().textContent).toBe('Context · 2 files')
  })

  test('the picked files are listed over the repos, each removable; with none, how to add one, last', async () => {
    const { onToggle } = renderMenu(['src/app.ts'])
    await openMenu(button())
    expect(screen.getByText('Files')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /app\.ts/ }))
    expect(onToggle).toHaveBeenCalledWith('src/app.ts')
    cleanup()
    renderMenu()
    await openMenu(button())
    expect(screen.getByText('None yet — add with # or the Files pane.')).toBeTruthy()
  })

  test('it is off while the box is busy', () => {
    renderMenu([], true)
    expect((button() as HTMLButtonElement).disabled).toBe(true)
  })
})

// A session in a project, on its own page: its copies said, the files for the next message picked.
describe("a project session's Context", () => {
  const session = () => screen.getByRole('button', { name: /^Context/ })

  test('the button counts the repos the session started with and the files picked; the menu lists the repos as said, with where each was copied from, and the files to be removed', async () => {
    const onToggle = vi.fn()
    render(<SessionContextMenu repos={[{ name: 'api', from: '/w/api' }]} context={new Set(['src/app.ts'])} busy={false} onToggle={onToggle} />)
    expect(session().textContent).toBe('Context · 1 repo · 1 file')
    expect(session().getAttribute('aria-label')).toBe('Context: 1 repo · 1 file')
    await openMenu(session())
    expect(screen.getByText("Repos copied into this session's folder when it started")).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /api/ }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /app\.ts/ }))
    expect(onToggle).toHaveBeenCalledWith('src/app.ts')
  })

  test('with no repo and no file it says Context alone, and how to add a file', async () => {
    render(<SessionContextMenu repos={[]} context={new Set()} busy={false} onToggle={vi.fn()} />)
    expect(session().textContent).toBe('Context')
    await openMenu(session())
    expect(screen.getByText('None yet — add with # or the Files pane.')).toBeTruthy()
  })
})
