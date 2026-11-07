import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Person } from '../rpc/person.js'

let person: Person
const onPerson = vi.fn(async () => person)
const sendSavePersonName = vi.fn(async (_name: string) => ({ ok: true }) as { ok: true } | { ok: false; error: string })
const sendRemovePersonPicture = vi.fn(async () => ({ ok: true as const }))
const sendSyncPersonFromGitHub = vi.fn(async (login: string) => ({ ok: true, changed: true, login }) as { ok: true; changed: boolean; login: string } | { ok: false; error: string })
vi.mock('../rpc/person.js', () => ({ onPerson, sendSavePersonName, sendRemovePersonPicture, sendSyncPersonFromGitHub }))

const { ProfileSettings } = await import('./ProfileSettings.js')

beforeEach(() => {
  person = { name: 'Suleiman Shahbari' }
  for (const fn of [onPerson, sendSavePersonName, sendRemovePersonPicture, sendSyncPersonFromGitHub]) fn.mockClear()
})
afterEach(cleanup)

describe('Settings › Profile', () => {
  test("with none set, the name is git's: saving it keeps it as the person's own", async () => {
    render(<ProfileSettings />)
    expect(await screen.findByText(/Your git name for now/)).toBeTruthy()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Suleiman Shahbari')
    expect(screen.getByText('None: your initials.')).toBeTruthy()
    person = { name: 'Suleiman S', own: true }
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Suleiman S' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sendSavePersonName).toHaveBeenCalledWith('Suleiman S'))
    expect(await screen.findByText(/what the servers you join call you/)).toBeTruthy()
  })

  test('Sync from GitHub copies a profile once; the picture it gave can be removed', async () => {
    render(<ProfileSettings />)
    fireEvent.change(await screen.findByLabelText('Sync from GitHub'), { target: { value: 'suleimansh' } })
    person = { name: 'Suleiman Shahbari', avatar: 'https://avatars.githubusercontent.com/u/1', github: 'suleimansh', own: true }
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(sendSyncPersonFromGitHub).toHaveBeenCalledWith('suleimansh'))
    expect(await screen.findByText('From @suleimansh on GitHub.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Name and picture copied from @suleimansh.')
    // Again, with nothing new at GitHub: it still answers.
    sendSyncPersonFromGitHub.mockResolvedValueOnce({ ok: true, changed: false, login: 'suleimansh' })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByText('Already up to date with @suleimansh.')).toBeTruthy()
    person = { name: 'Suleiman Shahbari', github: 'suleimansh', own: true }
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(sendRemovePersonPicture).toHaveBeenCalled())
    expect(await screen.findByText('None: your initials.')).toBeTruthy()
  })

  test('a profile GitHub does not have: its reason is said', async () => {
    sendSyncPersonFromGitHub.mockResolvedValueOnce({ ok: false, error: 'GitHub has no user nobody-here' })
    render(<ProfileSettings />)
    fireEvent.change(await screen.findByLabelText('Sync from GitHub'), { target: { value: 'nobody-here' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByText('GitHub has no user nobody-here')).toBeTruthy()
  })
})
