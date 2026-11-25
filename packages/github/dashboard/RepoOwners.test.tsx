import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { RepoOwnersSettings } from './RepoOwners.js'

// Settings › GitHub's users and organizations, its module's calls as a test answers them.

let owners: string[]
let added: { ok: true } | { ok: false; error: string }
const call = vi.fn(async (_projectId: string, name: string, _input: object): Promise<ModuleCallResult> => {
  if (name === 'owners') return { ok: true, output: owners }
  if (name === 'addRepoOwner') return { ok: true, output: added }
  if (name === 'removeRepoOwner') return { ok: true, output: { ok: true } }
  return { ok: false, error: `no ${name} here` }
})
const host = fakeHost('@openagt/github', { call })

beforeEach(() => {
  owners = ['vikejs']
  added = { ok: true }
})
afterEach(() => {
  cleanup()
  call.mockClear()
})

describe('GitHub users and organizations', () => {
  test('names one to list repos from, and takes one off', async () => {
    renderWithHost(<RepoOwnersSettings />, host)
    expect(await screen.findByText('vikejs')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('GitHub user or organization'), { target: { value: 'brillout' } })
    owners = ['vikejs', 'brillout']
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(call).toHaveBeenCalledWith(expect.any(String), 'addRepoOwner', { owner: 'brillout' }))
    expect(await screen.findByText('brillout')).toBeTruthy()
    expect((screen.getByLabelText('GitHub user or organization') as HTMLInputElement).value).toBe('')
    owners = ['brillout']
    fireEvent.click(screen.getByRole('button', { name: 'Remove vikejs' }))
    await waitFor(() => expect(call).toHaveBeenCalledWith(expect.any(String), 'removeRepoOwner', { owner: 'vikejs' }))
    await waitFor(() => expect(screen.queryByText('vikejs')).toBeNull())
  })

  test('a name that is no user or organization: its reason is said', async () => {
    added = { ok: false, error: '"vikejs/vike" is not a GitHub user or organization.' }
    renderWithHost(<RepoOwnersSettings />, host)
    fireEvent.change(await screen.findByLabelText('GitHub user or organization'), { target: { value: 'vikejs/vike' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('"vikejs/vike" is not a GitHub user or organization.')).toBeTruthy()
  })
})
