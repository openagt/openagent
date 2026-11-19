import { read, type RpcComputerHost } from '@openagt/hooks/rpc'
import { addingBoth, listing } from './reads.js'
import { readUsage } from './usage.js'
import { loginWiring } from './wiring.js'

// account-rotation's server part (`@openagt/hooks/rpc`): what its card reads, called in no project,
// since the accounts are this computer's. It answers what the command's reads answer, and the card
// changes the accounts through the command, as an agent does.

/** Each agent's accounts in the order runs try them, never a login, and the agents not installed: `list`. */
export const list = read((_host: RpcComputerHost, _input: object) => listing(loginWiring()))

/** How full each account is, read now where it can be: `usage`. */
export const usage = read((_host: RpcComputerHost, _input: object) => readUsage(loginWiring()))

/** How adding stands for each agent, where to sign in and why the last one did not go through: `adding`. */
export const adding = read(async (_host: RpcComputerHost, _input: object) => addingBoth(loginWiring()))
