import { act, read, type RpcComputerHost } from '@openagt/hooks/rpc'
import { COMMAND_MAX, NOTIFY_COMMAND, isCommandLine } from './command.js'

// notifications-command's server part (`@openagt/hooks/rpc`): what its Settings entry reads and
// saves, in no project, since the command is this computer's. What a caller sends is checked here,
// whatever its type says: it comes from a page.

/** The person's command on this computer: empty when there is none. */
export const command = read((host: RpcComputerHost, _input: object): Promise<string> => host.settings.get(NOTIFY_COMMAND))

/** Save the person's command on this computer; empty takes it away. */
export const saveCommand = act(async (host: RpcComputerHost, input: { command: string }): Promise<void> => {
  if (!isCommandLine(input.command)) throw new Error(`A command is one line of at most ${COMMAND_MAX} characters.`)
  await host.settings.set(NOTIFY_COMMAND, input.command.trim())
})
