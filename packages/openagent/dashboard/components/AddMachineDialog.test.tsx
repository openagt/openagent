import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../rpc/machines.js', async () => (await import('../test-machines.js')).machinesRpc)

import { daemon, machinesRpc, saveMachines } from '../test-machines.js'
import { AddMachineDialog } from './AddMachineDialog.js'

afterEach(async () => {
  cleanup()
  localStorage.clear()
  await saveMachines()
})

describe('AddMachineDialog (#1052)', () => {
  test('pasting the link another machine gives hands it to the daemon, which saves the machine, and closes', async () => {
    const onClose = vi.fn()
    const onAdded = vi.fn()
    render(<AddMachineDialog onClose={onClose} onAdded={onAdded} />)
    fireEvent.change(screen.getByPlaceholderText(/studio\.local/), { target: { value: 'http://192.168.1.5:4201/_remote-access/enter#abc123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add machine' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(daemon.machines).toEqual([{ id: 'http://192.168.1.5:4201', label: '192.168.1.5:4201', url: 'http://192.168.1.5:4201' }])
    expect(daemon.codes['http://192.168.1.5:4201']).toBe('abc123')
    expect(onAdded).toHaveBeenCalled()
    // The key is the daemon's to keep: none of it stays in the browser.
    expect(localStorage.length).toBe(0)
  })

  test('an address with no code in it cannot be saved', () => {
    render(<AddMachineDialog onClose={vi.fn()} onAdded={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/studio\.local/), { target: { value: 'http://192.168.1.5:4201' } })
    expect((screen.getByRole('button', { name: 'Add machine' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('That is not the link another machine gives for a new device.')).toBeTruthy()
    expect(machinesRpc.sendAddMachine).not.toHaveBeenCalled()
  })

  test('an optional label overrides the host default', async () => {
    const onClose = vi.fn()
    render(<AddMachineDialog onClose={onClose} onAdded={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/studio\.local/), { target: { value: 'http://box:4201/_remote-access/enter#xyz' } })
    fireEvent.change(screen.getByPlaceholderText(/Name/), { target: { value: 'Workshop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add machine' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(daemon.machines[0]!.label).toBe('Workshop')
  })

  test('a save the daemon refuses is said, and the dialog stays open', async () => {
    machinesRpc.sendAddMachine.mockResolvedValueOnce({ ok: false, error: 'The home file could not be written.' })
    const onClose = vi.fn()
    render(<AddMachineDialog onClose={onClose} onAdded={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/studio\.local/), { target: { value: 'http://box:4201/_remote-access/enter#xyz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add machine' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The home file could not be written.')
    expect(onClose).not.toHaveBeenCalled()
  })
})
