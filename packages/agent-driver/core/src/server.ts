import { act, read, type RpcComputerHost } from '@openagt/hooks/rpc'
import { NAME_RUNS, PICKED_AGENT, PICKED_PROFILE, PROFILES, profileOf, type AgentPick } from '@openagt/hooks'
import { codingAgents } from './agents.js'
import { addingAll, listing } from './accounts/reads.js'
import { readUsage } from './accounts/usage.js'
import { loginWiring } from './accounts/wiring.js'
import { modelsOf, type AgentModels } from './models.js'
import { agentStates, installAgent, type AgentState } from './setup.js'
import { updatesHere, type AgentUpdate, type AgentUpdateResult } from './updates.js'
import { quotaHere, type QuotaView } from './usage/quota.js'

// agent-driver's server part (`@openagt/hooks/rpc`), called in no project, since what it reads is
// this computer's: the coding agents with their models, the picks made for every next run, the
// accounts each agent's runs take (what the command's reads answer: the accounts card changes them
// through the command, as an agent does), how full the account is against its boundary, what each
// agent needs to run here, and its newer versions.

export type { AgentModels, AgentState, AgentUpdate, AgentUpdateResult, QuotaView }

/** A coding agent as the controls under the message box offer it: what it says of itself, and its models, or why it lists none. */
export interface AgentOffered {
  id: string
  label: string
  /** Its mark, as SVG markup in the text's colour. */
  logo?: string
  /** Its accounts' list, where it has one: `claude`, `codex`. */
  list?: string
  models: AgentModels
}

/** The coding agents of the distribution, in its order, each with the models it offers: `agents`. */
export const agents = read(async (_host: RpcComputerHost, _input: object): Promise<AgentOffered[]> =>
  Promise.all(
    (await codingAgents()).map(async agent => ({
      id: agent.id,
      label: agent.label,
      ...(agent.logo !== undefined ? { logo: agent.logo } : {}),
      ...(agent.accounts ? { list: agent.accounts.list } : {}),
      models: await modelsOf(agent),
    })),
  ),
)

/**
 * The coding agent, model and effort a run started on this computer is on where its options name
 * no agent, as its start reads them (`withPicks` in `engine/host.ts`): its profile's (`profile`,
 * else the one picked for every next run) where that names an agent, else the one picked for every
 * next run here: `picked`.
 */
export const picked = read(async (host: RpcComputerHost, input: { profile?: string }): Promise<AgentPick> => {
  const id = typeof input?.profile === 'string' ? input.profile : await host.settings.get(PICKED_PROFILE)
  const { driver, model, effort } = profileOf(await host.settings.get(PROFILES), id).options['agent-driver'] ?? {}
  if (driver === undefined) return host.settings.get(PICKED_AGENT)
  return { driver, ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}) }
})

/** Pick the coding agent, model and effort every next run on this computer is on: `pick`. */
export const pick = act(async (host: RpcComputerHost, input: AgentPick): Promise<AgentPick> => {
  const parsed = PICKED_AGENT.parse(input) ?? {}
  await host.settings.set(PICKED_AGENT, parsed)
  return parsed
})

/** Whether each run started on this computer is named by a small model: `naming`. */
export const naming = read((host: RpcComputerHost, _input: object): Promise<boolean> => host.settings.get(NAME_RUNS))

/** Name each run started on this computer, or not: `setNaming`. */
export const setNaming = act(async (host: RpcComputerHost, input: { on: boolean }): Promise<boolean> => {
  await host.settings.set(NAME_RUNS, input.on === true)
  return input.on === true
})

/** Each list's accounts in the order runs try them, never a login, and the lists whose agent is not installed: `list`. */
export const list = read((_host: RpcComputerHost, _input: object) => listing(loginWiring()))

/** How full each account is, read now where it can be: `usage`. */
export const usage = read((_host: RpcComputerHost, _input: object) => readUsage(loginWiring()))

/** How adding stands for each list, where to sign in and why the last one did not go through: `adding`. */
export const adding = read((_host: RpcComputerHost, _input: object) => addingAll(loginWiring()))

/** Where the account's quota stands against its boundary, as the first coding agent that says its quota reads it: `quota`. */
export const quota = read(async (_host: RpcComputerHost, _input: object): Promise<QuotaView> =>
  // No windows and no boundary rather than zeroes: an empty bar reads as "nothing used", which is the one thing the bar must never imply.
  quotaHere().read().catch((): QuotaView => ({ windows: [], unavailable: 'fetch-failed' })),
)

/** Whether each coding agent can run here, and what a press does about what is missing: `states`. */
export const states = read((_host: RpcComputerHost, _input: object): Promise<AgentState[]> => agentStates())

/** Install a coding agent's program, with the command its package declared: answered at once, followed in `states`. */
export const install = act((_host: RpcComputerHost, input: { agent: string }) => installAgent(String(input.agent)))

/** The coding agents on this computer with a newer version out: `updates`. */
export const updates = read((_host: RpcComputerHost, _input: object): Promise<AgentUpdate[]> => updatesHere().read())

/** Update a coding agent on this computer, by its own `update` command: `update`. */
export const update = act((_host: RpcComputerHost, input: { agent: string }): Promise<AgentUpdateResult> => updatesHere().update(String(input.agent)))
