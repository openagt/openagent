import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { RunOptions } from '@openagt/hooks'
import { forgetRemembered } from '@openagt/ui/module'
import { fakeHost, hoverTooltip, mountedOf, openMenu, renderWithHost } from '@openagt/ui/module/testing'
import { folderName } from '../src/repo-names.js'
import { repoGroups, ReposControl, ReposMenu, reposSaid, withRepos } from './ReposControl.js'

// The repos a session works with, under the message box (`composer.control` at `context`): the
// launcher's menu that picks them into the run's options, and a session's, which adds to the ones it has.

const onRepos = vi.fn()

/**
 * The repos on this computer as the projects module offers them (`composer.where`), each by its
 * folder, read from `onRepos` as the test answers it: what the Context menu lists beside the projects.
 */
const THIS_COMPUTER = mountedOf({
  options: {
    'composer.where': [
      {
        place: 'composer.where',
        id: 'this-computer',
        label: 'Repos',
        order: 0,
        repos: async () => {
          const read = (await onRepos()) as { repos: { path: string; name: string; url?: string }[]; reposLoading: boolean }
          return { repos: read.repos.map(repo => ({ folder: repo.path, label: repo.name, detail: repo.url ? repo.url.replace(/^https:\/\//, '').replace(/\.git$/, '') : repo.path })), loading: read.reposLoading }
        },
        package: '@openagt/projects',
        projects: [],
        computer: true,
      },
    ],
  },
})
const render = (ui: ReactElement) => renderWithHost(ui, fakeHost('@openagt/git-branches'), THIS_COMPUTER)

afterEach(() => {
  cleanup()
  forgetRemembered()
  vi.clearAllMocks()
})

const row = (path: string, label = folderName(path), search = path) => ({ value: path, label, detail: path, path, search })
const READ = { hosted: [], reposLoading: false, hostedLoading: false, canAddFolder: false }
const context = () => screen.getByRole('combobox', { name: /^Repos/ })

describe("the session's repos", () => {
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
    expect(labels(repoGroups(projects, repos, [{ from: '/home/me/alpha', name: 'alpha' }], ''))).toEqual([
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
    const withLast = repoGroups([], repos, [{ from: '/home/me/r79', name: 'r79' }], '')[0]!.items
    expect(withLast.length).toBe(shown + 1)
    expect(withLast.at(-1)!.label).toBe('r79')
  })

  test('the button says Repos, then how many are picked; its name says the same, and its hover their names', async () => {
    onRepos.mockResolvedValue({ repos: [], ...READ })
    render(<ReposMenu picked={[]} projects={[]} busy={false} onChange={() => {}} />)
    expect(context().textContent).toBe('Repos')
    expect(context().getAttribute('aria-label')).toBe('Repos')
    expect((await hoverTooltip(context())).textContent).toBe("Repos to copy into the session's folder")
    cleanup()
    render(<ReposMenu picked={[{ from: '/home/me/oss/vike', name: 'vike' }]} projects={[]} busy={false} onChange={() => {}} />)
    expect(context().textContent).toBe('Repos · 1')
    expect(context().getAttribute('aria-label')).toBe('Repos: 1 repo')
    cleanup()
    render(<ReposMenu picked={[{ from: '/home/me/oss/vike', name: 'vike' }, { from: '/home/me/notes', name: 'notes' }]} projects={[]} busy={false} onChange={() => {}} />)
    expect(context().textContent).toBe('Repos · 2')
    expect(context().getAttribute('aria-label')).toBe('Repos: 2 repos')
    expect(reposSaid(['vike', 'notes'])).toBe("Copied into the session's folder: vike, notes")
  })

  test('the menu says what a tick does, marks the picked rows, and a press ticks one on or off without closing it', async () => {
    onRepos.mockResolvedValue({ repos: [{ path: '/home/me/oss/vike', name: 'vike' }, { path: '/home/me/notes', name: 'notes' }], ...READ })
    const onChange = vi.fn()
    render(<ReposMenu picked={[{ from: '/home/me/notes', name: 'notes' }]} projects={[]} busy={false} onChange={onChange} />)
    await openMenu(context())
    expect(screen.getByText("Repos copied into the session's folder")).toBeTruthy()
    const notes = await screen.findByRole('option', { name: /notes/ })
    expect(notes.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('option', { name: /vike/ }).getAttribute('aria-selected')).toBe('false')
    fireEvent.click(screen.getByRole('option', { name: /vike/ }))
    expect(onChange).toHaveBeenLastCalledWith([{ from: '/home/me/notes', name: 'notes' }, { from: '/home/me/oss/vike', name: 'vike' }])
    fireEvent.click(notes)
    expect(onChange).toHaveBeenLastCalledWith([])
    expect(context().getAttribute('aria-expanded')).toBe('true')
  })

  test('the first match of a search is highlighted, so Enter ticks it', async () => {
    onRepos.mockResolvedValue({ repos: [{ path: '/home/me/oss/vike', name: 'vike' }, { path: '/home/me/notes', name: 'notes' }], ...READ })
    const onChange = vi.fn()
    render(<ReposMenu picked={[]} projects={[]} busy={false} onChange={onChange} />)
    await openMenu(context())
    await screen.findByRole('option', { name: /notes/ })
    const search = screen.getByRole('combobox', { name: 'Search repos' })
    // Typed, as a person types: the combobox highlights on an input that carries its input type.
    fireEvent.input(search, { target: { value: 'notes' }, inputType: 'insertText' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith([{ from: '/home/me/notes', name: 'notes' }])
  })

  test('while the look through this computer is still on its way, the menu says so and asks again', async () => {
    onRepos.mockResolvedValue({ repos: [], ...READ, reposLoading: true })
    render(<ReposMenu picked={[]} projects={[]} busy={false} onChange={() => {}} />)
    await openMenu(context())
    expect(await screen.findByText('Looking for repos on this computer…')).toBeTruthy()
    const before = onRepos.mock.calls.length
    onRepos.mockResolvedValue({ repos: [{ path: '/home/me/oss/vike', name: 'vike' }], ...READ })
    await waitFor(() => expect(onRepos.mock.calls.length).toBeGreaterThan(before), { timeout: 4000 })
    expect(await screen.findByRole('option', { name: /vike/ })).toBeTruthy()
    expect(screen.queryByText('Looking for repos on this computer…')).toBeNull()
  })

  test("in a session the repos it has stay ticked: a press on one keeps it, and a repo ticked beside them is named beside them", async () => {
    onRepos.mockResolvedValue({ repos: [{ path: '/home/me/oss/vike', name: 'vike' }, { path: '/oss/vike', name: 'vike' }], ...READ })
    const onChange = vi.fn()
    const kept = [{ name: 'vike', from: '/home/me/oss/vike' }]
    render(<ReposMenu picked={kept} kept={kept} projects={[]} busy={false} onChange={onChange} />)
    await openMenu(context())
    expect(screen.getByText("Repos copied into this session's folder: a new one with your next message")).toBeTruthy()
    const rows = await screen.findAllByRole('option', { name: /vike/ })
    fireEvent.click(rows.find(row => row.getAttribute('aria-selected') === 'true')!)
    expect(onChange).toHaveBeenLastCalledWith(kept)
    fireEvent.click(rows.find(row => row.getAttribute('aria-selected') === 'false')!)
    expect(onChange).toHaveBeenLastCalledWith([...kept, { from: '/oss/vike', name: 'vike-2' }])
  })

  test('two folders of one name are told apart by a number, as their copies are named in the session folder', async () => {
    onRepos.mockResolvedValue({ repos: [{ path: '/work/app', name: 'app' }, { path: '/oss/app', name: 'app' }], ...READ })
    const onChange = vi.fn()
    render(<ReposMenu picked={[{ from: '/work/app', name: 'app' }]} projects={[]} busy={false} onChange={onChange} />)
    await openMenu(context())
    const rows = await screen.findAllByRole('option', { name: /app/ })
    fireEvent.click(rows.find(row => row.getAttribute('aria-selected') === 'false')!)
    expect(onChange).toHaveBeenLastCalledWith([{ from: '/work/app', name: 'app' }, { from: '/oss/app', name: 'app-2' }])
  })
})

describe('the control', () => {
  const props = (box: 'launcher' | 'session' | 'profile', options: RunOptions, onChange = vi.fn()) => ({ in: box, projectId: 'p', options, onChange, busy: false, say: () => {} })

  test("the launcher's pick is written to git-branches' slice, its other picks kept, and the slice goes when it holds nothing", async () => {
    onRepos.mockResolvedValue({ repos: [{ path: '/home/me/notes', name: 'notes' }], ...READ })
    const onChange = vi.fn()
    render(<ReposControl {...props('launcher', { 'git-branches': { base: 'dev' }, publish: 'commit' }, onChange)} />)
    await openMenu(context())
    fireEvent.click(await screen.findByRole('option', { name: /notes/ }))
    expect(onChange).toHaveBeenLastCalledWith({ publish: 'commit', 'git-branches': { base: 'dev', repos: [{ name: 'notes', from: '/home/me/notes' }] } })
    expect(withRepos({ 'git-branches': { repos: [{ name: 'notes', from: '/home/me/notes' }] }, publish: 'commit' }, [])).toEqual({ publish: 'commit' })
  })

  test("a profile's editor picks them the same way; a session counts the ones its next message goes with", async () => {
    onRepos.mockResolvedValue({ repos: [], ...READ })
    render(<ReposControl {...props('profile', {})} />)
    expect(context().textContent).toBe('Repos')
    cleanup()
    const recorded = { 'git-branches': { repos: [{ name: 'vike', from: '/home/me/oss/vike' }] } }
    render(<ReposControl {...props('session', recorded)} recorded={recorded} />)
    expect(screen.getByRole('combobox', { name: 'Repos: 1 repo' })).toBeTruthy()
  })
})
