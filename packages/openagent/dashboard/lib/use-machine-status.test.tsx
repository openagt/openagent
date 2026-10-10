import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Machine } from './machines.js'

vi.mock('../rpc/machines.js', async () => (await import('../test-machines.js')).machinesRpc)

import { daemon, machinesRpc, saveMachines } from '../test-machines.js'
const { useMachineStatus } = await import('./use-machine-status.js')

afterEach(async () => {
  cleanup()
  await saveMachines()
})

const STUDIO = 'http://192.168.1.5:4200'
const machines: Machine[] = [{ id: STUDIO, label: 'Studio', url: STUDIO }]

function Probe({ list = machines }: { list?: Machine[] }) {
  const status = useMachineStatus(list)
  return <span>{status[STUDIO] ?? 'unknown'}</span>
}

// #1072: the daemon holds each machine's key, so it makes the call and the page reads back a
// reachable map. The dots are display-only, so this just has to surface online/offline as the poll answers.
describe('useMachineStatus', () => {
  test('a reachable machine surfaces online, and the page hands the daemon no key to ask with', async () => {
    daemon.reachable = { [STUDIO]: true }
    render(<Probe />)
    await waitFor(() => expect(screen.getByText('online')).toBeTruthy())
    expect(machinesRpc.onMachinesReachable).toHaveBeenCalledWith()
  })

  test('an unreachable machine surfaces offline', async () => {
    daemon.reachable = { [STUDIO]: false }
    render(<Probe />)
    await waitFor(() => expect(screen.getByText('offline')).toBeTruthy())
  })

  test('with no saved machines it never polls', async () => {
    render(<Probe list={[]} />)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(machinesRpc.onMachinesReachable).not.toHaveBeenCalled()
    expect(screen.getByText('unknown')).toBeTruthy()
  })
})
