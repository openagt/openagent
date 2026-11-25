import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RepoSources } from '../rpc/projects.js'

let sources: RepoSources
const onRepoSources = vi.fn(async () => sources)
const sendRemoveRepoFolder = vi.fn(async (_folder: string) => ({ ok: true as const }))
const sendAddRepoFolder = vi.fn(async () => ({ ok: true as const, added: true }))
vi.mock('../rpc/projects.js', () => ({ onRepoSources, sendAddRepoFolder, sendRemoveRepoFolder }))

const { RepoSourcesSettings } = await import('./RepoSourcesSettings.js')

beforeEach(() => {
  sources = { folders: ['/work/clients'] }
  for (const fn of [onRepoSources, sendAddRepoFolder, sendRemoveRepoFolder]) fn.mockClear()
})
afterEach(cleanup)

describe('Settings › Repos', () => {
  test("with no folder added, the section's own press searches another one, as the picker does, and lists it", async () => {
    sources = { ...sources, folders: [] }
    render(<RepoSourcesSettings />)
    expect(await screen.findByText('No folder added yet: only your home folder is searched.')).toBeTruthy()
    sources = { ...sources, folders: ['/work/clients'] }
    fireEvent.click(screen.getByRole('button', { name: 'Search another folder…' }))
    await waitFor(() => expect(sendAddRepoFolder).toHaveBeenCalledTimes(1))
    expect(await screen.findByTitle('/work/clients')).toBeTruthy()
  })

  test('a folder added to search in can be taken off', async () => {
    render(<RepoSourcesSettings />)
    expect(await screen.findByTitle('/work/clients')).toBeTruthy()
    sources = { ...sources, folders: [] }
    fireEvent.click(screen.getByRole('button', { name: 'Remove /work/clients' }))
    await waitFor(() => expect(sendRemoveRepoFolder).toHaveBeenCalledWith('/work/clients'))
    await waitFor(() => expect(screen.queryByTitle('/work/clients')).toBeNull())
  })
})
