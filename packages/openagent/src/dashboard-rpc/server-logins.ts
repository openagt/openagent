import { thisComputerName } from '../registry.js'
import { useLoginsOn } from '../registry.js'
import { allowLogins, serverLogins, settleLeft, syncLogins, type ServerLogins } from '../dashboard/logins-sync.js'
import type { CopiedKind } from '../dashboard/copied-logins.js'
import type { AccountResult } from './accounts.js'

// The servers of the person's that use this computer's logins, as Settings › Accounts shows them
// (`logins-sync.ts` keeps them up to them): how each of this computer's accounts stands there, the
// press that makes a server the logins that cannot go as they are, and the answer for a login the
// server has that this computer no longer has.

export type { ServerLogins, LoginThere } from '../dashboard/logins-sync.js'

export interface ServerLoginsView {
  /** This computer's own name: what a server says its logins are from. */
  computer: string
  servers: ServerLogins[]
}

/** Each saved server of the person's, and how this computer's logins stand there. */
export async function onServerLogins(): Promise<ServerLoginsView> {
  // A server uses the logins of the person's computers, and makes none for another.
  if (process.env['OPENAGENT_SERVER'] === '1') return { computer: await thisComputerName(), servers: [] }
  return { computer: await thisComputerName(), servers: await serverLogins() }
}

/** A server uses this computer's logins from now on: what can go there goes now. */
export async function sendUseLoginsOn(machineId: string): Promise<AccountResult> {
  if (!(await useLoginsOn(machineId, true))) return { ok: false, error: 'That server is no longer saved.' }
  await syncLogins()
  return { ok: true }
}

/** The press: a login of the server's own for each account that waits for one, made in this computer's browser. */
export async function sendAllowLogins(machineId: string): Promise<AccountResult> {
  return allowLogins(machineId)
}

/** A login the server has of this computer's that this computer no longer has: kept there, or taken off. */
export async function sendSettleLogin(machineId: string, which: { kind: CopiedKind; host?: string; source: string }, keep: boolean): Promise<AccountResult> {
  return settleLeft(machineId, which, keep === true)
}
