import { execFile } from 'node:child_process'
import { hostname } from 'node:os'
import { readAccounts } from '@openagt/agent-driver'
import { CLAUDE_ACCOUNT_ENV, CLAUDE_TOKEN_ENV, claudeAccountsPath } from '@openagt/agent-driver-claude'
import type { ModuleCommandResult } from '../project-modules.js'
import type { RelayHandlers } from './relay-endpoints.js'
import { giveRemoteLogins, pingRemote, remoteLogins, type MachineAccess } from './remote-run.js'
import { isClaudeAccountId, isServerName, loginsOfOwn, loginsToCopy, type MachineLogins } from './machine-logins.js'

/**
 * Both ends of copying a person's logins to another person's computer (machine-logins.ts).
 *
 * On a server, a person's own OpenAgent holds their GitHub login (its user's `gh`) and their
 * Claude login (an account its runs use: one of their own computer's, `logins-sync.ts`). Before it sends a run to a computer of another
 * person's, it copies what that computer lacks of them, or has an older copy of. A laptop never
 * copies its own logins: they are made for it, and go to no other computer.
 *
 * On that computer, the person's own OpenAgent there takes them as the devices package takes a
 * login handed over on standard input (`own login …`), which keeps them in that person's user's
 * home and says whose and where from.
 *
 * A laptop that sends a run there, through the server, copies nothing: it only looks that the
 * logins are there, and says how they get there when they are not.
 */

/** The package that keeps a person's own logins on a computer several people use. */
const DEVICES = '@openagt/devices'

/** How a command of this computer's packages is run: `runComputerCommand`. */
export type RunComputerCommand = (pkg: string, args: string[], command?: string | null, input?: string | null) => Promise<ModuleCommandResult>

/** What a person's OpenAgent answers at `/_relay/logins`: their logins here, and logins handed over. */
export function personLogins(run: RunComputerCommand): NonNullable<RelayHandlers['logins']> {
  const read = async (): Promise<MachineLogins> => {
    const said = await run(DEVICES, ['server', 'own']).catch((): undefined => undefined)
    return said?.ok ? loginsOfOwn(said.output) : {}
  }
  return {
    read,
    give: async given => {
      const from = given.from !== undefined ? ['--from', given.from] : []
      // GitHub first: a Claude login starts this OpenAgent again, a moment after its command answered.
      for (const kind of ['github', 'claude'] as const) {
        const login = given[kind]
        if (login === undefined) continue
        const account = kind === 'claude' && given.claudeAccount !== undefined ? ['--account', given.claudeAccount] : []
        const said = await run(DEVICES, ['server', 'own', 'login', kind, ...from, ...account], null, login)
        if (!said.ok) return { ok: false, error: said.error }
        const status = (said.output as { logins?: Record<string, { there?: unknown; said?: unknown }> } | null)?.logins?.[kind]
        if (status?.there !== true || typeof status.said === 'string') return { ok: false, error: typeof status?.said === 'string' ? status.said : `The ${kind === 'github' ? 'GitHub' : 'Claude'} login was not taken.` }
      }
      return { ok: true, logins: await read() }
    },
  }
}

/** This OpenAgent's own GitHub login, as its user's `gh` keeps it; nothing when it has none. */
function ownGithub(said: NodeJS.ProcessEnv): Promise<string | undefined> {
  // Its own file, whatever this process was started with of another place or another login.
  const env = { ...said }
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME']) delete env[name]
  return new Promise(resolve => {
    execFile('gh', ['auth', 'token', '--hostname', 'github.com'], { env, timeout: 10_000 }, (err, out) => {
      const login = err ? '' : String(out).trim()
      resolve(login || undefined)
    })
  })
}

/** This OpenAgent's own logins: what it would copy, and who the Claude login is when known. */
export interface OwnLogins {
  github?: string
  claude?: string
  claudeAccount?: string
}

/**
 * The logins this OpenAgent works with: its user's `gh`, and the Claude login its runs take first:
 * one of its added accounts, as a login of the person's own computer is here, else the one its
 * service started it with.
 */
export async function ownLogins(env: NodeJS.ProcessEnv = process.env): Promise<OwnLogins> {
  const github = await ownGithub(env)
  const added = readAccounts(claudeAccountsPath(env)).find(account => account.login !== undefined)
  const claude = added?.login ?? env[CLAUDE_TOKEN_ENV]?.trim()
  const claudeAccount = added ? added.accountId : env[CLAUDE_ACCOUNT_ENV]?.trim()
  return { ...(github ? { github } : {}), ...(claude ? { claude, ...(isClaudeAccountId(claudeAccount) ? { claudeAccount } : {}) } : {}) }
}

/** This server's name, as a copy says where it came from. */
function ownName(): string {
  const name = hostname()
  return isServerName(name) ? name : 'server'
}

export interface CopyOptions {
  own?: () => Promise<OwnLogins>
  /** How long to wait for the machine's OpenAgent to answer again after a Claude login, which starts it anew. */
  backMs?: number
  /** How often to ask it meanwhile. */
  pollMs?: number
}

/**
 * Copy this OpenAgent's logins to a machine of another person's, where that machine lacks them or
 * has an older copy, before a run is sent there. Answers why not in the machine's words: a person's
 * place there still being made, a login it did not take.
 */
export async function copyLoginsTo(machine: MachineAccess & { label: string }, opts: CopyOptions = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const there = await remoteLogins(machine)
  if (!there.ok) return { ok: false, error: `${machine.label}: ${there.error}` }
  const wanted = loginsToCopy(await (opts.own ?? ownLogins)(), there.logins)
  if (wanted.github === undefined && wanted.claude === undefined) return { ok: true }
  const given = await giveRemoteLogins(machine, { ...wanted, from: ownName() })
  if (!given.ok) return { ok: false, error: `Your logins could not be copied to ${machine.label}: ${given.error}` }
  if (wanted.claude === undefined) return { ok: true }
  // A Claude login starts that OpenAgent again: the run is sent once it answers.
  const pollMs = opts.pollMs ?? 1_000
  const until = Date.now() + (opts.backMs ?? 60_000)
  await new Promise(resolve => setTimeout(resolve, pollMs * 2))
  while (Date.now() < until) {
    if (await pingRemote(machine)) return { ok: true }
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  return { ok: false, error: `${machine.label} did not answer again after your Claude login was copied there. Try again in a moment.` }
}

/**
 * On a laptop, before a run is sent to a computer of another person's: whether this person's
 * logins are there. Only their server copies them, at a run started from its page, or they make
 * them there themselves. Answers why not, in words the person acts on.
 */
export async function loginsAreThere(machine: MachineAccess & { label: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const there = await remoteLogins(machine)
  if (!there.ok) return { ok: false, error: `${machine.label}: ${there.error}` }
  if (there.logins.github !== undefined && there.logins.claude !== undefined) return { ok: true }
  return { ok: false, error: `Your GitHub and Claude logins are not on ${machine.label} yet. Start your first run there from your page on its server, which copies them, or log in there on its page in Settings › Devices.` }
}
