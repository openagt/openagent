import { NAME_RUNS, type DriverModel } from '@openagt/hooks'
import { distributionHooks, distributionSettings } from '../distribution-hooks.js'
import { contextOpenAgentUpdate } from './context.js'
import type { OpenAgentUpdate } from '../dashboard/openagent-update.js'

// What a run's agent says of itself (`run.agent`, #2394), for every page that shows a run: its
// name, its mark and its models, read off the distribution's coding agents. The shell names none
// of them. Whether runs are named as they start (the catalog's setting), so a list says a name is
// coming. And whether a newer OpenAgent is out.

/** What one coding agent offers: its models, or why it could not say; `missing` when its program is not on this computer. */
export type AgentModelsSaid = { models: DriverModel[] } | { models: []; error: string; missing?: true }

/** A coding agent, as it says itself. */
export interface AgentSaid {
  /** What a run's record names it by. */
  id: string
  /** Its name for a person. */
  label: string
  /** Its mark, as SVG markup in the text's colour. */
  logo?: string
  models: AgentModelsSaid
}

/** The coding agents of the distribution, in its order, each with the models it offers. */
export async function onCodingAgents(): Promise<AgentSaid[]> {
  const agents = await (await distributionHooks()).agents()
  return Promise.all(
    agents.map(async (agent): Promise<AgentSaid> => {
      const models: AgentModelsSaid = agent.models
        ? await agent.models().then(
            listed => ({ models: listed }),
            (err: unknown) => ({ models: [] as [], error: err instanceof Error ? err.message : String(err), ...(['ENOENT', 'EACCES'].includes(String((err as NodeJS.ErrnoException).code)) ? { missing: true as const } : {}) }),
          )
        : { models: [], error: 'it cannot list its models' }
      return { id: agent.id, label: agent.label, ...(agent.logo !== undefined ? { logo: agent.logo } : {}), models }
    }),
  )
}

/** Whether each run started on this computer is named as it starts: a list says "naming…" until its name is in. */
export async function onNamesRuns(): Promise<boolean> {
  return (await distributionSettings()).get(NAME_RUNS).catch(() => true)
}

/** A newer OpenAgent than the one running here; null when there is none. */
export async function onOpenAgentUpdate(): Promise<OpenAgentUpdate | null> {
  return (await contextOpenAgentUpdate().read()) ?? null
}
