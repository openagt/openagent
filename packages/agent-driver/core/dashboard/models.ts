import type { AgentOffered } from '../src/server.js'

// The coding agents and their models as the agent menu offers them: what each agent answered when
// it was asked, so the menu offers what the agent's own picker offers, by the agent's own names.

/** A model the menu offers: its id, and its name as its agent says it. */
export interface ModelOption {
  value: string
  label: string
}

/** A coding agent the menu offers: its id, its name, its mark, its models, and why it lists none. */
export interface AgentOption {
  value: string
  label: string
  /** Its mark, as SVG markup in the text's colour. */
  logo?: string
  /** Its accounts' list, where it has one: `claude`, `codex`. */
  list?: string
  /** The models it offers. Every entry is a real model id: none of them means "unset". */
  models: ModelOption[]
  /** Why {@link models} is empty, said in its place: the agent is still being asked, or could not say. */
  modelsNote: string
  /** Its program is not on this computer. */
  missing?: true
}

/** Every coding agent with the models it listed, by the names it gives them, or a line saying why there are none. */
export function agentOptions(agents: readonly AgentOffered[] | undefined): AgentOption[] {
  return (agents ?? []).map(agent => {
    const answer = agent.models
    return {
      value: agent.id,
      label: agent.label,
      ...(agent.logo !== undefined ? { logo: agent.logo } : {}),
      ...(agent.list !== undefined ? { list: agent.list } : {}),
      models: answer.models.map(m => ({ value: m.id, label: m.name })),
      modelsNote: 'error' in answer ? (answer.missing ? `${agent.label} is not installed.` : answer.error) : 'No models listed',
      ...('error' in answer && answer.missing ? { missing: true as const } : {}),
    }
  })
}

/** A model of the agent, by its id or the full id it runs today. */
function listed(agent: AgentOffered | undefined, id: string) {
  const models = agent?.models.models ?? []
  return models.find(m => m.id === id) ?? models.find(m => m.resolvedId === id)
}

/** A model's name as its agent shows it ("Opus 5.5" for `opus`); the id itself for one it does not list. */
export function modelName(agent: AgentOffered | undefined, id: string): string {
  return listed(agent, id)?.name ?? id
}

/**
 * The effort levels the picked model offers, by the coding agent's own names and in its own order
 * (`DriverModel.efforts`). Empty for a model that takes none, for an agent that could not list its
 * models, and before it has answered: the menu then has no such part.
 */
export function modelEfforts(agent: AgentOffered | undefined, id: string | undefined): readonly string[] {
  return id === undefined ? [] : (listed(agent, id)?.efforts ?? [])
}
