import { useRef, useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { fakeHost, onProjectsChanged, renderWithHost } from '@openagt/ui/module/testing'

const sendAddProject = vi.hoisted(() => vi.fn())
const sendPickProjectDirectory = vi.hoisted(() => vi.fn())
const onCloneTarget = vi.hoisted(() => vi.fn())
const sendAddProjectFromAddress = vi.hoisted(() => vi.fn())
// The module's calls of its server, each as the old RPC it took the place of.
vi.mock('./calls.js', () => ({
  addProject: (_host: unknown, path: string) => sendAddProject(path),
  pickDirectory: () => sendPickProjectDirectory(),
  cloneTargetFor: (_host: unknown, address: string) => onCloneTarget(address),
  addFromAddress: (_host: unknown, address: string) => sendAddProjectFromAddress(address),
}))

/** Drawn as the dashboard draws the module's piece. */
const render = (ui: ReactElement) => renderWithHost(ui, fakeHost('@openagt/projects'))

const { AddProjectPanel } = await import('./AddProjectPanel.js')

/** Opened here with no control to give focus back to. */
const NO_OPENER = { current: null }

/** The panel as the project picker opens it: from a button, over a page with a message box, and taken away when it closes. */
function Opened() {
  const opener = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(true)
  return (
    <>
      <button ref={opener}>Project: shop</button>
      <input aria-label="Prompt" />
      {open && <AddProjectPanel opener={opener} folder="/Users/dev/here" onAdded={() => {}} onClose={() => setOpen(false)} />}
    </>
  )
}

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
    render(<AddProjectPanel opener={NO_OPENER} onAdded={() => {}} onClose={() => {}} />)
    // Picking is the form: the dialog is already open, the modal just says so.
    expect(sendPickProjectDirectory).toHaveBeenCalledTimes(1)
    // The picked path is shown back for the trust gate (#439); nothing is registered yet.
    await screen.findByTitle('/Users/dev/my-repo')
    expect(sendAddProject).not.toHaveBeenCalled()
    // The question is short: the warning and the button, no list and no other choice (Rom).
    const dialog = screen.getByRole('dialog', { name: 'Add project' })
    expect(dialog.textContent).toContain('add only the ones you trust')
    expect(dialog.textContent).not.toContain('makes no commit on your branch')
    expect(screen.queryByRole('radio')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, add it' }))
    await screen.findByText('Project added')
    // The records stay on this machine: the project's Agent data page shares them later.
    expect(sendAddProject).toHaveBeenCalledWith('/Users/dev/my-repo')
  })

  test('a folder handed in is asked about at once: no system dialog, and Cancel closes', async () => {
    const onClose = vi.fn()
    sendAddProject.mockResolvedValue({ ok: true, alreadyActivated: false })
    render(<AddProjectPanel opener={NO_OPENER} folder="/Users/dev/here" onAdded={() => {}} onClose={onClose} />)
    expect(screen.getByTitle('/Users/dev/here')).toBeTruthy()
    expect(sendPickProjectDirectory).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Choose again' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(sendAddProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, add it' }))
    await screen.findByText('Project added')
    expect(sendAddProject).toHaveBeenCalledWith('/Users/dev/here')
  })

  test('the trust question opens on the press that adds nothing: a second Enter trusts no repository unread', async () => {
    sendPickProjectDirectory.mockResolvedValue({ ok: true, path: '/Users/dev/my-repo' })
    render(<AddProjectPanel opener={NO_OPENER} onAdded={() => {}} onClose={() => {}} />)
    await screen.findByTitle('/Users/dev/my-repo')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose again' }))
    cleanup()
    render(<AddProjectPanel opener={NO_OPENER} folder="/Users/dev/here" onAdded={() => {}} onClose={() => {}} />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  test('closed, it hands the keyboard back to the control that opened it', async () => {
    render(<Opened />)
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    fireEvent.click(cancel)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Project: shop' }))
  })

  test('closing itself after the add, it leaves the keyboard where the person took it meanwhile: the new project\u2019s message box', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      sendAddProject.mockResolvedValue({ ok: true, alreadyActivated: false })
      render(<Opened />)
      fireEvent.click(screen.getByRole('button', { name: 'I trust it, add it' }))
      await screen.findByText('Project added')
      // The project's page opens under the note, and its message box takes the caret: the person types.
      const box = screen.getByRole('textbox', { name: 'Prompt' })
      box.focus()
      await act(() => vi.advanceTimersByTimeAsync(2500))
      expect(screen.queryByRole('dialog')).toBeNull()
      // Handed to the opener, the rest of the sentence went into the project picker's search.
      expect(document.activeElement).toBe(box)
    } finally {
      vi.useRealTimers()
    }
  })

  test('a repo that was already a project reads "Already added"', async () => {
    sendPickProjectDirectory.mockResolvedValue({ ok: true, path: '/Users/dev/my-repo' })
    sendAddProject.mockResolvedValue({ ok: true, alreadyActivated: true })
    render(<AddProjectPanel opener={NO_OPENER} onAdded={() => {}} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'I trust it, add it' }))
    await screen.findByText('Already added')
  })

  test('dismissing the system dialog closes the modal without adding anything', async () => {
    sendPickProjectDirectory.mockResolvedValue({ ok: true, path: null })
    const onClose = vi.fn()
    render(<AddProjectPanel opener={NO_OPENER} onAdded={() => {}} onClose={onClose} />)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(sendAddProject).not.toHaveBeenCalled()
  })

  test('a dialog that could not be opened reports why, and Try again asks again', async () => {
    sendPickProjectDirectory.mockResolvedValueOnce({ ok: false, error: 'The machine running OpenAgent has no desktop session, so no folder dialog can open there.' })
    sendPickProjectDirectory.mockResolvedValueOnce({ ok: true, path: '/Users/dev/my-repo' })
    render(<AddProjectPanel opener={NO_OPENER} onAdded={() => {}} onClose={() => {}} />)
    await screen.findByText(/no desktop session/)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByTitle('/Users/dev/my-repo')
  })

  test('a failed add reports the daemon’s reason and stays on the trust step', async () => {
    sendPickProjectDirectory.mockResolvedValue({ ok: true, path: '/Users/dev/my-repo' })
    sendAddProject.mockResolvedValue({ ok: false, error: 'path does not exist or is not a directory: /Users/dev/my-repo' })
    render(<AddProjectPanel opener={NO_OPENER} onAdded={() => {}} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'I trust it, add it' }))
    await screen.findByText(/path does not exist/)
    expect(screen.getByRole('button', { name: 'I trust it, add it' })).toBeTruthy()
  })

  test('Choose again reopens the system dialog from the trust step', async () => {
    sendPickProjectDirectory.mockResolvedValueOnce({ ok: true, path: '/Users/dev/first' })
    sendPickProjectDirectory.mockResolvedValueOnce({ ok: true, path: '/Users/dev/second' })
    render(<AddProjectPanel opener={NO_OPENER} onAdded={() => {}} onClose={() => {}} />)
    await screen.findByTitle('/Users/dev/first')
    fireEvent.click(screen.getByRole('button', { name: 'Choose again' }))
    await screen.findByTitle('/Users/dev/second')
    expect(sendPickProjectDirectory).toHaveBeenCalledTimes(2)
  })

  test('by address: no folder dialog; the address is read, where it will be cloned is shown, and nothing is cloned before the trust confirmation', async () => {
    onCloneTarget.mockResolvedValue({ ok: true, address: 'github.com/ada/shop', path: '/home/openagent/projects/shop' })
    sendAddProjectFromAddress.mockResolvedValue({ ok: true, alreadyActivated: false, path: '/home/openagent/projects/shop' })
    const onAdded = vi.fn()
    render(<AddProjectPanel opener={NO_OPENER} fromAddress onAdded={onAdded} onClose={() => {}} />)
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
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, clone and add it' }))
    await screen.findByText('Project added')
    expect(sendAddProjectFromAddress).toHaveBeenCalledWith('https://github.com/Ada/shop')
    expect(sendAddProject).not.toHaveBeenCalled()
    expect(dialog.textContent).toContain('It is in /home/openagent/projects/shop.')
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  test('by address: what is no address is said and the field stays; a clone that fails is said and the address can be changed', async () => {
    onCloneTarget.mockResolvedValueOnce({ ok: false, error: '"shop" is not a repository\u2019s address. One looks like github.com/you/project.' })
    render(<AddProjectPanel opener={NO_OPENER} fromAddress onAdded={() => {}} onClose={() => {}} />)
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
    render(<AddProjectPanel opener={NO_OPENER} onAdded={() => {}} onClose={() => {}} />)
    await screen.findByText(/has no desktop session/)
    fireEvent.click(screen.getByRole('button', { name: 'Add from a GitHub address' }))
    expect(screen.getByLabelText(/The repository\u2019s address/)).toBeTruthy()
    // Still said: why the person is asked for an address when they asked for a folder.
    expect(screen.getByText(/has no desktop session/)).toBeTruthy()
  })

  test('for a first project, what adding one does is said under the trust question; once added the shell is told the list changed', async () => {
    sendAddProject.mockResolvedValue({ ok: true, alreadyActivated: false })
    const changes: unknown[] = []
    const stop = onProjectsChanged(change => void changes.push(change))
    try {
      render(<AddProjectPanel opener={NO_OPENER} folder="/Users/dev/here" effects onAdded={() => {}} onClose={() => {}} />)
      expect(screen.getByRole('dialog', { name: 'Add project' }).textContent).toContain('makes no commit on your branch')
      fireEvent.click(screen.getByRole('button', { name: 'I trust it, add it' }))
      await screen.findByText('Project added')
      expect(changes).toEqual([{ added: true }])
    } finally {
      stop()
    }
  })
})
