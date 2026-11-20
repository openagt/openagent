import { createHooks, DISTRIBUTION_ENV, loadHandedDown, type DistributionEntry, type RunAgent } from '@openagt/hooks'

/**
 * The coding agents a run can be on (#2394): those the modules of its distribution fill `run.agent`
 * with, by the id a run's options and record name. The engine names none of them: a run on no
 * named agent is on the distribution's first.
 */

/** The coding agents of the distribution handed down to this process, as read last, by the file they were read off. */
let read: { file: string; agents: Promise<RunAgent[]> } | undefined

/**
 * The coding agents of `modules`, else of the distribution handed down to this process
 * ({@link DISTRIBUTION_ENV}), read once for each distribution file; none where none was handed down.
 */
export function codingAgents(modules?: readonly DistributionEntry[], env: NodeJS.ProcessEnv = process.env): Promise<RunAgent[]> {
  if (modules) return createHooks(modules).agents()
  const file = env[DISTRIBUTION_ENV] ?? ''
  if (read?.file !== file) {
    const agents = loadHandedDown(env).then(handed => (handed ? createHooks(handed).agents() : []))
    // A distribution that did not load is read again at the next call, not kept as its answer.
    agents.catch(() => {
      if (read?.agents === agents) read = undefined
    })
    read = { file, agents }
  }
  return read.agents
}

/** A coding agent no module of the distribution fills `run.agent` with. */
export class UnknownAgent extends Error {
  constructor(
    readonly id: string | undefined,
    agents: readonly RunAgent[],
  ) {
    super(agents.length === 0 ? `No coding agent was handed down to this process: its distribution (${DISTRIBUTION_ENV}) has none` : `No coding agent is named ${id}: the coding agents are ${agentNames(agents)}.`)
  }
}

/** The ids of `agents`, as a sentence says them: `claude-code and codex`. */
export function agentNames(agents: readonly RunAgent[]): string {
  const ids = agents.map(agent => agent.id)
  return ids.length > 1 ? `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}` : (ids[0] ?? 'none')
}

/** The coding agent named `id`, or the distribution's first when none is named; {@link UnknownAgent} when it has no such one. */
export async function codingAgent(id: string | undefined, modules?: readonly DistributionEntry[]): Promise<RunAgent> {
  const agents = await codingAgents(modules)
  const agent = id === undefined ? agents[0] : agents.find(one => one.id === id)
  if (!agent) throw new UnknownAgent(id, agents)
  return agent
}
