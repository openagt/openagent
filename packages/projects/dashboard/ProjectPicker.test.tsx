import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { fakeHost, mountedOf, renderWithHost, ShellProjectsContext, type MountedModules } from '@openagt/ui/module/testing'
import { forgetRemembered, type ProjectSummary, type UiWhereRepo } from '@openagt/ui/module'

const readRepos = vi.hoisted(() => vi.fn())
const addFolderToSearch = vi.hoisted(() => vi.fn())
const addProject = vi.hoisted(() => vi.fn())
const cloneTargetFor = vi.hoisted(() => vi.fn())
const addFromAddress = vi.hoisted(() => vi.fn())
vi.mock('./calls.js', () => ({
  readRepos: () => readRepos(),
  addFolderToSearch: () => addFolderToSearch(),
  addProject: (_host: unknown, path: string) => addProject(path),
  pickDirectory: vi.fn(),
  cloneTargetFor: (_host: unknown, address: string) => cloneTargetFor(address),
  addFromAddress: (_host: unknown, address: string) => addFromAddress(address),
}))

const { ProjectControl, ProjectPicker, REPOS_SHOWN, SidebarProject, agentPicksDetail, repoDetail, shownAddress } = await import('./ProjectPicker.js')
const { default: projectsUi } = await import('./index.js')

const ALPHA: ProjectSummary = { id: 'alpha-1', path: '/home/me/alpha', name: 'alpha' }
const VIKE = { path: '/home/me/oss/vike', name: 'vike', url: 'https://github.com/vikejs/vike.git' }
const NOTES = { path: '/home/me/notes', name: 'notes' }

/** This computer's repos as the module's server answers them. */
const reposRead = (repos: { path: string; name: string; url?: string }[], over: { loading?: boolean; canAddFolder?: boolean } = {}) => ({ repos, loading: false, canAddFolder: true, projects: [], ...over })

beforeEach(() => {
  readRepos.mockResolvedValue(reposRead([VIKE, NOTES]))
})
afterEach(() => {
  cleanup()
  forgetRemembered()
  vi.clearAllMocks()
})

const NO_PROJECT = { label: 'No project', tip: 'The session works in a folder of its own' }

/** The repos a module offers (`composer.where`), mounted as the dashboard mounts a computer's module's. */
type Where = { id: string; label: string; loadingWords?: string; repos: () => Promise<{ repos: UiWhereRepo[]; loading?: boolean; unreached?: string }> }

/** The modules beside the picker: this one's repos on this computer, and any other module's `where`. */
function modulesWith(...others: Where[]): MountedModules {
  const own = (projectsUi.hooks['ui.option'] ?? []).filter(option => option.place === 'composer.where').map(option => ({ ...option, package: '@openagt/projects', projects: [], computer: true as const }))
  const more = others.map((where, i) => ({ place: 'composer.where' as const, order: 10 + i, ...where, package: '@openagt/github', projects: [], computer: true as const }))
  return mountedOf({ options: { 'composer.where': [...own, ...more] } })
}

type PickerProps = Parameters<typeof ProjectPicker>[0]

function renderPicker(over: Partial<PickerProps> & { projects?: ProjectSummary[]; where?: Where[] } = {}) {
  const onPick = vi.fn()
  const { projects = [ALPHA], where = [], ...rest } = over
  const props: PickerProps = { none: NO_PROJECT, picked: null, busy: false, onPick, ...rest }
  const modules = modulesWith(...where)
  const shell = (ui: ReactElement, listed: ProjectSummary[]) => <ShellProjectsContext.Provider value={listed}>{ui}</ShellProjectsContext.Provider>
  const view = renderWithHost(shell(<ProjectPicker {...props} />, projects), fakeHost('@openagt/projects'), modules)
  const rerender = (next: Partial<PickerProps> & { projects?: ProjectSummary[] }) => {
    const { projects: listed = projects, ...nextProps } = next
    view.rerender(shell(<ProjectPicker {...props} {...nextProps} />, listed))
  }
  return { onPick, props, rerender }
}

/** Open the menu `trigger` opens, as a person's press does. */
async function openMenu(trigger: Element): Promise<void> {
  await waitFor(() => {
    if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger)
    if (trigger.getAttribute('aria-expanded') !== 'true') throw new Error('the menu did not open')
  })
}

const trigger = () => screen.getByRole('combobox', { name: 'The session works in' })
const search = () => screen.getByRole('combobox', { name: 'Search projects and repos' })
/** A row's words, a cut path once: its drawn halves, hidden beside the whole of it said to a screen reader, left out. */
const said = (row: Element) => {
  const copy = row.cloneNode(true) as Element
  for (const hidden of copy.querySelectorAll('.sr-only + [aria-hidden="true"]')) hidden.remove()
  return copy.textContent
}
const options = () => screen.getAllByRole('option').map(said)

