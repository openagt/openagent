import { describe, expect, test } from 'vitest'
import { addRepoGroups, folderName } from './SessionRepos.js'

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
})
