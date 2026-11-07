import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { openMenu } from '../test-utils.js'
import { forgetRemembered } from '../lib/use-async.js'

const onRepos = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onRepos }))

const { addRepoGroups, folderName, SessionRepoPicks } = await import('./SessionRepos.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
  vi.clearAllMocks()
})

const row = (path: string, label = folderName(path), search = path) => ({ value: path, label, detail: path, path, search })

describe('"Add repo"', () => {
  test("a copy is named by the repo folder's own name, as the run names it", () => {
    expect(folderName('/home/me/oss/vike')).toBe('vike')
    expect(folderName('/home/me/oss/vike/')).toBe('vike')
    expect(folderName('C:\\code\\site')).toBe('site')
  })

  test('the projects, then the repos, each without the ones picked, and a search by name, folder or address', () => {
    const projects = [row('/home/me/alpha')]
    const repos = [row('/home/me/oss/vike', 'vike', '/home/me/oss/vike\nhttps://github.com/vikejs/vike'), row('/home/me/notes')]
    expect(addRepoGroups(projects, repos, [], '').map(group => [group.label, group.items.map(item => item.label)])).toEqual([
      ['Projects', ['alpha']],
      ['Repos', ['vike', 'notes']],
    ])
    expect(addRepoGroups(projects, repos, [{ path: '/home/me/alpha', name: 'alpha' }], '').map(group => group.label)).toEqual(['Repos'])
    expect(addRepoGroups(projects, repos, [], 'VIKEJS').flatMap(group => group.items.map(item => item.label))).toEqual(['vike'])
    expect(addRepoGroups(projects, repos, [], 'nothing-like-it')).toEqual([])
  })

  test('while the look through this computer is still on its way, the menu says so and asks again', async () => {
    onRepos.mockResolvedValue({ repos: [], hosted: [], reposLoading: true, hostedLoading: false, canAddFolder: false })
    render(<SessionRepoPicks picked={[]} projects={[]} busy={false} onChange={() => {}} />)
    await openMenu(screen.getByRole('combobox', { name: 'Add repo' }))
    expect(await screen.findByText('Looking for repos on this computer…')).toBeTruthy()
    const before = onRepos.mock.calls.length
    onRepos.mockResolvedValue({ repos: [{ path: '/home/me/oss/vike', name: 'vike' }], hosted: [], reposLoading: false, hostedLoading: false, canAddFolder: false })
    await waitFor(() => expect(onRepos.mock.calls.length).toBeGreaterThan(before), { timeout: 4000 })
    expect(await screen.findByRole('option', { name: /vike/ })).toBeTruthy()
    expect(screen.queryByText('Looking for repos on this computer…')).toBeNull()
  })
})
