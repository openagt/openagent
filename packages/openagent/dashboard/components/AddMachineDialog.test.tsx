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
  test('pasting a ?token= URL hands it to the daemon, which saves the machine, and closes', async () => {
    const onClose = vi.fn()
    const onAdded = vi.fn()
    render(<AddMachineDialog onClose={onClose} onAdded={onAdded} />)
    fireEvent.change(screen.getByPlaceholderText(/host:port/), { target: { value: 'http://192.168.1.5:4200/?token=abc123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add machine' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(daemon.machines).toEqual([{ id: 'http://192.168.1.5:4200', label: '192.168.1.5:4200', url: 'http://192.168.1.5:4200' }])
    expect(daemon.tokens['http://192.168.1.5:4200']).toBe('abc123')
    expect(onAdded).toHaveBeenCalled()
    // The key is the daemon's to keep: none of it stays in the browser.
    expect(localStorage.length).toBe(0)
  })

  test('a URL without a token cannot be saved', () => {
    render(<AddMachineDialog onClose={vi.fn()} onAdded={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/host:port/), { target: { value: 'http://192.168.1.5:4200' } })
    expect((screen.getByRole('button', { name: 'Add machine' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/no token/i)).toBeTruthy()
    expect(machinesRpc.sendAddMachine).not.toHaveBeenCalled()
  })

  test('an optional label overrides the host default', async () => {
    const onClose = vi.fn()
    render(<AddMachineDialog onClose={onClose} onAdded={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/host:port/), { target: { value: 'http://box:4200/?token=xyz' } })
    fireEvent.change(screen.getByPlaceholderText(/Name/), { target: { value: 'Workshop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add machine' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(daemon.machines[0]!.label).toBe('Workshop')
  })

  test('a save the daemon refuses is said, and the dialog stays open', async () => {
    machinesRpc.sendAddMachine.mockResolvedValueOnce({ ok: false, error: 'The home file could not be written.' })
    const onClose = vi.fn()
    render(<AddMachineDialog onClose={onClose} onAdded={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/host:port/), { target: { value: 'http://box:4200/?token=xyz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add machine' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The home file could not be written.')
    expect(onClose).not.toHaveBeenCalled()
  })
})
