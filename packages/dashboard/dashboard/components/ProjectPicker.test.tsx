import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { openMenu } from '../test-utils.js'
import { forgetRemembered } from '../lib/use-async.js'
import type { ProjectSummary } from '../../src/index.js'

const onRepos = vi.hoisted(() => vi.fn())
const sendAddRepoFolder = vi.hoisted(() => vi.fn())
const sendAddProject = vi.hoisted(() => vi.fn())
const onCloneTarget = vi.hoisted(() => vi.fn())
const sendAddProjectFromAddress = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onRepos, sendAddRepoFolder, sendAddProject, sendPickProjectDirectory: vi.fn(), onCloneTarget, sendAddProjectFromAddress }))
const MACBOOK = { id: 'http://127.0.0.1:4210', url: 'http://127.0.0.1:4210', label: 'Suleimans-MacBook-Pro' }
vi.mock('../lib/machines.js', () => ({ useMachines: () => [MACBOOK] }))

const { ProjectPicker, REPOS_SHOWN, repoDetail, shownAddress } = await import('./ProjectPicker.js')

const ALPHA: ProjectSummary = { id: 'alpha-1', path: '/home/me/alpha', name: 'alpha', activated: true, gitHost: true }
const VIKE = { path: '/home/me/oss/vike', name: 'vike', url: 'https://github.com/vikejs/vike.git' }
const NOTES = { path: '/home/me/notes', name: 'notes' }

beforeEach(() => {
  onRepos.mockResolvedValue({ repos: [VIKE, NOTES], hosted: [], reposLoading: false, hostedLoading: false, canAddFolder: true })
})
afterEach(() => {
  cleanup()
  forgetRemembered()
  vi.clearAllMocks()
})

const NO_PROJECT = { label: 'No project', tip: 'The session works in a folder of its own' }

function renderPicker(over: Partial<Parameters<typeof ProjectPicker>[0]> = {}) {
  const onPick = vi.fn()
  const onProjectAdded = vi.fn()
  const props = { look: 'row' as const, none: NO_PROJECT, picked: null, projects: [ALPHA], busy: false, onPick, onProjectAdded, ...over }
  const view = render(<ProjectPicker {...props} />)
  return { onPick, onProjectAdded, props, ...view }
}

const trigger = () => screen.getByRole('combobox', { name: 'The session works in' })
const search = () => screen.getByRole('combobox', { name: 'Search projects and repos' })
const options = () => screen.getAllByRole('option').map(option => option.textContent)

