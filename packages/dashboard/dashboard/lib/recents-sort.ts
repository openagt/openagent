import type { AgentMeta, Preferences } from '../../src/index.js'
import { agentLabel } from './agent-label.js'

/** An order the sidebar's list of runs offers. */
export type RecentsSort = NonNullable<Preferences['recentsSort']>

/** The orders, as the sidebar's menu lists them: the default first. */
export const RECENTS_SORT_LABELS: Readonly<Record<RecentsSort, string>> = {
  created: 'Date created',
  updated: 'Last updated',
  name: 'Name',
}

/**
 * The sidebar's runs in the order the person picked. By creation, the default, a run keeps its
 * place while it works, while it waits on its question and when it is answered: the list a person
 * scans does not move under them. The server lists the runs that hold a checkout first, which moved
 * a run answered days later to the top and back down once its checkout went; neither order reads
 * that. By the last update, as Claude Code lists its sessions by default, the run that did something
 * last is first. By name, as the rows say it.
 */
export function sortRuns<R extends { agent: AgentMeta }>(rows: readonly R[], order: RecentsSort): R[] {
  const newestFirst = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0)
  const byCreated = (a: R, b: R) => newestFirst(a.agent.startedAt, b.agent.startedAt) || newestFirst(a.agent.id, b.agent.id)
  if (order === 'updated') return [...rows].sort((a, b) => newestFirst(a.agent.updatedAt, b.agent.updatedAt) || byCreated(a, b))
  if (order === 'name') return [...rows].sort((a, b) => agentLabel(a.agent).localeCompare(agentLabel(b.agent), undefined, { sensitivity: 'base', numeric: true }) || byCreated(a, b))
  return [...rows].sort(byCreated)
}
