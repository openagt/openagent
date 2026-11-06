import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { openMenu } from '../test-utils.js'
import { forgetRemembered } from '../lib/use-async.js'
import type { ProjectSummary } from '../../src/index.js'

const onRepos = vi.hoisted(() => vi.fn())
const sendAddRepoFolder = vi.hoisted(() => vi.fn())
const sendAddProject = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onRepos, sendAddRepoFolder, sendAddProject, sendPickProjectDirectory: vi.fn(), onCloneTarget: vi.fn(), sendAddProjectFromAddress: vi.fn() }))

const { ProjectPicker, REPOS_SHOWN, shownAddress } = await import('./ProjectPicker.js')

const ALPHA: ProjectSummary = { id: 'alpha-1', path: '/home/me/alpha', name: 'alpha', activated: true, gitHost: true }
const VIKE = { path: '/home/me/oss/vike', name: 'vike', url: 'https://github.com/vikejs/vike.git' }
const NOTES = { path: '/home/me/notes', name: 'notes' }

beforeEach(() => {
  onRepos.mockResolvedValue({ repos: [VIKE, NOTES], canAddFolder: true })
})
afterEach(() => {
  cleanup()
  forgetRemembered()
  vi.clearAllMocks()
})

function renderPicker(over: Partial<Parameters<typeof ProjectPicker>[0]> = {}) {
  const onPick = vi.fn()
  const onProjectAdded = vi.fn()
  const props = { projectId: 'session', projects: [ALPHA], busy: false, onPick, onProjectAdded, ...over }
  const view = render(<ProjectPicker {...props} />)
  return { onPick, onProjectAdded, props, ...view }
}

const trigger = () => screen.getByRole('combobox', { name: 'The session works in' })
const search = () => screen.getByRole('combobox', { name: 'Search projects and repos' })
const options = () => screen.getAllByRole('option').map(option => option.textContent)

describe('ProjectPicker', () => {
  test('a repo\'s address is said as its host and path, over https or ssh, and never with a login in it', () => {
    expect(shownAddress('https://github.com/vikejs/vike.git')).toBe('github.com/vikejs/vike')
    expect(shownAddress('git@github.com:vikejs/vike.git')).toBe('github.com/vikejs/vike')
    expect(shownAddress('ssh://git@gitlab.com/team/app')).toBe('gitlab.com/team/app')
    expect(shownAddress('https://me:ghp_secret@github.com/me/private.git')).toBe('github.com/me/private')
  })

  test('the button reads where the session works: no project, or the project by its name', () => {
    renderPicker()
    expect(trigger().textContent).toBe('No project')
    cleanup()
    renderPicker({ projectId: 'alpha-1', projectName: 'alpha' })
    expect(trigger().textContent).toBe('alpha')
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

  test('with nothing typed only the first repos are listed, and the search reaches the rest', async () => {
    const many = Array.from({ length: REPOS_SHOWN + 5 }, (_, i) => ({ path: `/home/me/r${i}`, name: `r${i}` }))
    onRepos.mockResolvedValue({ repos: many, canAddFolder: false })
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
    const { onPick } = renderPicker({ projectId: 'alpha-1', projectName: 'alpha' })
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: 'No project' }))
    expect(onPick).toHaveBeenLastCalledWith('session')
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

  test('"Search another folder…" adds a folder to look in, and the repos are read again', async () => {
    sendAddRepoFolder.mockResolvedValue({ ok: true, added: true })
    renderPicker()
    await openMenu(trigger())
    await screen.findByRole('option', { name: /vike/ })
    const before = onRepos.mock.calls.length
    onRepos.mockResolvedValue({ repos: [VIKE, NOTES, { path: '/work/client', name: 'client' }], canAddFolder: true })
    fireEvent.click(screen.getByText('Search another folder…'))
    await waitFor(() => expect(sendAddRepoFolder).toHaveBeenCalledTimes(1))
    await screen.findByRole('option', { name: /client/ })
    expect(onRepos.mock.calls.length).toBe(before + 1)
  })
})
