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
export const onMachineVersions = rpc<typeof impl.onMachineVersions>('onMachineVersions')
export const sendProjectToMachine = rpc<typeof impl.sendProjectToMachine>('sendProjectToMachine')
export const onProjectOnMachine = rpc<typeof impl.onProjectOnMachine>('onProjectOnMachine')
export const sendProjectHere = rpc<typeof impl.sendProjectHere>('sendProjectHere')
export const onProjectHere = rpc<typeof impl.onProjectHere>('onProjectHere')
export const onMachineStartCheck = rpc<typeof impl.onMachineStartCheck>('onMachineStartCheck')
export const onMachineModels = rpc<typeof impl.onMachineModels>('onMachineModels')
export const onComputersThrough = rpc<typeof impl.onComputersThrough>('onComputersThrough')
export const sendAddComputerThrough = rpc<typeof impl.sendAddComputerThrough>('sendAddComputerThrough')
export const onMachinePerson = rpc<typeof impl.onMachinePerson>('onMachinePerson')
export const sendRemoveMachineDevice = rpc<typeof impl.sendRemoveMachineDevice>('sendRemoveMachineDevice')
export const sendRenameMachine = rpc<typeof impl.sendRenameMachine>('sendRenameMachine')
export const sendRenameComputer = rpc<typeof impl.sendRenameComputer>('sendRenameComputer')
export const sendLetMachineIn = rpc<typeof impl.sendLetMachineIn>('sendLetMachineIn')
export const sendMachineCode = rpc<typeof impl.sendMachineCode>('sendMachineCode')
export const sendMachineTold = rpc<typeof impl.sendMachineTold>('sendMachineTold')
export const onMachineLogins = rpc<typeof impl.onMachineLogins>('onMachineLogins')
