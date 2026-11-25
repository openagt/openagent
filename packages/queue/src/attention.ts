import { commandReader } from '@openagt/store-filesystem'
import { nodeGitRunner } from '@openagt/git-branches'
import type { AppContext, AttentionArgs, AttentionItem, ProjectRef } from '@openagt/hooks'
import { QUEUE_FILE } from './names.js'
import { parseQueueSections } from './queue.js'

/** Whether a project's queue has an open entry, in this machine's copy, with no fetch; a project that cannot be read has none. */
export type HasEntries = (project: ProjectRef) => Promise<boolean>

const hasEntriesHere: HasEntries = async project => {
  const reader = await commandReader(project.dir, true, nodeGitRunner()).catch(() => undefined)
  return parseQueueSections((await reader?.read(QUEUE_FILE).catch(() => undefined)) ?? '').length > 0
}

/**
 * "Populate the queue of AI tasks" (#958, #2394), a first step of this computer's: while no project
 * the queue is on in has an entry, its Queue page is where one is added. Asked about a project,
 * nothing: the step is the computer's.
 */
export function queueAttention(hasEntries: HasEntries = hasEntriesHere): (args: AttentionArgs, app: AppContext) => Promise<AttentionItem[]> {
  return async ({ project }, app) => {
    if (project) return []
    const projects = await app.projects()
    if (projects.length === 0) return []
    for (const each of projects) if (await hasEntries(each)) return []
    return [
      {
        kind: 'setup',
        scope: 'computer',
        id: 'populate',
        words: 'Populate the queue of AI tasks',
        detail: 'The agent queue: each entry is work the agent picks up on its own, so a filled queue is what lets it keep going without you.',
        fix: { label: 'Open the Queue', href: '/queue' },
      },
    ]
  }
}
