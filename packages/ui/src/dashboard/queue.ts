import type { ProjectSummary } from './projects.js'
import { projectQueue, type QueueFor } from '../store/queue.js'

// The cross-project agent queue (#438, part of #314; #1774): every registered project's open
// entries in one place, for the Overview's queue total, the onboarding step and the
// tickets page's dedupe. Each project's queue is read through the command one of its packages
// declares (`src/store/queue.ts`); OpenAgent knows no queue file and no queue package.

/** One project's queue, as the dashboard reads it. */
export interface ProjectQueue {
  projectId: string
  projectName: string
  /** The open entries, in order of work: each the task a future agent is started with. */
  entries: string[]
}

/**
 * The queue of every project that has one, most entries first: a project one of whose packages
 * provides the queue is listed even with nothing queued (the card shows the projects it can speak
 * for), and a project with no provider is left out (it has no queue, so nothing is said about it).
 * `queueFor` is injectable so this is unit-testable off disk and processes.
 */
export async function collectQueue(projects: ProjectSummary[], queueFor: QueueFor = projectQueue): Promise<ProjectQueue[]> {
  const queues: ProjectQueue[] = []
  for (const project of projects) {
    const source = await queueFor(project.path).catch(() => undefined)
    if (!source) continue
    const entries = await source.list().catch((): string[] => [])
    queues.push({ projectId: project.id, projectName: project.name, entries })
  }
  return queues.sort((a, b) => b.entries.length - a.entries.length)
}
