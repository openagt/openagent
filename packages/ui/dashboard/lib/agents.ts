import { useLoaded } from './use-async.js'
import { onCodingAgents, onNamesRuns, type AgentSaid } from '../rpc/agents.js'

// The coding agents as each says itself (`run.agent`, #2394): its name, its mark and its models,
// for every page that shows a run. The shell names none of them: a run's record names its agent
// by id, and these read what that agent says of it. Asked once and remembered for the page's
// life, so every row that names a model shows its name from its first frame.

export type { AgentSaid }

/** The coding agents of the distribution, in its order; `undefined` until the daemon has answered. */
export function useAgents(): AgentSaid[] | undefined {
  return useLoaded<AgentSaid[] | undefined>(onCodingAgents, undefined, [], { remember: 'coding-agents', stored: true })
}

/** The agent a run's record names, by its id; none for one the distribution does not have. */
export function agentOf(agents: readonly AgentSaid[] | undefined, id: string | undefined): AgentSaid | undefined {
  return id === undefined ? undefined : agents?.find(agent => agent.id === id)
}

/** A model as its agent lists it, by its id or by the full id it runs today. */
function listed(agent: AgentSaid | undefined, id: string) {
  const models = agent?.models.models ?? []
  return models.find(m => m.id === id) ?? models.find(m => m.resolvedId === id)
}

/**
 * A model's name as its agent shows it ("Opus 5.5" for `opus`). A model the agent does not list,
 * or an agent not answered yet, is named by the id itself: that is what the run was given or ran.
 */
export function modelName(agent: AgentSaid | undefined, id: string): string {
  return listed(agent, id)?.name ?? id
}

/** A model's name as whichever agent lists it, for a reader that does not know which agent ran it (a subagent says only its model). */
export function anyModelName(agents: readonly AgentSaid[] | undefined, id: string): string {
  for (const agent of agents ?? []) {
    const name = listed(agent, id)?.name
    if (name !== undefined) return name
  }
  return id
}

/** How much conversation the model holds, by its agent's own word; `undefined` for one nobody has said it of. */
export function modelContextWindow(agent: AgentSaid | undefined, id: string | undefined): number | undefined {
  return id === undefined ? undefined : listed(agent, id)?.contextWindow
}

/** A coding agent as a module offers it for a pick: its id (`value`), its name, its models by their names, and why it lists none. */
export interface CodingAgent {
  value: string
  label: string
  /** Its mark, as SVG markup in the text's colour. */
  logo?: string
  models: { value: string; label: string }[]
  modelsNote?: string
}

/**
 * Every coding agent with the models it lists (#1902), for a module that lets a person pick one
 * or names the one a run was on, so what it says is what the agent says.
 */
export function useCodingAgents(): CodingAgent[] {
  return (useAgents() ?? []).map(agent => ({
    value: agent.id,
    label: agent.label,
    ...(agent.logo !== undefined ? { logo: agent.logo } : {}),
    models: agent.models.models.map(m => ({ value: m.id, label: m.name })),
    ...('error' in agent.models ? { modelsNote: agent.models.missing ? `${agent.label} is not installed.` : agent.models.error } : agent.models.models.length === 0 ? { modelsNote: 'No models listed' } : {}),
  }))
}

/** Whether each run started on this computer is named as it starts (agent-driver's setting): a list holds a new run's place for its name. */
export function useNamesRuns(): boolean {
  return useLoaded<boolean>(onNamesRuns, true, [], { remember: 'names-runs', stored: true })
}