describe('ProjectPicker', () => {
  test('as a button that adds a project (the first steps): its words on it, and no "no project" row, only what can be added', async () => {
    renderPicker({ look: 'add', none: { label: 'Add a project' }, projects: [] })
    await openMenu(screen.getByRole('combobox', { name: 'Add a project' }))
    await screen.findByRole('option', { name: /vike/ })
    expect(options()).toEqual(['vikegithub.com/vikejs/vike', 'notes/home/me/notes'])
  })

  test('a repo\'s address is said as its host and path, over https or ssh, and never with a login in it', () => {
    expect(shownAddress('https://github.com/vikejs/vike.git')).toBe('github.com/vikejs/vike')
    expect(shownAddress('git@github.com:vikejs/vike.git')).toBe('github.com/vikejs/vike')
    expect(shownAddress('ssh://git@gitlab.com/team/app')).toBe('gitlab.com/team/app')
    expect(shownAddress('https://me:ghp_secret@github.com/me/private.git')).toBe('github.com/me/private')
  })

  test("a repo is said by its address at its host, or by its folder when its remote is a folder too", () => {
    expect(repoDetail({ path: '/home/me/oss/vike', url: 'git@github.com:vikejs/vike.git' })).toBe('github.com/vikejs/vike')
    expect(repoDetail({ path: '/home/me/blog', url: '/srv/git/blog.git' })).toBe('/home/me/blog')
    expect(repoDetail({ path: '/home/me/blog', url: 'file:///srv/git/blog.git' })).toBe('/home/me/blog')
    expect(repoDetail({ path: '/home/me/notes' })).toBe('/home/me/notes')
  })

  test('the button reads where the session works: no project, or the project by its name', () => {
    renderPicker()
    expect(trigger().textContent).toBe('No project')
    cleanup()
    renderPicker({ picked: 'alpha-1', pickedName: 'alpha' })
    expect(trigger().textContent).toBe('alpha')
  })

  test('in the sidebar: the same menu under a full-width button that names the project every page shows, or all of them; a bar while the one the address names is not read', async () => {
    const { rerender, props } = renderPicker({ look: 'sidebar', none: { label: 'All projects' } })
    expect(screen.getByRole('combobox', { name: 'Project: All projects' }).textContent).toBe('All projects')
    rerender(<ProjectPicker {...props} look="sidebar" none={{ label: 'All projects' }} picked="alpha-1" />)
    expect(screen.getByRole('combobox', { name: 'Project: alpha' }).textContent).toBe('alpha')
    await openMenu(screen.getByRole('combobox', { name: 'Project: alpha' }))
    await screen.findByRole('option', { name: /vike/ })
    expect(options()).toEqual(['All projects', 'alpha', 'vikegithub.com/vikejs/vike', 'notes/home/me/notes'])
    fireEvent.click(screen.getByRole('option', { name: 'All projects' }))
    expect(props.onPick).toHaveBeenLastCalledWith(null)
    rerender(<ProjectPicker {...props} look="sidebar" none={{ label: 'All projects' }} picked="alpha-1" pending />)
    expect((screen.getByRole('combobox', { name: 'Project: loading' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test("a project's row says what is wrong with it, that it is not activated, how its records are kept, or which other computer of the person's has it", async () => {
    const stranded: ProjectSummary = { ...ALPHA, errors: [{ code: 'data-sync', message: 'the data branch could not be pushed: Permission denied (publickey)', since: '2026-08-20T10:00:00.000Z' }] }
    const idle: ProjectSummary = { id: 'beta-2', path: '/home/me/beta', name: 'beta', activated: false, gitHost: true }
    const local: ProjectSummary = { id: 'gamma-3', path: '/home/me/gamma', name: 'gamma', activated: true, gitHost: true, local: 'no-remote' }
    const kept: ProjectSummary = { id: 'delta-4', path: '/home/me/delta', name: 'delta', activated: true, gitHost: true, local: 'kept' }
    const there: ProjectSummary = { id: 'test-project-2~abc', path: '/Users/me/test-project', name: 'test-project', activated: true, gitHost: true, machine: MACBOOK.id }
    renderPicker({ projects: [stranded, idle, local, kept, there] })
    await openMenu(trigger())
    const broken = screen.getByRole('option', { name: /alpha/ })
    expect(broken.querySelector('.bg-danger')).toBeTruthy()
    expect(within(broken).getByText('Not syncing with the remote').getAttribute('title')).toContain('Permission denied (publickey)')
    expect(within(screen.getByRole('option', { name: /beta/ })).getByText('Not activated')).toBeTruthy()
    expect(within(screen.getByRole('option', { name: /gamma/ })).getByText('Local only, no remote').className).toContain('text-muted-foreground')
    expect(within(screen.getByRole('option', { name: /delta/ })).getByText('Records kept on this machine')).toBeTruthy()
    expect(within(screen.getByRole('option', { name: /test-project/ })).getByText('on Suleimans-MacBook-Pro')).toBeTruthy()
    expect(within(screen.getByRole('option', { name: /gamma/ })).queryByText(/^on /)).toBeNull()
  })

  test("a repository's address typed into the search is offered to add, unless a project or repo has it; picked, the trust question says where it is cloned to, and on a yes it is a project", async () => {
    onCloneTarget.mockResolvedValue({ ok: true, address: 'github.com/ada/shop', path: '/home/me/projects/shop' })
    sendAddProjectFromAddress.mockResolvedValue({ ok: true, alreadyActivated: false, path: '/home/me/projects/shop' })
    const { onPick, onProjectAdded, props, rerender } = renderPicker()
    await openMenu(trigger())
    await screen.findByRole('option', { name: /vike/ })
    fireEvent.change(search(), { target: { value: 'github.com/vikejs/vike' } })
    expect(options()).toEqual(['vikegithub.com/vikejs/vike'])
    fireEvent.change(search(), { target: { value: 'ada/shop' } })
    expect(screen.queryAllByRole('option')).toEqual([])
    fireEvent.change(search(), { target: { value: 'https://github.com/ada/shop' } })
    expect(options()).toEqual(['Add github.com/ada/shopCloned to this computer, as a project'])
    fireEvent.click(screen.getByRole('option', { name: /Add github.com\/ada\/shop/ }))
    expect(await screen.findByText('Do you trust this repository?')).toBeTruthy()
    await waitFor(() => expect(onCloneTarget).toHaveBeenCalledWith('https://github.com/ada/shop'))
    expect(screen.getByText('/home/me/projects/shop')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, clone and add it' }))
    await waitFor(() => expect(sendAddProjectFromAddress).toHaveBeenCalledWith('https://github.com/ada/shop'))
    await waitFor(() => expect(onProjectAdded).toHaveBeenCalledTimes(1))
    rerender(<ProjectPicker {...props} projects={[ALPHA, { id: 'shop-5', path: '/home/me/projects/shop', name: 'shop', activated: true, gitHost: true }]} />)
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('shop-5'))
  })

  test("the git hosts' repos follow the ones on this computer, with their address and why they are listed; picked, one is cloned the way a typed address is", async () => {
    onRepos.mockResolvedValue({
      repos: [VIKE, NOTES],
      hosted: [
        { address: 'github.com/octo-agent/shop', url: 'https://github.com/octo-agent/shop', private: true, from: '@octo-agent' },
        { address: 'github.com/vikejs/bati', url: 'https://github.com/vikejs/bati', private: false, description: 'Scaffolder', from: 'vikejs' },
      ],
      reposLoading: false,
      hostedLoading: false,
      canAddFolder: false,
    })
    onCloneTarget.mockResolvedValue({ ok: true, address: 'github.com/vikejs/bati', path: '/home/me/projects/bati' })
    renderPicker()
    await openMenu(trigger())
    await screen.findByRole('option', { name: /bati/ })
    expect(options()).toEqual(['No project', 'alpha', 'vikegithub.com/vikejs/vike', 'notes/home/me/notes', 'octo-agent/shopPrivate · Not on this computer · @octo-agent', 'vikejs/batiNot on this computer · vikejs'])
    // Found by its description too; its address is no "Add" row.
    fireEvent.change(search(), { target: { value: 'scaffold' } })
    expect(options()).toEqual(['vikejs/batiNot on this computer · vikejs'])
    fireEvent.change(search(), { target: { value: 'github.com/vikejs/bati' } })
    expect(options()).toEqual(['vikejs/batiNot on this computer · vikejs'])
    fireEvent.click(screen.getByRole('option', { name: /vikejs\/bati/ }))
    expect(await screen.findByText('Do you trust this repository?')).toBeTruthy()
    await waitFor(() => expect(onCloneTarget).toHaveBeenCalledWith('github.com/vikejs/bati'))
  })

  test('a git host that could not be reached is said so, under the repos that are listed', async () => {
    onRepos.mockResolvedValue({ repos: [VIKE], hosted: [], reposLoading: false, hostedLoading: false, hostedUnreached: true, canAddFolder: false })
    renderPicker()
    await openMenu(trigger())
    expect(await screen.findByText('GitHub could not be reached: its repos are not listed.')).toBeTruthy()
    expect(screen.getByRole('option', { name: /vike/ })).toBeTruthy()
  })

  test("while the git hosts are being asked, the menu says so and asks again", async () => {
    onRepos.mockResolvedValue({ repos: [VIKE], hosted: [], reposLoading: false, hostedLoading: true, canAddFolder: false })
    renderPicker()
    await openMenu(trigger())
    expect(await screen.findByText('Asking GitHub for repos…')).toBeTruthy()
    const before = onRepos.mock.calls.length
    onRepos.mockResolvedValue({ repos: [VIKE], hosted: [{ address: 'github.com/octo/app', url: 'https://github.com/octo/app', private: false, from: '@octo' }], reposLoading: false, hostedLoading: false, canAddFolder: false })
    await waitFor(() => expect(onRepos.mock.calls.length).toBeGreaterThan(before), { timeout: 4000 })
    expect(await screen.findByRole('option', { name: /octo\/app/ })).toBeTruthy()
    expect(screen.queryByText('Asking GitHub for repos…')).toBeNull()
  })

  test('while the look through this computer is still on its way, the menu says so and asks again', async () => {
    onRepos.mockResolvedValue({ repos: [], hosted: [], reposLoading: true, hostedLoading: false, canAddFolder: false })
    renderPicker()
    await openMenu(trigger())
    expect(await screen.findByText('Looking for repos on this computer…')).toBeTruthy()
    const before = onRepos.mock.calls.length
    onRepos.mockResolvedValue({ repos: [VIKE], hosted: [], reposLoading: false, hostedLoading: false, canAddFolder: false })
    await waitFor(() => expect(onRepos.mock.calls.length).toBeGreaterThan(before), { timeout: 4000 })
    expect(await screen.findByRole('option', { name: /vike/ })).toBeTruthy()
    expect(screen.queryByText('Looking for repos on this computer…')).toBeNull()
  })

  test('the repos are read as the page opens, before the menu is: the crawl behind them has run by then', async () => {
    renderPicker()
    await waitFor(() => expect(onRepos).toHaveBeenCalledTimes(1))
  })

  test('the menu lists no project, the projects, then the repos that are not projects, each with its address or its folder', async () => {
    renderPicker()
    await openMenu(trigger())
    await screen.findByRole('option', { name: /vike/ })
    expect(options()).toEqual(['No project', 'alpha', 'vikegithub.com/vikejs/vike', 'notes/home/me/notes'])
    expect(screen.getByText('Projects')).toBeTruthy()
    expect(screen.getByText('Repos')).toBeTruthy()
  })

  test('the search finds a repo by its name, its folder or its address, and a project by its name', async () => {
    renderPicker()
    await openMenu(trigger())
    await screen.findByRole('option', { name: /vike/ })
    fireEvent.change(search(), { target: { value: 'VIKEJS' } })
    expect(options()).toEqual(['vikegithub.com/vikejs/vike'])
    fireEvent.change(search(), { target: { value: 'me/notes' } })
    expect(options()).toEqual(['notes/home/me/notes'])
    fireEvent.change(search(), { target: { value: 'alp' } })
    expect(options()).toEqual(['alpha'])
    fireEvent.change(search(), { target: { value: 'no-such-repo' } })
    expect(screen.queryAllByRole('option')).toEqual([])
    expect(screen.getByText('No project or repo by that name.')).toBeTruthy()
  })

  test('the first match of a search is highlighted, so Enter picks it', async () => {
    const { onPick } = renderPicker()
    await openMenu(trigger())
    await screen.findByRole('option', { name: /vike/ })
    // Typed, as a person types: the combobox highlights on an input that carries its input type.
    fireEvent.input(search(), { target: { value: 'alp' }, inputType: 'insertText' })
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith('alpha-1')
  })

  test('with nothing typed only the first repos are listed, and the search reaches the rest', async () => {
    const many = Array.from({ length: REPOS_SHOWN + 5 }, (_, i) => ({ path: `/home/me/r${i}`, name: `r${i}` }))
    onRepos.mockResolvedValue({ repos: many, hosted: [], reposLoading: false, hostedLoading: false, canAddFolder: false })
    renderPicker({ projects: [] })
    await openMenu(trigger())
    await screen.findByRole('option', { name: /^r0/ })
    expect(options()).toHaveLength(1 + REPOS_SHOWN)
    expect(screen.getByText(`Search to see more of the ${REPOS_SHOWN + 5} repos.`)).toBeTruthy()
    // No folder dialog on this computer: nothing offers one.
    expect(screen.queryByText('Search another folder…')).toBeNull()
    fireEvent.change(search(), { target: { value: `r${REPOS_SHOWN + 4}` } })
    expect(options()).toEqual([`r${REPOS_SHOWN + 4}/home/me/r${REPOS_SHOWN + 4}`])
  })

  test('a project opens its page, and no project the page of a session with none', async () => {
    const { onPick } = renderPicker({ picked: 'alpha-1', pickedName: 'alpha' })
    await openMenu(trigger())
    // The pick is the tick at the row's end; the other rows carry none.
    expect(screen.getByRole('option', { name: 'alpha' }).lastElementChild!.classList.contains('lucide-check')).toBe(true)
    expect(screen.getByRole('option', { name: 'No project' }).lastElementChild!.classList.contains('lucide-check')).toBe(false)
    fireEvent.click(await screen.findByRole('option', { name: 'No project' }))
    expect(onPick).toHaveBeenLastCalledWith(null)
    cleanup()
    const second = renderPicker()
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: 'alpha' }))
    expect(second.onPick).toHaveBeenLastCalledWith('alpha-1')
  })

  test('a repo is asked the trust question for its folder; on a yes it is a project, and once the projects have it, its page opens', async () => {
    sendAddProject.mockResolvedValue({ ok: true, alreadyActivated: false })
    const { onPick, onProjectAdded, props, rerender } = renderPicker()
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: /vike/ }))
    expect(onPick).not.toHaveBeenCalled()
    expect(await screen.findByText('Do you trust this repository?')).toBeTruthy()
    expect(screen.getByText(VIKE.path)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, add it' }))
    await waitFor(() => expect(sendAddProject).toHaveBeenCalledWith(VIKE.path))
    await waitFor(() => expect(onProjectAdded).toHaveBeenCalledTimes(1))
    expect(onPick).not.toHaveBeenCalled()
    rerender(<ProjectPicker {...props} projects={[ALPHA, { id: 'vike-9', path: VIKE.path, name: 'vike', activated: true, gitHost: true }]} />)
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('vike-9'))
    expect(screen.queryByText('Do you trust this repository?')).toBeNull()
  })

  test('a repo the person does not trust stays a repo: Cancel adds nothing and opens nothing', async () => {
    const { onPick } = renderPicker()
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: /notes/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Do you trust this repository?')).toBeNull()
    expect(sendAddProject).not.toHaveBeenCalled()
    expect(onPick).not.toHaveBeenCalled()
  })

  test('the trust question closed, by Escape or a yes, gives focus back to the picker', async () => {
    sendAddProject.mockResolvedValue({ ok: true, alreadyActivated: false })
    renderPicker()
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: /notes/ }))
    fireEvent.keyDown(await screen.findByText('Do you trust this repository?'), { key: 'Escape' })
    expect(screen.queryByText('Do you trust this repository?')).toBeNull()
    expect(document.activeElement).toBe(trigger())
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: /notes/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'I trust it, add it' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
    expect(document.activeElement).toBe(trigger())
  })

  test('"Search another folder…" adds a folder to look in, and the repos are read again', async () => {
    sendAddRepoFolder.mockResolvedValue({ ok: true, added: true })
    renderPicker()
    await openMenu(trigger())
    await screen.findByRole('option', { name: /vike/ })
    const before = onRepos.mock.calls.length
    onRepos.mockResolvedValue({ repos: [VIKE, NOTES, { path: '/work/client', name: 'client' }], hosted: [], reposLoading: false, hostedLoading: false, canAddFolder: true })
    fireEvent.click(screen.getByText('Search another folder…'))
    await waitFor(() => expect(sendAddRepoFolder).toHaveBeenCalledTimes(1))
    await screen.findByRole('option', { name: /client/ })
    expect(onRepos.mock.calls.length).toBe(before + 1)
  })
})
