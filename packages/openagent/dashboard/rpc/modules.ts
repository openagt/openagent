import type * as impl from '../../src/dashboard-rpc/modules.js'
import { rpc } from '../lib/rpc.js'

// The types the RPCs speak in, straight from the implementations — erased at build, so importing
// them here pulls no server code into the bundle.
export type * from '../../src/dashboard-rpc/modules.js'

// Typed stubs for the `modules` RPCs (#1774): which modules the dashboard loads, a module
// running its own package's command in one project (or in none, when it is the computer's), and a
// module calling its own server part.
export const onModules = rpc<typeof impl.onModules>('onModules')
export const runModuleCommand = rpc<typeof impl.runModuleCommand>('runModuleCommand')
export const runComputerCommand = rpc<typeof impl.runComputerCommand>('runComputerCommand')
export const readModule = rpc<typeof impl.readModule>('readModule')
