import { runCli as runDoor, type CliIO as DoorIO } from './door/cli.js'
import { runCli as runServers, type CliIO as ServersIO } from './servers/cli.js'

/**
 * The `devices` command: the door's commands as they are (`devices status`, `devices add`), and
 * the servers this computer sets up over SSH under `devices server` (`devices server status`).
 */
export function runCli(args: string[], io: DoorIO & ServersIO): Promise<number> {
  const [first, ...rest] = args
  return first === 'server' ? runServers(rest, io) : runDoor(args, io)
}
