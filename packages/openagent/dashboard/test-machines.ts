import { vi } from 'vitest'
import { parseMachineLink } from '../src/client.js'
import type { AddMachineResult, Machine, RemoveMachineResult } from './rpc/machines.js'

// A daemon's saved machines, for a test: what the `machines` RPCs read and write. A test file
// mocks the stubs with it, `vi.mock('../rpc/machines.js', async () => (await import('../test-machines.js')).machinesRpc)`,
// and seeds it through {@link saveMachines}.

/** What the pretend daemon holds: the list, the code each machine was added with, and which machines answer. */
export const daemon: { machines: Machine[]; codes: Record<string, string>; reachable: Record<string, boolean> } = {
  machines: [],
  codes: {},
  reachable: {},
}

export const machinesRpc = {
  onMachines: vi.fn(async (): Promise<Machine[]> => [...daemon.machines]),
  sendAddMachine: vi.fn(async (pasted: string, label?: string): Promise<AddMachineResult> => {
    const parsed = parseMachineLink(pasted)
    if (!parsed) return { ok: false, error: 'refused' }
    const machine: Machine = { id: parsed.url, label: label?.trim() || new URL(parsed.url).host, url: parsed.url }
    daemon.machines = [machine, ...daemon.machines.filter(saved => saved.id !== machine.id)]
    daemon.codes[machine.id] = parsed.code
    return { ok: true, machine }
  }),
  sendRemoveMachine: vi.fn(async (id: string): Promise<RemoveMachineResult> => {
    daemon.machines = daemon.machines.filter(saved => saved.id !== id)
    return { ok: true }
  }),
  onMachinesReachable: vi.fn(async (): Promise<Record<string, boolean>> => ({ ...daemon.reachable })),
}

/** Set what the pretend daemon has saved, and have the page read it. Call with none to empty it. */
export async function saveMachines(...machines: Machine[]): Promise<void> {
  daemon.machines = machines
  daemon.codes = {}
  daemon.reachable = {}
  for (const stub of Object.values(machinesRpc)) stub.mockClear()
  const { refreshMachines } = await import('./lib/machines.js')
  await refreshMachines()
}
