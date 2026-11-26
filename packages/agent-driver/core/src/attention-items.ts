import type { AgentState } from './setup.js'

// The ids of the coding agents' items (`app.attention`) and what a state says, with no Node in
// them: the server's items and the dashboard's fixes read the same ids.

/** The item about this computer: no coding agent can run yet. */
export const CONNECT_ITEM = 'connect'

/** The item about the run to start, for the agent `id`: its id names the agent the fix acts on. */
export function agentItem(id: string): string {
  return `agent:${id}`
}

/** The agent an item about the run to start is for, by {@link agentItem}'s id. */
export function agentOfItem(item: string | undefined): string | undefined {
  return item?.startsWith('agent:') ? item.slice('agent:'.length) : undefined
}

/** Whether the agent's program is missing here. */
export function notInstalled(state: AgentState): boolean {
  return !state.ready && (state.fix?.kind === 'install' || / not found/.test(state.problem ?? ''))
}

/** Whether what is in the way of the agent is its own login. */
export function loggedOut(state: AgentState): boolean {
  return / logged in/.test(state.problem ?? '')
}

/** The note about this computer that the agent `id` has a newer version out: its id names the agent the update acts on. */
export function updateItem(id: string): string {
  return `update:${id}`
}

/** The agent a note about a newer version is for, by {@link updateItem}'s id. */
export function agentOfUpdate(item: string | undefined): string | undefined {
  return item?.startsWith('update:') ? item.slice('update:'.length) : undefined
}
