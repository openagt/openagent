import { commandReader } from '@openagt/store-filesystem'
import { nodeGitRunner } from '@openagt/git-branches'
import { projectId } from '@openagt/projects'
import { SCHEDULED_COMMANDS, type SchedulePace } from '@openagt/hooks'
import { read } from '@openagt/hooks/rpc'
import { QUEUE_COMMAND } from './module.js'
import { QUEUE_FILE } from './names.js'
import { parseQueueSections, type PlacedEntry } from './queue.js'

// The queue's server part (`@openagt/hooks/rpc`): what its page, its card, its line on the Overview
// and its "Add to queue" read. They change the queue through its command, as an agent does.

/**
 * The project's open queue entries, in file order, each with the priority of the section it sits
 * in. This machine's copy, with no fetch, cheap enough to poll: what the page, the AI Queue card
 * and the Overview's line show. With `fresh`, origin's copy, fetched first, as the command reads
 * it: what "Add to queue" reads before it adds a link someone may have queued on another machine.
 */
export const entries = read(async (host, input: { fresh?: boolean }): Promise<PlacedEntry[]> => {
  const reader = await commandReader(host.root, input.fresh !== true, nodeGitRunner())
  return parseQueueSections((await reader.read(QUEUE_FILE)) ?? '')
})

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
