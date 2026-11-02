import { createContext, useContext, useMemo, useRef } from 'react'
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
  openSettings() {},
  async gitHostPeople() {
    return []
  },
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
  async renameComputer() {
    return { ok: false, error: 'no dashboard to rename this computer in' }
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
  async machineAccounts() {
    return null
  },
  async removeMachineAccount() {
    return { ok: false, error: 'no dashboard to ask a machine from' }
  },
  async useLoginsOn() {
    return { ok: false, error: 'no dashboard to give a server logins from' }
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

/**
 * The shell's services as one object for the page's life, each calling the latest one the shell
 * gave: a module keys an effect on its host, and a host made anew at every render of the shell
 * started that effect over each time, a read that waits included.
 */
export function useSteadyServices(services: HostServices): HostServices {
  const latest = useRef(services)
  latest.current = services
  return useMemo(() => {
    const steady: Record<string, unknown> = {}
    for (const name of Object.keys(services)) steady[name] = (...args: unknown[]) => (latest.current as unknown as Record<string, (...args: unknown[]) => unknown>)[name]!(...args)
    return steady as unknown as HostServices
    // The names are the same at every render; what each one calls is read when it is called.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** The shell's services bound to one module package: the base of that module's host, the same object while the package is. */
export function useHostServices(pkg: string): ModuleHostBase {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  return useMemo(() => ({ ...services, package: pkg }), [services, pkg])
}
