import { act, read, type RpcComputerHost } from '@openagt/hooks/rpc'
import { isKind, readKinds, saveKind as save, type Kind, type Kinds } from './kinds.js'

// notifications-browser's server part (`@openagt/hooks/rpc`): what its notifier and its Settings
// entry read and save, in no project, since the switches are the person's. What a caller sends is
// checked here, whatever its type says: it comes from a page.

/** What the person's notifications are about. */
export const kinds = read((host: RpcComputerHost, _input: object): Promise<Kinds> => readKinds(host.settings))

/** Switch one kind on or off; answers the kinds as they then stand. */
export const saveKind = act(async (host: RpcComputerHost, input: { kind: Kind; on: boolean }): Promise<Kinds> => {
  if (!isKind(input.kind) || typeof input.on !== 'boolean') throw new Error('A kind of notification is waiting or activity, switched on or off.')
  await save(host.settings, input.kind, input.on)
  return readKinds(host.settings)
})
