import type * as impl from '../../src/dashboard-rpc/machines.js'
import { rpc } from '../lib/rpc.js'

// The types the RPCs speak in, straight from the implementations — erased at build, so importing
// them here pulls no server code into the bundle.
export type * from '../../src/dashboard-rpc/machines.js'

// Typed stubs for the `machines` RPCs (F3). Each is checked against the implementation's own
// signature, so a rename or a changed argument is a type error here rather than a 404 at runtime.

export const onMachines = rpc<typeof impl.onMachines>('onMachines')
export const sendAddMachine = rpc<typeof impl.sendAddMachine>('sendAddMachine')
export const sendRemoveMachine = rpc<typeof impl.sendRemoveMachine>('sendRemoveMachine')
export const onMachinesReachable = rpc<typeof impl.onMachinesReachable>('onMachinesReachable')
