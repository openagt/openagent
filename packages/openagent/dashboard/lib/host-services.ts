import { createContext, useContext } from 'react'
import type { ModuleHostBase } from '../module/index.js'

// The dashboard's services for modules (#1774), as the shell provides them once: navigation, a
// run's start, a project's runs. Every module page and every link action gets the same services,
// bound to its own package by whoever builds the host. Nothing here names a skill.

/** The services, minus the package they are bound to: what the shell has, before a module is known. */
export type HostServices = Omit<ModuleHostBase, 'package'>

/**
 * Services for a shell that provides none (a unit test renders a page or a slot alone): nothing
 * navigates, a start answers that there is no dashboard, no project has runs.
 */
export const INERT_HOST_SERVICES: HostServices = {
  openAgent() {},
  openPage() {},
  pageHref: segment => `/${segment}`,
  async startRun() {
    return { ok: false, error: 'no dashboard to start a run from' }
  },
  configureRun() {},
  async agents() {
    return []
  },
  async machines() {
    return { version: 'unknown', machines: [] }
  },
  async addMachine() {
    return { ok: false, error: 'no dashboard to save a machine in' }
  },
  async removeMachine() {
    return { ok: false, error: 'no dashboard to remove a machine from' }
  },
  async renameMachine() {
    return { ok: false, error: 'no dashboard to rename a machine in' }
  },
  async letMachineIn() {
    return { ok: false, error: 'no dashboard to ask a machine from' }
  },
  async machineCode() {
    return { ok: false, error: 'no dashboard to ask a machine from' }
  },
  async computersThrough() {
    return { ok: true, computers: [] }
  },
  async addComputerThrough() {
    return { ok: false, error: 'no dashboard to save a machine in' }
  },
  async machinePerson() {
    return { ok: false, error: 'no dashboard to ask a machine from', unknown: true }
  },
  async removeMachineDevice() {
    return { ok: false, error: 'no dashboard to ask a machine from' }
  },
  async watchScreen() {
    return undefined
  },
  async sendToScreen() {
    return false
  },
}

/** Set by the shell around the whole dashboard: the services every module's host is built from. */
export const HostServicesContext = createContext<HostServices | null>(null)

/** The shell's services bound to one module package: the base of that module's host. */
export function useHostServices(pkg: string): ModuleHostBase {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  return { ...services, package: pkg }
}