/** A git host's repos as the github module offers them: by address, not on this computer. */
const GITHUB = (repos: UiWhereRepo[], more: { loading?: boolean; unreached?: string } = {}): Where => ({ id: 'github', label: 'On GitHub', loadingWords: 'Asking GitHub for repos…', repos: async () => ({ repos, ...more }) })

describe('ProjectPicker', () => {
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

  test("the agent's pick: the button says it short with its mark; its row in the list says it whole, with the projects it picks from and that it asks", async () => {
    const none = { label: 'Agent picks', tip: 'The agent picks the project your task needs', row: { label: 'Agent picks the project', detail: agentPicksDetail(['alpha']) }, agent: true }
    renderPicker({ none })
    expect(trigger().textContent).toBe('Agent picks')
    expect(trigger().querySelector('.lucide-sparkles')).not.toBeNull()
    await openMenu(trigger())
    const row = await screen.findByRole('option', { name: /^Agent picks the project/ })
    expect(row.textContent).toContain('From alpha, by your task. It asks you when it can\u2019t tell.')
    expect(row.querySelector('.lucide-sparkles')).not.toBeNull()
    expect(agentPicksDetail(['shop', 'blog'])).toBe('From shop and blog, by your task. It asks you when it can\u2019t tell.')
    expect(agentPicksDetail(['a', 'b', 'c', 'd', 'e'])).toBe('From a, b, c and 2 more, by your task. It asks you when it can\u2019t tell.')
    expect(agentPicksDetail([])).toBe('From the projects you add, by your task. It asks you when it can\u2019t tell.')
  })

  test('the button reads where the session works: no project, or the project by its name', () => {
    renderPicker()
    expect(trigger().textContent).toBe('No project')
    cleanup()
    renderPicker({ picked: 'alpha-1' })
    expect(trigger().textContent).toBe('alpha')
  })

  test("a project's row says what is wrong with it, that it is not activated, or what the modules note of it", async () => {
    const stranded: ProjectSummary = { ...ALPHA, errors: [{ id: 'store-git-branch:data-sync', title: 'Not syncing with the remote', message: 'the data branch could not be pushed: Permission denied (publickey)', since: '2026-08-20T10:00:00.000Z' }] }
    const idle: ProjectSummary = { id: 'beta-2', path: '/home/me/beta', name: 'beta', notes: [{ id: 'projects:not-activated', words: 'Not activated' }] }
    const local: ProjectSummary = { id: 'gamma-3', path: '/home/me/gamma', name: 'gamma', notes: [{ id: 'store-filesystem:data-here', words: 'Local only, no remote' }] }
    const kept: ProjectSummary = { id: 'delta-4', path: '/home/me/delta', name: 'delta', notes: [{ id: 'store-filesystem:data-here', words: 'Records kept on this machine' }] }
    renderPicker({ projects: [stranded, idle, local, kept] })
    await openMenu(trigger())
    const broken = screen.getByRole('option', { name: /alpha/ })
    expect(broken.querySelector('.bg-danger')).toBeTruthy()
    expect(within(broken).getByText('Not syncing with the remote').getAttribute('title')).toContain('Permission denied (publickey)')
    expect(within(screen.getByRole('option', { name: /beta/ })).getByText('Not activated').className).toContain('text-muted-foreground')
    expect(within(screen.getByRole('option', { name: /gamma/ })).getByText('Local only, no remote').className).toContain('text-muted-foreground')
    expect(within(screen.getByRole('option', { name: /delta/ })).getByText('Records kept on this machine')).toBeTruthy()
  })

  test("a repository's address typed into the search is offered to add, unless a project or repo has it; picked, the trust question says where it is cloned to, and on a yes it is a project", async () => {
    cloneTargetFor.mockResolvedValue({ ok: true, address: 'github.com/ada/shop', path: '/home/me/projects/shop' })
    addFromAddress.mockResolvedValue({ ok: true, alreadyActivated: false, path: '/home/me/projects/shop' })
    const { onPick, rerender } = renderPicker()
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
    await waitFor(() => expect(cloneTargetFor).toHaveBeenCalledWith('https://github.com/ada/shop'))
    expect(screen.getByTitle('/home/me/projects/shop')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, clone and add it' }))
    await waitFor(() => expect(addFromAddress).toHaveBeenCalledWith('https://github.com/ada/shop'))
    await screen.findByText('Project added')
    rerender({ projects: [ALPHA, { id: 'shop-5', path: '/home/me/projects/shop', name: 'shop' }] })
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('shop-5'))
    // Picked, it still says it was added, until Done.
    expect(screen.getByRole('status').textContent).toBe('Project added')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog', { name: 'Add project' })).toBeNull()
  })

  test("another module's repos follow the ones on this computer, under its own heading; one only at an address is listed once, by its folder where this computer has it; picked, it is cloned the way a typed address is", async () => {
    cloneTargetFor.mockResolvedValue({ ok: true, address: 'github.com/vikejs/bati', path: '/home/me/projects/bati' })
    const hosted: UiWhereRepo[] = [
      { address: 'github.com/octo-agent/shop', label: 'octo-agent/shop', private: true, why: '@octo-agent' },
      { address: 'github.com/vikejs/bati', label: 'vikejs/bati', detail: 'Scaffolder', why: 'vikejs' },
      { address: 'github.com/vikejs/vike', label: 'vikejs/vike', why: 'vikejs' },
    ]
    renderPicker({ where: [GITHUB(hosted)] })
    await openMenu(trigger())
    await screen.findByRole('option', { name: /bati/ })
    expect(options()).toEqual(['No project', 'alpha', 'vikegithub.com/vikejs/vike', 'notes/home/me/notes', 'octo-agent/shopPrivate·Not on this computer·@octo-agent', 'vikejs/batiNot on this computer·vikejs'])
    expect(screen.getByText('On GitHub')).toBeTruthy()
    // Found by its description too; its address is no "Add" row.
    fireEvent.change(search(), { target: { value: 'scaffold' } })
    expect(options()).toEqual(['vikejs/batiNot on this computer·vikejs'])
    fireEvent.change(search(), { target: { value: 'github.com/vikejs/bati' } })
    expect(options()).toEqual(['vikejs/batiNot on this computer·vikejs'])
    fireEvent.click(screen.getByRole('option', { name: /vikejs\/bati/ }))
    expect(await screen.findByText('Do you trust this repository?')).toBeTruthy()
    await waitFor(() => expect(cloneTargetFor).toHaveBeenCalledWith('github.com/vikejs/bati'))
  })

  test("a module's repos that could not all be read are said so, under the repos that are listed, and one whose read fails says it in its own words", async () => {
    const broken: Where = { id: 'broken', label: 'On GitLab', repos: async () => Promise.reject(new Error('down')) }
    renderPicker({ where: [GITHUB([], { unreached: 'GitHub could not be reached: its repos are not listed.' }), broken] })
    await openMenu(trigger())
    expect(await screen.findByText('GitHub could not be reached: its repos are not listed.')).toBeTruthy()
    expect(screen.getByText('On GitLab could not be read: its repos are not listed.')).toBeTruthy()
    expect(screen.getByRole('option', { name: /vike/ })).toBeTruthy()
  })

  test("while a module's repos are being read, the menu says so in its words and asks again", async () => {
    const asked = vi.fn(async () => ({ repos: [] as UiWhereRepo[], loading: true }))
    renderPicker({ where: [{ ...GITHUB([]), repos: asked }] })
    await openMenu(trigger())
    expect(await screen.findByText('Asking GitHub for repos…')).toBeTruthy()
    const before = asked.mock.calls.length
    asked.mockResolvedValue({ repos: [{ address: 'github.com/octo/app', label: 'octo/app', why: '@octo' }], loading: false })
    await waitFor(() => expect(asked.mock.calls.length).toBeGreaterThan(before), { timeout: 4000 })
    expect(await screen.findByRole('option', { name: /octo\/app/ })).toBeTruthy()
    expect(screen.queryByText('Asking for the repos on GitHub…')).toBeNull()
  })

  test('while the look through this computer is still on its way, the menu says so and asks again', async () => {
    readRepos.mockResolvedValue(reposRead([], { loading: true, canAddFolder: false }))
    renderPicker()
    await openMenu(trigger())
    expect(await screen.findByText('Looking for repos on this computer…')).toBeTruthy()
    const before = readRepos.mock.calls.length
    readRepos.mockResolvedValue(reposRead([VIKE], { canAddFolder: false }))
    await waitFor(() => expect(readRepos.mock.calls.length).toBeGreaterThan(before), { timeout: 4000 })
    expect(await screen.findByRole('option', { name: /vike/ })).toBeTruthy()
    expect(screen.queryByText('Looking for repos on this computer…')).toBeNull()
  })

  test('the repos are read as the page opens, before the menu is: the crawl behind them has run by then', async () => {
    renderPicker()
    await waitFor(() => expect(readRepos).toHaveBeenCalled())
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
    readRepos.mockResolvedValue(reposRead(many, { canAddFolder: false }))
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
    const { onPick } = renderPicker({ picked: 'alpha-1' })
    await openMenu(trigger())
    // The pick is the tick at the row's end; the other rows carry none.
    expect(screen.getByRole('option', { name: 'alpha' }).lastElementChild!.querySelector('.lucide-check') !== null).toBe(true)
    expect(screen.getByRole('option', { name: 'No project' }).lastElementChild!.querySelector('.lucide-check') !== null).toBe(false)
    fireEvent.click(await screen.findByRole('option', { name: 'No project' }))
    expect(onPick).toHaveBeenLastCalledWith(null)
    cleanup()
    const second = renderPicker()
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: 'alpha' }))
    expect(second.onPick).toHaveBeenLastCalledWith('alpha-1')
  })

  test('a repo is asked the trust question for its folder; on a yes it is a project, and once the projects have it, its page opens', async () => {
    addProject.mockResolvedValue({ ok: true, alreadyActivated: false })
    const { onPick, rerender } = renderPicker()
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: /vike/ }))
    expect(onPick).not.toHaveBeenCalled()
    expect(await screen.findByText('Do you trust this repository?')).toBeTruthy()
    expect(screen.getByTitle(VIKE.path)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, add it' }))
    await waitFor(() => expect(addProject).toHaveBeenCalledWith(VIKE.path))
    await screen.findByText('Project added')
    expect(onPick).not.toHaveBeenCalled()
    rerender({ projects: [ALPHA, { id: 'vike-9', path: VIKE.path, name: 'vike' }] })
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('vike-9'))
    expect(screen.queryByText('Do you trust this repository?')).toBeNull()
  })

  test('a project added is picked once the projects read again have it, after its panel has gone too, unless another was picked meanwhile', async () => {
    addProject.mockResolvedValue({ ok: true, alreadyActivated: false })
    const VIKE_PROJECT = { id: 'vike-9', path: VIKE.path, name: 'vike' }
    const { onPick, rerender } = renderPicker()
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: /vike/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'I trust it, add it' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog', { name: 'Add project' })).toBeNull()
    rerender({ projects: [ALPHA, VIKE_PROJECT] })
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('vike-9'))
    cleanup()
    // alpha opened before the projects are read again: alpha stays.
    const second = renderPicker()
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: /vike/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'I trust it, add it' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
    second.rerender({ picked: 'alpha-1' })
    second.rerender({ picked: 'alpha-1', projects: [ALPHA, VIKE_PROJECT] })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(second.onPick).not.toHaveBeenCalled()
  })

  test('a repo the person does not trust stays a repo: Cancel adds nothing and opens nothing', async () => {
    const { onPick } = renderPicker()
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: /notes/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Do you trust this repository?')).toBeNull()
    expect(addProject).not.toHaveBeenCalled()
    expect(onPick).not.toHaveBeenCalled()
  })

  test('the trust question closed, by Escape or a yes, gives focus back to the picker', async () => {
    addProject.mockResolvedValue({ ok: true, alreadyActivated: false })
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
    addFolderToSearch.mockResolvedValue({ ok: true, added: true })
    renderPicker()
    await openMenu(trigger())
    await screen.findByRole('option', { name: /vike/ })
    readRepos.mockResolvedValue(reposRead([VIKE, NOTES, { path: '/work/client', name: 'client' }]))
    fireEvent.click(screen.getByText('Search another folder…'))
    await waitFor(() => expect(addFolderToSearch).toHaveBeenCalledTimes(1))
    await screen.findByRole('option', { name: /client/ })
  })

  test("the launcher's control is the picker, a pick moving the launcher; a session's box says its project in the same place, no menu; a profile's has none", async () => {
    const pickProject = vi.fn()
    const control = (props: Record<string, unknown>) =>
      renderWithHost(
        <ShellProjectsContext.Provider value={[ALPHA]}>
          <ProjectControl {...({ in: 'launcher', projectId: 'alpha-1', busy: false, pickProject, ...props } as unknown as Parameters<typeof ProjectControl>[0])} />
        </ShellProjectsContext.Provider>,
        fakeHost('@openagt/projects'),
        modulesWith(),
      )
    control({})
    expect(trigger().textContent).toBe('alpha')
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: /^Agent picks the project/ }))
    expect(pickProject).toHaveBeenLastCalledWith(undefined)
    cleanup()
    control({ in: 'session' })
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('alpha')).toBeTruthy()
    cleanup()
    control({ in: 'session', projectId: undefined })
    expect(screen.queryByText('alpha')).toBeNull()
    cleanup()
    control({ pickProject: undefined })
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})

