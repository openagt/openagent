import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

let owners: string[]
const onRepoOwners = vi.fn(async () => owners)
const sendAddRepoOwner = vi.fn(async (_typed: string) => ({ ok: true }) as { ok: true } | { ok: false; error: string })
const sendRemoveRepoOwner = vi.fn(async (_owner: string) => ({ ok: true as const }))
vi.mock('../rpc/projects.js', () => ({ onRepoOwners, sendAddRepoOwner, sendRemoveRepoOwner }))

const { RepoOwnersSettings } = await import('./RepoOwnersSettings.js')

beforeEach(() => {
  owners = ['github.com/vikejs']
  for (const fn of [onRepoOwners, sendAddRepoOwner, sendRemoveRepoOwner]) fn.mockClear()
})
afterEach(cleanup)

describe('Settings › Repos on GitHub', () => {
  test('names a GitHub user or organization to list repos from, and takes one off', async () => {
    render(<RepoOwnersSettings />)
    expect(await screen.findByText('vikejs')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('GitHub user or organization'), { target: { value: 'brillout' } })
    owners = ['github.com/vikejs', 'github.com/brillout']
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(sendAddRepoOwner).toHaveBeenCalledWith('brillout'))
    expect(await screen.findByText('brillout')).toBeTruthy()
    expect((screen.getByLabelText('GitHub user or organization') as HTMLInputElement).value).toBe('')
    owners = ['github.com/brillout']
    fireEvent.click(screen.getByRole('button', { name: 'Remove github.com/vikejs' }))
    await waitFor(() => expect(sendRemoveRepoOwner).toHaveBeenCalledWith('github.com/vikejs'))
    await waitFor(() => expect(screen.queryByText('vikejs')).toBeNull())
  })

  test('a name that is no user or organization: its reason is said', async () => {
    sendAddRepoOwner.mockResolvedValueOnce({ ok: false, error: '"vikejs/vike" is not a user or organization.' })
    render(<RepoOwnersSettings />)
    fireEvent.change(await screen.findByLabelText('GitHub user or organization'), { target: { value: 'vikejs/vike' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('"vikejs/vike" is not a user or organization.')).toBeTruthy()
  })
})
