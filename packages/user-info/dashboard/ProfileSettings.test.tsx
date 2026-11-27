import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'

// The person as the shell reads them: `person` is what is saved, and the page shows it once it
// reads them again. The module's own calls as a test answers them.
type Person = { name: string; avatar?: string; login?: string; own?: true; team?: true }
const shell = vi.hoisted(() => ({ person: { name: '' } as Person, shown: { name: '' } as Person, personChanged: vi.fn() }))
vi.mock('@openagt/ui/module', async original => ({
  ...(await original<typeof import('@openagt/ui/module')>()),
  usePerson: () => ({ person: shell.shown, reload: async () => void (shell.shown = shell.person) }),
  personChanged: shell.personChanged,
}))

const { ProfileSettings } = await import('./ProfileSettings.js')

let answers: Record<string, (input: Record<string, unknown>) => ModuleCallResult>
const callComputer = vi.fn(async (name: string, input: object): Promise<ModuleCallResult> => (answers[name] ?? (() => ({ ok: true, output: null })))(input as Record<string, unknown>))
const sent = (name: string) => callComputer.mock.calls.filter(([called]) => called === name).map(([, input]) => input)
const render = () => renderWithHost(<ProfileSettings />, fakeHost('@openagt/user-info', { callComputer }))

beforeEach(() => {
  shell.person = shell.shown = { name: 'Suleiman Shahbari' }
  answers = { copyFromGitHub: input => ({ ok: true, output: { changed: true, login: input['login'] } }) }
  callComputer.mockClear()
  shell.personChanged.mockClear()
})
afterEach(cleanup)

describe('Settings › Profile', () => {
  test("with none set, the name is git's: saving it keeps it as the person's own", async () => {
    render()
    expect(await screen.findByText(/Your git name for now/)).toBeTruthy()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Suleiman Shahbari')
    expect(screen.getByText('None: your initials.')).toBeTruthy()
    shell.person = { name: 'Suleiman S', own: true }
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Suleiman S' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('saveName')).toEqual([{ name: 'Suleiman S' }]))
    expect(shell.personChanged).toHaveBeenCalled()
    expect(await screen.findByText(/what the servers you join call you/)).toBeTruthy()
  })

  test('a name that was saved says so, until it is typed into again; Save, with nothing to save, keeps the focus and sends nothing', async () => {
    render()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Suleiman S' } })
    shell.person = { name: 'Suleiman S', own: true }
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    save.focus()
    fireEvent.click(save)
    expect((await screen.findByRole('status')).textContent).toBe('Saved.')
    await waitFor(() => expect(document.activeElement).toBe(save))
    expect([save.disabled, save.getAttribute('aria-disabled')]).toEqual([false, 'true'])
    fireEvent.click(save)
    expect(sent('saveName')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Suleiman' } })
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('Sync from GitHub copies a profile once; the picture it gave can be removed', async () => {
    render()
    fireEvent.change(await screen.findByLabelText('Sync from GitHub'), { target: { value: 'suleimansh' } })
    shell.person = { name: 'Suleiman Shahbari', avatar: 'https://avatars.githubusercontent.com/u/1', login: 'suleimansh', own: true }
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(sent('copyFromGitHub')).toEqual([{ login: 'suleimansh' }]))
    expect(await screen.findByText('From @suleimansh on GitHub.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Name and picture copied from @suleimansh.')
    // Again, with nothing new at GitHub: it still answers.
    answers['copyFromGitHub'] = () => ({ ok: true, output: { changed: false, login: 'suleimansh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByText('Already up to date with @suleimansh.')).toBeTruthy()
    shell.person = { name: 'Suleiman Shahbari', login: 'suleimansh', own: true }
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(sent('removePicture')).toEqual([{}]))
    expect(await screen.findByText('None: your initials.')).toBeTruthy()
  })

  test('a profile GitHub does not have: its reason is said', async () => {
    answers['copyFromGitHub'] = () => ({ ok: false, error: 'GitHub has no user nobody-here' })
    render()
    fireEvent.change(await screen.findByLabelText('Sync from GitHub'), { target: { value: 'nobody-here' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByText('GitHub has no user nobody-here')).toBeTruthy()
  })

  test('on a machine shared by a team: the name and picture of the GitHub sign-in, nothing to type', async () => {
    shell.person = shell.shown = { name: 'Rom', login: 'brillout', avatar: 'https://avatars.githubusercontent.com/u/1005638?v=4', team: true }
    render()
    expect(await screen.findByText('Signed in with GitHub as @brillout.')).toBeTruthy()
    expect(screen.getByText('Rom')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull()
  })
})
