import { projectId } from '@openagt/agent-data'
import { SCHEDULED_COMMANDS, type SchedulePace } from '@openagt/hooks'
import { read } from '@openagt/hooks/rpc'
import { QUEUE_COMMAND } from './module.js'

/** Whether the command that works the queue starts by itself on this computer, and how often where a person set it. */
export interface Taker {
  on: boolean
  pace?: SchedulePace
}

/**
 * Who takes from the project's queue by itself (#2394, decision 9): the scheduler's switch and pace
 * for the command that works it, on this computer, read from the settings. The queue names the
 * setting, never the module that saves it.
 */
export const taker = read(async (host): Promise<Taker> => {
  const picks = (await host.settings.get(SCHEDULED_COMMANDS))[projectId(host.root)]?.[QUEUE_COMMAND]
  return { on: picks?.on !== undefined, ...(picks?.pace ? { pace: picks.pace } : {}) }
})
