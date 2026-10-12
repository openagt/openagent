import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const sendAddProject = vi.hoisted(() => vi.fn())
const sendPickProjectDirectory = vi.hoisted(() => vi.fn())
const onCloneTarget = vi.hoisted(() => vi.fn())
const sendAddProjectFromAddress = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ sendAddProject, sendPickProjectDirectory, onCloneTarget, sendAddProjectFromAddress }))

const { AddProjectPanel } = await import('./AddProjectPanel.js')

afterEach(() => {
  cleanup()
  sendAddProject.mockReset()
  sendPickProjectDirectory.mockReset()
  onCloneTarget.mockReset()
  sendAddProjectFromAddress.mockReset()
})

describe('AddProjectPanel (#1150)', () => {
  test('the system dialog opens with the modal, and the picked repo is added only after the trust confirmation', async () => {
    sendPickProjectDirectory.mockResolvedValue({ ok: true, path: '/Users/dev/my-repo' })
    sendAddProject.mockResolvedValue({ ok: true, alreadyActivated: false })
    render(<AddProjectPanel onAdded={() => {}} onClose={() => {}} />)
    // Picking is the form: the dialog is already open, the modal just says so.
    expect(sendPickProjectDirectory).toHaveBeenCalledTimes(1)
    // The picked path is shown back for the trust gate (#439); nothing is registered yet.
    await screen.findByText('/Users/dev/my-repo')
    expect(sendAddProject).not.toHaveBeenCalled()
    // What the add will do to the folder is said here, before the button that does it.
    const dialog = screen.getByRole('dialog', { name: 'Add project' })
    expect(dialog.textContent).toContain('makes no commit on your branch and pushes nothing')
    expect(dialog.textContent).toContain('Your files and your branch stay as they are.')
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, add it' }))
    await screen.findByText('Project added')
    // The records stay on this machine unless the person picks the other answer.
    expect(sendAddProject).toHaveBeenCalledWith('/Users/dev/my-repo', false)
  })

  test('the person says where the agents\u2019 records go before the add: kept here until they pick sharing', async () => {
    sendPickProjectDirectory.mockResolvedValue({ ok: true, path: '/Users/dev/my-repo' })
    sendAddProject.mockResolvedValue({ ok: true, alreadyActivated: false })
    render(<AddProjectPanel onAdded={() => {}} onClose={() => {}} />)
    const keep = (await screen.findByRole('radio', { name: /Keep them on this machine/ })) as HTMLInputElement
    const share = screen.getByRole('radio', { name: /Share them to the repository\u2019s remote/ }) as HTMLInputElement
    expect([keep.checked, share.checked]).toEqual([true, false])
    // What sharing does is said beside the choice, before anything happens.
    expect(screen.getByText('Nothing is pushed.')).toBeTruthy()
    expect(screen.getByText(/keeps pushing as agents work/)).toBeTruthy()
    fireEvent.click(share)
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, add it' }))
    await screen.findByText('Project added')
    expect(sendAddProject).toHaveBeenCalledWith('/Users/dev/my-repo', true)
    expect(screen.queryByText(/has no remote/)).toBeNull()
  })

  test('sharing picked for a repository with no remote: the dialog says the records stay on this machine', async () => {
    sendAddProject.mockResolvedValue({ ok: true, alreadyActivated: false, noRemote: true })
    render(<AddProjectPanel folder="/Users/dev/here" onAdded={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /Share them to the repository\u2019s remote/ }))
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, add it' }))
    await screen.findByText('Project added')
    expect(screen.getByText(/has no remote, so the agents\u2019 records stay on this machine/)).toBeTruthy()
  })

  test('a folder handed in is asked about at once: no system dialog, and Cancel closes', async () => {
    const onClose = vi.fn()
    sendAddProject.mockResolvedValue({ ok: true, alreadyActivated: false })
    render(<AddProjectPanel folder="/Users/dev/here" onAdded={() => {}} onClose={onClose} />)
    expect(screen.getByText('/Users/dev/here')).toBeTruthy()
    expect(sendPickProjectDirectory).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Choose again' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(sendAddProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, add it' }))
    await screen.findByText('Project added')
    expect(sendAddProject).toHaveBeenCalledWith('/Users/dev/here', false)
  })

  test('a repo that was already a project reads "Already added"', async () => {
    sendPickProjectDirectory.mockResolvedValue({ ok: true, path: '/Users/dev/my-repo' })
    sendAddProject.mockResolvedValue({ ok: true, alreadyActivated: true })
    render(<AddProjectPanel onAdded={() => {}} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'I trust it, add it' }))
    await screen.findByText('Already added')
  })

  test('dismissing the system dialog closes the modal without adding anything', async () => {
    sendPickProjectDirectory.mockResolvedValue({ ok: true, path: null })
    const onClose = vi.fn()
    render(<AddProjectPanel onAdded={() => {}} onClose={onClose} />)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(sendAddProject).not.toHaveBeenCalled()
  })

  test('a dialog that could not be opened reports why, and Try again asks again', async () => {
    sendPickProjectDirectory.mockResolvedValueOnce({ ok: false, error: 'The machine running OpenAgent has no desktop session, so no folder dialog can open there.' })
    sendPickProjectDirectory.mockResolvedValueOnce({ ok: true, path: '/Users/dev/my-repo' })
    render(<AddProjectPanel onAdded={() => {}} onClose={() => {}} />)
    await screen.findByText(/no desktop session/)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('/Users/dev/my-repo')
  })

  test('a failed add reports the daemon’s reason and stays on the trust step', async () => {
    sendPickProjectDirectory.mockResolvedValue({ ok: true, path: '/Users/dev/my-repo' })
    sendAddProject.mockResolvedValue({ ok: false, error: 'path does not exist or is not a directory: /Users/dev/my-repo' })
    render(<AddProjectPanel onAdded={() => {}} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'I trust it, add it' }))
    await screen.findByText(/path does not exist/)
    expect(screen.getByRole('button', { name: 'I trust it, add it' })).toBeTruthy()
  })

  test('Choose again reopens the system dialog from the trust step', async () => {
    sendPickProjectDirectory.mockResolvedValueOnce({ ok: true, path: '/Users/dev/first' })
    sendPickProjectDirectory.mockResolvedValueOnce({ ok: true, path: '/Users/dev/second' })
    render(<AddProjectPanel onAdded={() => {}} onClose={() => {}} />)
    await screen.findByText('/Users/dev/first')
    fireEvent.click(screen.getByRole('button', { name: 'Choose again' }))
    await screen.findByText('/Users/dev/second')
    expect(sendPickProjectDirectory).toHaveBeenCalledTimes(2)
  })

  test('by address: no folder dialog; the address is read, where it will be cloned is shown, and nothing is cloned before the trust confirmation', async () => {
    onCloneTarget.mockResolvedValue({ ok: true, address: 'github.com/ada/shop', path: '/home/openagent/projects/shop' })
    sendAddProjectFromAddress.mockResolvedValue({ ok: true, alreadyActivated: false, path: '/home/openagent/projects/shop' })
    const onAdded = vi.fn()
    render(<AddProjectPanel fromAddress onAdded={onAdded} onClose={() => {}} />)
    expect(sendPickProjectDirectory).not.toHaveBeenCalled()
    const next = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/The repository\u2019s address/), { target: { value: '  https://github.com/Ada/shop  ' } })
    fireEvent.click(next)
    await screen.findByText('Do you trust this repository?')
    expect(onCloneTarget).toHaveBeenCalledWith('https://github.com/Ada/shop')
    const dialog = screen.getByRole('dialog', { name: 'Add project' })
    expect(dialog.textContent).toContain('github.com/ada/shop')
    expect(dialog.textContent).toContain('It will be cloned to /home/openagent/projects/shop.')
    expect(sendAddProjectFromAddress).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: /Share them to the repository\u2019s remote/ }))
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, clone and add it' }))
    await screen.findByText('Project added')
    expect(sendAddProjectFromAddress).toHaveBeenCalledWith('https://github.com/Ada/shop', true)
    expect(sendAddProject).not.toHaveBeenCalled()
    expect(dialog.textContent).toContain('It is in /home/openagent/projects/shop.')
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  test('by address: what is no address is said and the field stays; a clone that fails is said and the address can be changed', async () => {
    onCloneTarget.mockResolvedValueOnce({ ok: false, error: '"shop" is not a repository\u2019s address. One looks like github.com/you/project.' })
    render(<AddProjectPanel fromAddress onAdded={() => {}} onClose={() => {}} />)
    const field = screen.getByLabelText(/The repository\u2019s address/) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'shop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText(/is not a repository\u2019s address/)
    expect(screen.queryByText('Do you trust this repository?')).toBeNull()

    onCloneTarget.mockResolvedValue({ ok: true, address: 'github.com/ada/private', path: '/home/openagent/projects/private' })
    sendAddProjectFromAddress.mockResolvedValue({ ok: false, error: 'This computer has no login that can read github.com/ada/private.' })
    fireEvent.change(field, { target: { value: 'github.com/ada/private' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(await screen.findByRole('button', { name: 'I trust it, clone and add it' }))
    await screen.findByText('This computer has no login that can read github.com/ada/private.')
    expect(screen.queryByText('Project added')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Change the address' }))
    expect((screen.getByLabelText(/The repository\u2019s address/) as HTMLInputElement).value).toBe('github.com/ada/private')
    expect(screen.queryByText(/no login that can read/)).toBeNull()
  })

  test('a computer whose folder dialog cannot open says why, and offers the address in its place', async () => {
    sendPickProjectDirectory.mockResolvedValue({ ok: false, error: 'The machine running OpenAgent has no desktop session, so no folder dialog can open there.' })
    render(<AddProjectPanel onAdded={() => {}} onClose={() => {}} />)
    await screen.findByText(/has no desktop session/)
    fireEvent.click(screen.getByRole('button', { name: 'Add from a GitHub address' }))
    expect(screen.getByLabelText(/The repository\u2019s address/)).toBeTruthy()
    // Still said: why the person is asked for an address when they asked for a folder.
    expect(screen.getByText(/has no desktop session/)).toBeTruthy()
  })
})
