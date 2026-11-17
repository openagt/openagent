import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RepoSources } from '../rpc/projects.js'

let sources: RepoSources
const onRepoSources = vi.fn(async () => sources)
const sendAddRepoOwner = vi.fn(async (_typed: string) => ({ ok: true }) as { ok: true } | { ok: false; error: string })
const sendRemoveRepoOwner = vi.fn(async (_owner: string) => ({ ok: true as const }))
const sendRemoveRepoFolder = vi.fn(async (_folder: string) => ({ ok: true as const }))
const sendAddRepoFolder = vi.fn(async () => ({ ok: true as const, added: true }))
vi.mock('../rpc/projects.js', () => ({ onRepoSources, sendAddRepoFolder, sendAddRepoOwner, sendRemoveRepoOwner, sendRemoveRepoFolder }))

const { RepoSourcesSettings } = await import('./RepoSourcesSettings.js')

beforeEach(() => {
  sources = { folders: ['/work/clients'], owners: ['github.com/vikejs'] }
  for (const fn of [onRepoSources, sendAddRepoFolder, sendAddRepoOwner, sendRemoveRepoOwner, sendRemoveRepoFolder]) fn.mockClear()
})
afterEach(cleanup)

describe('Settings › Repos', () => {
  test('names a GitHub user or organization to list repos from, and takes one off', async () => {
    render(<RepoSourcesSettings />)
    expect(await screen.findByText('vikejs')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('GitHub user or organization'), { target: { value: 'brillout' } })
    sources = { ...sources, owners: ['github.com/vikejs', 'github.com/brillout'] }
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(sendAddRepoOwner).toHaveBeenCalledWith('brillout'))
    expect(await screen.findByText('brillout')).toBeTruthy()
    expect((screen.getByLabelText('GitHub user or organization') as HTMLInputElement).value).toBe('')
    sources = { ...sources, owners: ['github.com/brillout'] }
    fireEvent.click(screen.getByRole('button', { name: 'Remove github.com/vikejs' }))
    await waitFor(() => expect(sendRemoveRepoOwner).toHaveBeenCalledWith('github.com/vikejs'))
    await waitFor(() => expect(screen.queryByText('vikejs')).toBeNull())
  })

  test('a name that is no user or organization: its reason is said', async () => {
    sendAddRepoOwner.mockResolvedValueOnce({ ok: false, error: '"vikejs/vike" is not a user or organization.' })
    render(<RepoSourcesSettings />)
    fireEvent.change(await screen.findByLabelText('GitHub user or organization'), { target: { value: 'vikejs/vike' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('"vikejs/vike" is not a user or organization.')).toBeTruthy()
  })

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
