import type * as impl from '../../src/dashboard-rpc/modules.js'
import type { callModule as callModuleImpl, ModuleCallResult } from '../../src/dashboard-rpc/module-calls.js'
import { rpc } from '../lib/rpc.js'

// The types the RPCs speak in, straight from the implementations — erased at build, so importing
// them here pulls no server code into the bundle.
export type * from '../../src/dashboard-rpc/modules.js'
export type { ModuleCallResult } from '../../src/dashboard-rpc/module-calls.js'

// Typed stubs for the `modules` RPCs (#1774): which modules the dashboard loads, a module
// running its own package's command in one project (or in none, when it is the computer's), and a
// module calling a function of its own server part, at `/_rpc/<module>/<name>`.
export const onModules = rpc<typeof impl.onModules>('onModules')
export const runModuleCommand = rpc<typeof impl.runModuleCommand>('runModuleCommand')
export const runComputerCommand = rpc<typeof impl.runComputerCommand>('runComputerCommand')
/** Call function `name` of the server part of the module package `pkg`, in one project, or with `null` for a package that is this computer's, with `input`. */
export function callModule(pkg: string, name: string, projectId: string | null, input: object): Promise<ModuleCallResult> {
  return rpc<(projectId: string | null, input: object) => ReturnType<typeof callModuleImpl>>(`${encodeURIComponent(pkg)}/${encodeURIComponent(name)}`)(projectId, input)
}
