import type { Hooks } from '@openagt/hooks'
import { listMachines, type MachineRecord } from './registry.js'

/**
 * The person's other computers, the saved machines, are reached only where devices is on
 * (#2394): with it off, this computer has no door, no pairing and no other computer. OpenAgent's
 * own code reaches them until that code moves into devices; the daemon wires devices' switch in,
 * and a test of that code works with every saved machine.
 */
export const otherComputers = {
  /** Whether this computer reaches its saved machines. */
  on: async (): Promise<boolean> => true,
}

/** The package of the door and of the person's other computers: devices. */
export const DEVICES_PACKAGE = '@openagt/devices'

/** Whether devices is on among the modules: never in a distribution without it. */
export async function devicesOn(hooks: Hooks): Promise<boolean> {
  const module = hooks.ofPackage(DEVICES_PACKAGE)
  return module !== undefined && (await hooks.enabled(module.name))
}

/** The saved machines this computer reaches: every one where devices is on, none where it is off. */
export async function savedMachines(env: NodeJS.ProcessEnv = process.env): Promise<MachineRecord[]> {
  return (await otherComputers.on()) ? listMachines(env) : []
}
