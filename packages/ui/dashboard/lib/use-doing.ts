import type { ActiveAgent, AgentDoing } from '../../src/index.js'
import { onAgentsDoing } from '../rpc/reads.js'
import { usePolled } from './use-async.js'

/** How often what runs at work are doing is read, on the Overview and for a run's subagents: their last step, as a chat's live line moves. */
export const DOING_EVERY_MS = 2_000

/** What no run is doing: one object, so a read that finds nothing changes nothing. */
export const NOTHING_DOING: Record<string, AgentDoing> = {}

/**
 * What each of these runs is doing now, by project and run (`${projectId}/${agentId}`): the last step
 * its diary says it took, or said. Only a run of this computer's whose diary has a step has an entry.
 */
export function useRunsDoing(runs: readonly ActiveAgent[]): Record<string, AgentDoing> {
  const byProject = new Map<string, string[]>()
  for (const run of runs) byProject.set(run.projectId, [...(byProject.get(run.projectId) ?? []), run.agentId])
  const key = [...byProject].map(([project, ids]) => `${project}:${ids.join(',')}`).join(';')
  const { value } = usePolled<Record<string, AgentDoing>>(
    key === ''
      ? null
      : async () => {
          const answers = await Promise.all([...byProject].map(async ([project, ids]) => [project, await onAgentsDoing(project, ids)] as const))
          return Object.fromEntries(answers.flatMap(([project, doing]) => Object.entries(doing).map(([id, step]) => [`${project}/${id}`, step])))
        },
    NOTHING_DOING,
    DOING_EVERY_MS,
    [key],
    'previous',
  )
  return value
}
