import { contextAgentUpdates, contextModels } from './context.js'

import type { AgentUpdate, AgentUpdateResult, OpenAgentUpdate } from '../dashboard/agent-updates.js'
import { isDriverName } from '../driver-names.js'
import type { ModelsView } from '../dashboard/models.js'

// The agent and model menu's surface: which models each coding agent offers, as the daemon asked
// them. And whether a newer version of an agent is out, with the press that takes it. Both sources
// are wired into the dashboard context by the daemon.

/** Which models each coding agent offers, or why one could not say. */
export function onModels(): Promise<ModelsView> {
  return contextModels().read()
}

/** The coding agents on this computer with a newer version out. */
export function onAgentUpdates(): Promise<AgentUpdate[]> {
  return contextAgentUpdates().read()
}

/** A newer OpenAgent than the one running here; null when there is none. */
export async function onOpenAgentUpdate(): Promise<OpenAgentUpdate | null> {
  return (await contextAgentUpdates().openAgent()) ?? null
}

/** Update a coding agent on this computer, by its own `update` command. */
export function sendAgentUpdate(agent: string): Promise<AgentUpdateResult> {
  if (!isDriverName(agent)) return Promise.resolve({ ok: false, error: 'unknown coding agent' })
  return contextAgentUpdates().update(agent)
}
