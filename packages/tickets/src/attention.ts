import { commandReader, nodeGitRunner } from '@openagt/agent-data'
import type { AppContext, AttentionArgs, AttentionItem, ProjectRef } from '@openagt/hooks'
import { POPULATE_ACTION, populateId } from './module.js'
import { TICKETS_DIR } from './names.js'
import { readTickets } from './tickets.js'

/** Whether a project has any open ticket, in this machine's copy, with no fetch; a project that cannot be read has none. */
export type HasTickets = (project: ProjectRef) => Promise<boolean>

const hasTicketsHere: HasTickets = async project =>
  (await readTickets(TICKETS_DIR, await commandReader(project.dir, true, nodeGitRunner())).catch(() => [])).length > 0

/**
 * "Populate the tickets" (#958, #2394), a first step of this computer's: while no project the
 * tickets are on in has one, the first of them is offered "Update tickets", which starts a run on
 * the project's `update-tickets` command. Asked about a project, nothing: the step is the computer's.
 */
export function ticketsAttention(hasTickets: HasTickets = hasTicketsHere): (args: AttentionArgs, app: AppContext) => Promise<AttentionItem[]> {
  return async ({ project }, app) => {
    if (project) return []
    const projects = await app.projects()
    const first = projects[0]
    if (!first) return []
    for (const each of projects) if (await hasTickets(each)) return []
    return [
      {
        kind: 'setup',
        scope: 'computer',
        id: populateId(first.id),
        words: 'Populate the tickets',
        title: first.name,
        detail: 'tickets/ holds the bigger things to work on, in the repo. The agent researches and plans them, and they are the input the queue is filled from.',
        fix: { label: 'Update tickets', action: POPULATE_ACTION },
      },
    ]
  }
}
