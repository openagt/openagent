import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { RepoFolders } from './RepoFolders.js'

afterEach(cleanup)

/** Settings › Repos' folders, over a server that keeps `folders` and answers what each press asks. */
function shown(folders: string[]) {
  const listed = { folders }
  const host = fakeHost('@openagt/projects', {
    callComputer: vi.fn(async (name: string, input: object) => {
      if (name === 'repoFolders') return { ok: true as const, output: { folders: listed.folders } }
      if (name === 'addFolderToSearch') {
        listed.folders = [...listed.folders, '/work/clients']
        return { ok: true as const, output: { ok: true, added: true } }
      }
      if (name === 'removeFolderToSearch') {
        listed.folders = listed.folders.filter(folder => folder !== (input as { folder: string }).folder)
        return { ok: true as const, output: { ok: true } }
      }
      return { ok: false as const, error: `no answer for ${name}` }
    }),
  })
  renderWithHost(<RepoFolders />, host)
  return host
}

test("with no folder added, the section's own press searches another one, as the picker does, and lists it", async () => {
  const host = shown([])
  expect(await screen.findByText('No folder added yet: only your home folder is searched.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Search another folder…' }))
  await waitFor(() => expect(host.callComputer).toHaveBeenCalledWith('addFolderToSearch', {}))
  expect(await screen.findByTitle('/work/clients')).toBeTruthy()
})

test('a folder added to search in can be taken off', async () => {
  const host = shown(['/work/clients'])
  expect(await screen.findByTitle('/work/clients')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Remove /work/clients' }))
  await waitFor(() => expect(host.callComputer).toHaveBeenCalledWith('removeFolderToSearch', { folder: '/work/clients' }))
  await waitFor(() => expect(screen.queryByTitle('/work/clients')).toBeNull())
})

test('a list that cannot be read says so', async () => {
  const host = fakeHost('@openagt/projects', { callComputer: vi.fn(async () => ({ ok: false as const, error: 'down' })) })
  renderWithHost(<RepoFolders />, host)
  expect((await screen.findByRole('alert')).textContent).toBe('Where the picker looks could not be read.')
})
