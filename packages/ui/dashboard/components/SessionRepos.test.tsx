import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { hoverTooltip, openMenu } from '../test-utils.js'
import { forgetRemembered } from '../lib/use-async.js'

const onRepos = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onRepos }))

const { repoGroups, reposSaid, folderName, SessionReposMenu, SessionReposSaid } = await import('./SessionRepos.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
  vi.clearAllMocks()
})

const row = (path: string, label = folderName(path), search = path) => ({ value: path, label, detail: path, path, search })
const READ = { hosted: [], reposLoading: false, hostedLoading: false, canAddFolder: false }
const context = () => screen.getByRole('combobox', { name: /^Context/ })

describe("Context with no project: the session's repos", () => {
  test("a copy is named by the repo folder's own name, as the run names it", () => {
    expect(folderName('/home/me/oss/vike')).toBe('vike')
    expect(folderName('/home/me/oss/vike/')).toBe('vike')
    expect(folderName('C:\\code\\site')).toBe('site')
  })

  test('the projects, then the repos, the picked ones among them, and a search by name, folder or address', () => {
    const projects = [row('/home/me/alpha')]
    const repos = [row('/home/me/oss/vike', 'vike', '/home/me/oss/vike\nhttps://github.com/vikejs/vike'), row('/home/me/notes')]
    const labels = (groups: ReturnType<typeof repoGroups>) => groups.map(group => [group.label, group.items.map(item => item.label)])
    expect(labels(repoGroups(projects, repos, [], ''))).toEqual([
      ['Projects', ['alpha']],
      ['Repos', ['vike', 'notes']],
    ])
    // A picked one stays listed, to be ticked off there.
    expect(labels(repoGroups(projects, repos, [{ path: '/home/me/alpha', name: 'alpha' }], ''))).toEqual([
      ['Projects', ['alpha']],
      ['Repos', ['vike', 'notes']],
    ])
    expect(repoGroups(projects, repos, [], 'VIKEJS').flatMap(group => group.items.map(item => item.label))).toEqual(['vike'])
    expect(repoGroups(projects, repos, [], 'nothing-like-it')).toEqual([])
  })

  test('a picked repo past the first ones listed is still listed, so it can be ticked off without a search', () => {
    const repos = Array.from({ length: 80 }, (_, n) => row(`/home/me/r${n}`))
    const shown = repoGroups([], repos, [], '')[0]!.items.length
    expect(shown).toBeLessThan(80)
    const withLast = repoGroups([], repos, [{ path: '/home/me/r79', name: 'r79' }], '')[0]!.items
    expect(withLast.length).toBe(shown + 1)
    expect(withLast.at(-1)!.label).toBe('r79')
  })

  test('the button says Context, then how many repos are picked; its name says the same, and its hover their names', async () => {
    onRepos.mockResolvedValue({ repos: [], ...READ })
    render(<SessionReposMenu picked={[]} projects={[]} busy={false} onChange={() => {}} />)
    expect(context().textContent).toBe('Context')
    expect(context().getAttribute('aria-label')).toBe('Context')
    expect((await hoverTooltip(context())).textContent).toBe("Repos to copy into the session's folder")
    cleanup()
    render(<SessionReposMenu picked={[{ path: '/home/me/oss/vike', name: 'vike' }]} projects={[]} busy={false} onChange={() => {}} />)
    expect(context().textContent).toBe('Context · 1 repo')
    cleanup()
    render(<SessionReposMenu picked={[{ path: '/home/me/oss/vike', name: 'vike' }, { path: '/home/me/notes', name: 'notes' }]} projects={[]} busy={false} onChange={() => {}} />)
    expect(context().textContent).toBe('Context · 2 repos')
    expect(context().getAttribute('aria-label')).toBe('Context: 2 repos')
    expect(reposSaid(['vike', 'notes'])).toBe("Copied into the session's folder: vike, notes")
  })

  test('the menu says what a tick does, marks the picked rows, and a press ticks one on or off without closing it', async () => {
    onRepos.mockResolvedValue({ repos: [{ path: '/home/me/oss/vike', name: 'vike' }, { path: '/home/me/notes', name: 'notes' }], ...READ })
    const onChange = vi.fn()
    render(<SessionReposMenu picked={[{ path: '/home/me/notes', name: 'notes' }]} projects={[]} busy={false} onChange={onChange} />)
    await openMenu(context())
    expect(screen.getByText("Repos copied into the session's folder")).toBeTruthy()
    const notes = await screen.findByRole('option', { name: /notes/ })
    expect(notes.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('option', { name: /vike/ }).getAttribute('aria-selected')).toBe('false')
    fireEvent.click(screen.getByRole('option', { name: /vike/ }))
    expect(onChange).toHaveBeenLastCalledWith([{ path: '/home/me/notes', name: 'notes' }, { path: '/home/me/oss/vike', name: 'vike' }])
    fireEvent.click(notes)
    expect(onChange).toHaveBeenLastCalledWith([])
    expect(context().getAttribute('aria-expanded')).toBe('true')
  })

  test('the first match of a search is highlighted, so Enter ticks it', async () => {
    onRepos.mockResolvedValue({ repos: [{ path: '/home/me/oss/vike', name: 'vike' }, { path: '/home/me/notes', name: 'notes' }], ...READ })
    const onChange = vi.fn()
    render(<SessionReposMenu picked={[]} projects={[]} busy={false} onChange={onChange} />)
    await openMenu(context())
    await screen.findByRole('option', { name: /notes/ })
    const search = screen.getByRole('combobox', { name: 'Search repos' })
    // Typed, as a person types: the combobox highlights on an input that carries its input type.
    fireEvent.input(search, { target: { value: 'notes' }, inputType: 'insertText' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith([{ path: '/home/me/notes', name: 'notes' }])
  })

  test('while the look through this computer is still on its way, the menu says so and asks again', async () => {
    onRepos.mockResolvedValue({ repos: [], ...READ, reposLoading: true })
    render(<SessionReposMenu picked={[]} projects={[]} busy={false} onChange={() => {}} />)
    await openMenu(context())
    expect(await screen.findByText('Looking for repos on this computer…')).toBeTruthy()
    const before = onRepos.mock.calls.length
    onRepos.mockResolvedValue({ repos: [{ path: '/home/me/oss/vike', name: 'vike' }], ...READ })
    await waitFor(() => expect(onRepos.mock.calls.length).toBeGreaterThan(before), { timeout: 4000 })
    expect(await screen.findByRole('option', { name: /vike/ })).toBeTruthy()
    expect(screen.queryByText('Looking for repos on this computer…')).toBeNull()
  })

  test("on a session's own page Context is the launcher's button, and its menu lists the repos it started with, each ticked with where it was copied from; a press on one changes nothing and closes nothing", async () => {
    render(<SessionReposSaid repos={[{ name: 'vike', from: '/home/me/oss/vike' }, { name: 'notes', from: '/home/me/notes' }]} />)
    const button = screen.getByRole('button', { name: 'Context: 2 repos' })
    expect(button.textContent).toBe('Context · 2 repos')
    expect((await hoverTooltip(button)).textContent).toBe("Copies in this session's folder: vike, notes")
    await openMenu(button)
    expect(screen.getByText("Repos copied into this session's folder when it started")).toBeTruthy()
    const rows = screen.getAllByRole('menuitem')
    expect(rows.map(row => row.textContent?.startsWith('vike') || row.textContent?.startsWith('notes'))).toEqual([true, true])
    expect(rows.map(row => row.querySelector('[data-line2]')!.getAttribute('title'))).toEqual(['/home/me/oss/vike', '/home/me/notes'])
    expect(rows.every(row => row.getAttribute('aria-disabled') === 'true' && row.querySelector('.lucide-check'))).toBe(true)
    fireEvent.click(rows[0]!)
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })

  test('a session that started with no repo says so in the same menu', async () => {
    render(<SessionReposSaid repos={[]} />)
    const button = screen.getByRole('button', { name: 'Context' })
    expect(button.textContent).toBe('Context')
    await openMenu(button)
    expect(screen.getByText('None: this session started with no repo.')).toBeTruthy()
  })
})
