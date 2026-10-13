import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../rpc/machines.js', async () => (await import('../test-machines.js')).machinesRpc)

import { daemon, machinesRpc, saveMachines } from '../test-machines.js'
import { MachinesSettings } from './MachinesSettings.js'
import { selectMachine, getSelectedMachineId } from '../lib/remote-target.js'

const STUDIO = { id: 'http://192.168.1.5:4200', label: 'Studio', url: 'http://192.168.1.5:4200' }
const BOX = { id: 'http://box.tail.ts:4200', label: 'Box', url: 'http://box.tail.ts:4200' }
// A person's own computer, reached by the line it keeps open to this server: saved by the address that stands for it here.
const MACBOOK = { id: 'http://127.0.0.1:4210', label: 'MacBook', url: 'http://127.0.0.1:4210' }

afterEach(async () => {
  cleanup()
  selectMachine(null) // module-level state, so it outlives a test unless reset
  await saveMachines()
})

describe('MachinesSettings (#1052/#1072)', () => {
  // First in the file on purpose: it needs a page that has not read the list yet.
  test('before the daemon has answered it does not claim there are none; once it has, it says so rather than showing an empty list', async () => {
    let land: (machines: never[]) => void = () => {}
    machinesRpc.onMachines.mockImplementationOnce(() => new Promise(resolve => (land = resolve)))
    render(<MachinesSettings />)
    await waitFor(() => expect(machinesRpc.onMachines).toHaveBeenCalled())
    expect(screen.queryByText(/No machines saved/)).toBeNull()
    land([])
    await waitFor(() => expect(screen.getByText(/No machines saved/)).toBeTruthy())
  })

  test('lists each saved machine with its address, and says where the list is kept', async () => {
    await saveMachines(STUDIO)
    render(<MachinesSettings />)
    expect(screen.getByText('Studio')).toBeTruthy()
    expect(screen.getByText(STUDIO.url)).toBeTruthy()
    expect(screen.getByText(/every\s+browser that opens it shows the same list/)).toBeTruthy()
  })

  test('a machine that is a person\'s own computer, reached by its line, is listed by what it is and not by its address, and can be taken off the list like any other', async () => {
    await saveMachines(MACBOOK, STUDIO)
    daemon.reachable = { [MACBOOK.id]: true }
    render(<MachinesSettings />)
    expect(screen.getByText('MacBook')).toBeTruthy()
    expect(screen.getByText('Your computer. It keeps a line open to this server. Removed here, it is back when it calls again: to take it out, remove it under Devices.')).toBeTruthy()
    expect(screen.queryByText(MACBOOK.url)).toBeNull()
    // Never a row that cannot be removed: a machine saved at such an address by hand is no computer on a line.
    expect(screen.getByLabelText('Remove MacBook')).toBeTruthy()
    // Whether it is connected is still said, and a server's row is as it was.
    await waitFor(() => expect(screen.getByText('Online')).toBeTruthy())
    expect(screen.getByText(STUDIO.url)).toBeTruthy()
    expect(screen.getByLabelText('Remove Studio')).toBeTruthy()
  })

  test('removing a machine takes it off the daemon\'s list and off the page', async () => {
    await saveMachines(STUDIO)
    render(<MachinesSettings />)

    fireEvent.click(screen.getByLabelText('Remove Studio'))

    await waitFor(() => expect(screen.getByText(/No machines saved/)).toBeTruthy())
    expect(daemon.machines).toEqual([])
  })

  test('removing the machine a run is targeting clears the run target (#1072)', async () => {
    // The composer applies this guard on its own remove; managing the list from settings has to
    // apply it too, or the next agent points at a machine that is no longer in the list.
    await saveMachines(STUDIO)
    selectMachine(STUDIO.id)
    render(<MachinesSettings />)

    fireEvent.click(screen.getByLabelText('Remove Studio'))

    await waitFor(() => expect(getSelectedMachineId()).toBe(null))
  })

  test('a remove the daemon could not do leaves the machine listed and the run target as it was', async () => {
    await saveMachines(STUDIO)
    selectMachine(STUDIO.id)
    machinesRpc.sendRemoveMachine.mockRejectedValueOnce(new Error('the daemon is gone'))
    render(<MachinesSettings />)

    fireEvent.click(screen.getByLabelText('Remove Studio'))

    await waitFor(() => expect(machinesRpc.onMachines).toHaveBeenCalled()) // the list was read again
    expect(screen.getByText('Studio')).toBeTruthy()
    expect(getSelectedMachineId()).toBe(STUDIO.id)
    expect((await screen.findByRole('alert')).textContent).toBe('The machine could not be removed.')
  })

  test('a machine an agent is working on stays, and the section says why; the next remove clears what was said', async () => {
    await saveMachines(STUDIO)
    machinesRpc.sendRemoveMachine.mockResolvedValueOnce({ ok: false, error: 'An agent is working on Studio. Stop it, or wait until it ends, then remove the machine.' })
    render(<MachinesSettings />)

    fireEvent.click(await screen.findByLabelText('Remove Studio'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/^An agent is working on Studio\./)
    expect(screen.getByText('Studio')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Remove Studio'))
    await waitFor(() => expect(screen.queryByText('Studio')).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('removing some other machine leaves the run target alone', async () => {
    await saveMachines(BOX, STUDIO)
    selectMachine(STUDIO.id)
    render(<MachinesSettings />)

    fireEvent.click(screen.getByLabelText('Remove Box'))

    expect(getSelectedMachineId()).toBe(STUDIO.id)
    await waitFor(() => expect(daemon.machines.map(machine => machine.label)).toEqual(['Studio']))
  })
})
