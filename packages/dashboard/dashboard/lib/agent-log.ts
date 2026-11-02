import { onAgent } from '../rpc/reads.js'
import { readAhead } from './use-async.js'

// An ended agent's saved log, as the agent's page remembers it between visits.

/** The key the log is remembered under. */
export function agentLogKey(projectId: string, agentId: string): string {
  return `agent-log:${projectId}:${agentId}`
}

/**
 * Read an ended agent's log as the pointer reaches its row, before the click: the page then opens
 * with the chat drawn, where it was blank for the frames the read took.
 */
export function readAgentLogAhead(projectId: string, agentId: string): void {
  readAhead(agentLogKey(projectId, agentId), () => onAgent(projectId, agentId))
}