describe('SidebarProject', () => {
  const STRANDED: ProjectSummary = { id: 'p1', path: '/repos/p1', name: 'stranded', errors: [{ id: 'x', title: 'Not syncing with the remote', message: 'Permission denied (publickey)', since: '2026-08-20T10:00:00.000Z' }] }

  function renderSelect(picked: string | null, over: { pending?: boolean; projects?: ProjectSummary[] } = {}) {
    const onPick = vi.fn()
    const { projects = [ALPHA, STRANDED], pending = false } = over
    const ui = (listed: ProjectSummary[]) => (
      <ShellProjectsContext.Provider value={listed}>
        <SidebarProject picked={picked} pending={pending} onPick={onPick} />
      </ShellProjectsContext.Provider>
    )
    const view = renderWithHost(ui(projects), fakeHost('@openagt/projects'), modulesWith(GITHUB([{ label: 'suleimansh/agent', address: 'github.com/suleimansh/agent', private: true }])))
    return { onPick, rerender: (listed: ProjectSummary[]) => view.rerender(ui(listed)) }
  }

  test('the sidebar\'s select names the picked project, or "All projects"; while the project is not read, a bar where its name goes', () => {
    renderSelect('p1')
    expect(screen.getByRole('combobox', { name: 'Project: stranded' }).querySelector('.bg-danger')).toBeTruthy()
    cleanup()
    renderSelect(null)
    expect(screen.getByRole('combobox', { name: 'Project: All projects' }).textContent).toBe('All projects')
    cleanup()
    renderSelect(null, { pending: true })
    const loading = screen.getByRole('combobox', { name: 'Project: loading' })
    expect(loading.textContent).toBe('')
    expect(screen.queryByText('All projects')).toBeNull()
  })

  test('its menu is the launcher\'s: every project first, the projects, the repos on this computer and those on GitHub, and "Search another folder…"; a pick of a project or of all reports it', async () => {
    const { onPick } = renderSelect('alpha-1')
    await openMenu(screen.getByRole('combobox', { name: 'Project: alpha' }))
    await screen.findByRole('option', { name: /suleimansh\/agent/ })
    expect(options()).toEqual(['All projects', 'alpha', 'strandedNot syncing with the remote', 'vikegithub.com/vikejs/vike', 'notes/home/me/notes', 'suleimansh/agentPrivate·Not on this computer'])
    expect(screen.getByRole('option', { name: /alpha/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: 'Search another folder…' })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: /stranded/ }))
    await openMenu(screen.getByRole('combobox', { name: 'Project: alpha' }))
    fireEvent.click(screen.getByRole('option', { name: /All projects/ }))
    expect(onPick.mock.calls).toEqual([['p1'], [null]])
  })

  test('a repo picked there is asked the trust question, and once it is a project, it is the one shown', async () => {
    addProject.mockResolvedValue({ ok: true, alreadyActivated: false })
    const { onPick, rerender } = renderSelect(null)
    await openMenu(screen.getByRole('combobox', { name: 'Project: All projects' }))
    fireEvent.click(await screen.findByRole('option', { name: /vike/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'I trust it, add it' }))
    await waitFor(() => expect(addProject).toHaveBeenCalledWith(VIKE.path))
    rerender([ALPHA, STRANDED, { id: 'vike-9', path: VIKE.path, name: 'vike' }])
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('vike-9'))
  })
})

test("what one press brings up (a folder behind main) is said quietly, with the plain dot; what is wrong stays red", async () => {
  const behind: ProjectSummary = { id: 'b', path: '/home/me/behind', name: 'behind', errors: [{ id: 'git-branches:folder-behind', title: 'This project’s folder is 25 commits behind main.', fixed: true }] }
  const broken: ProjectSummary = { id: 'x', path: '/home/me/broken', name: 'broken', errors: [{ id: 'store:sync', title: 'Not syncing with the remote' }] }
  renderPicker({ projects: [behind, broken] })
  await openMenu(trigger())
  const quiet = await screen.findByText('This project’s folder is 25 commits behind main.')
  expect(quiet.className).toContain('text-muted-foreground')
  expect(screen.getByRole('option', { name: /behind/ }).querySelector('.bg-danger')).toBeNull()
  expect(screen.getByText('Not syncing with the remote').className).toContain('text-danger')
  expect(screen.getByRole('option', { name: /broken/ }).querySelector('.bg-danger')).not.toBeNull()
})
