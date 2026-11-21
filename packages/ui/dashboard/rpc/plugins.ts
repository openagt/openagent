import type * as impl from '../../src/dashboard-rpc/plugins.js'
import { rpc } from '../lib/rpc.js'

export type * from '../../src/dashboard-rpc/plugins.js'

// Settings › Plugins: each plugin with its Enabled row, the person's switch.
export const onComputerPlugins = rpc<typeof impl.onComputerPlugins>('onComputerPlugins')
export const onProjectPlugins = rpc<typeof impl.onProjectPlugins>('onProjectPlugins')
export const sendSwitchPlugin = rpc<typeof impl.sendSwitchPlugin>('sendSwitchPlugin')
