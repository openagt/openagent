import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'

vi.mock('../rpc/machines.js', async () => (await import('../test-machines.js')).machinesRpc)

import { daemon, machinesRpc, saveMachines } from '../test-machines.js'
import { addMachine, removeMachine, useMachines, useMachinesLoaded } from './machines.js'

const STUDIO = { id: 'http://192.168.1.5:4200', label: 'Studio', url: 'http://192.168.1.5:4200' }

afterEach(async () => {
  cleanup()
  localStorage.clear()
  await saveMachines()
})

function Known() {
  const loaded = useMachinesLoaded()
  const machines = useMachines()
  return createElement('p', null, loaded ? machines.map(machine => machine.label).join(', ') || 'none' : 'not read yet')
}

function List() {
  return createElement('p', null, useMachines().map(machine => machine.label).join(', ') || 'none')
}

describe('the saved machines', () => {
  // First in the file on purpose: it needs a page that has not read the list yet.
  test('are the daemon\'s list, read when a page first needs them; a first read that fails is tried again by the next page, and until an answer "none saved" is not known', async () => {
    daemon.machines = [STUDIO]
    machinesRpc.onMachines.mockRejectedValueOnce(new Error('the daemon is starting'))
    const first = render(createElement(Known))
    await waitFor(() => expect(machinesRpc.onMachines).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(screen.getByText('not read yet')).toBeTruthy()
    first.unmount()
    render(createElement(Known))
    await waitFor(() => expect(screen.getByText('Studio')).toBeTruthy())
  })

  test('a machine is saved by the daemon, and the page then shows it; nothing is kept in the browser', async () => {
    render(createElement(List))
    let result: Awaited<ReturnType<typeof addMachine>> | undefined
    await act(async () => {
      result = await addMachine('http://box.tail.ts:4200/?token=bbb', 'Box')
    })
    expect(result).toEqual({ ok: true, machine: { id: 'http://box.tail.ts:4200', label: 'Box', url: 'http://box.tail.ts:4200' } })
    expect(machinesRpc.sendAddMachine).toHaveBeenCalledWith('http://box.tail.ts:4200/?token=bbb', 'Box')
    expect(screen.getByText('Box')).toBeTruthy()
    expect(localStorage.length).toBe(0)
    expect(JSON.stringify(result)).not.toContain('bbb')
  })

  test('a paste the daemon refuses changes nothing', async () => {
    await saveMachines(STUDIO)
    render(createElement(List))
    await act(async () => {
      expect((await addMachine('http://box.tail.ts:4200/')).ok).toBe(false)
    })
    expect(screen.getByText('Studio')).toBeTruthy()
  })

  test('a removed machine leaves the page', async () => {
    await saveMachines(STUDIO)
    render(createElement(List))
    expect(screen.getByText('Studio')).toBeTruthy()
    await act(async () => {
      expect(await removeMachine(STUDIO.id)).toBe(true)
    })
    expect(screen.getByText('none')).toBeTruthy()
  })

  test('a remove the daemon could not do is answered as not done, without throwing, and the machine is still shown', async () => {
    await saveMachines(STUDIO)
    render(createElement(List))
    machinesRpc.sendRemoveMachine.mockRejectedValueOnce(new Error('the daemon is gone'))
    await act(async () => {
      expect(await removeMachine(STUDIO.id)).toBe(false)
    })
    expect(screen.getByText('Studio')).toBeTruthy()
  })

  test('the list is read again when the window is looked at again: another browser may have changed it', async () => {
    render(createElement(List))
    await waitFor(() => expect(machinesRpc.onMachines).toHaveBeenCalled())
    daemon.machines = [STUDIO]
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(screen.getByText('Studio')).toBeTruthy())
  })
})
