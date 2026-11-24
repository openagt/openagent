import { describe, expect, test } from 'vitest'
import type { AgentMeta } from '../../src/index.js'
import { groupRuns, sortRuns } from './recents-sort.js'

const row = (id: string, startedAt: string, updatedAt: string, title: string) => ({ agent: { id, status: 'done', startedAt, updatedAt, title } as AgentMeta })

// An old run answered just now (still holding its checkout), a newer one, the newest.
const ROWS = [
  row('old', '2026-10-18T10:00:00Z', '2026-10-20T09:00:00Z', 'Interactive question'),
  row('mid', '2026-10-19T10:00:00Z', '2026-10-19T10:05:00Z', 'add readme sentence'),
  row('new', '2026-10-20T08:00:00Z', '2026-10-20T08:01:00Z', 'Create test.md file'),
]

describe('the sidebar\'s order', () => {
  test('by creation, newest first, whatever order the server listed them in: an answered run keeps its place', () => {
    expect(sortRuns(ROWS, 'created').map(r => r.agent.id)).toEqual(['new', 'mid', 'old'])
  })

  test('by the last update, the run that did something last first', () => {
    expect(sortRuns(ROWS, 'updated').map(r => r.agent.id)).toEqual(['old', 'new', 'mid'])
  })

  test('by name, as the rows say it, whatever its case', () => {
    expect(sortRuns(ROWS, 'name').map(r => r.agent.id)).toEqual(['mid', 'new', 'old'])
  })
})

describe('what the sidebar\'s list is cut by', () => {
  const now = new Date('2026-10-20T12:00:00')
  const of = (project: string | undefined, id: string, startedAt: string, updatedAt = startedAt) => ({ ...row(id, startedAt, updatedAt, id), ...(project ? { project } : {}) })
  const rows = [of('shop', 'a', '2026-10-20T08:00:00'), of(undefined, 'b', '2026-10-20T07:00:00'), of('shop', 'c', '2026-10-19T08:00:00', '2026-10-20T11:00:00')]
  const cut = (groups: { label?: string; rows: { agent: AgentMeta }[] }[]) => groups.map(group => [group.label, group.rows.map(r => r.agent.id)])

  test('by nothing it is one list, with no line', () => {
    expect(cut(groupRuns(rows, 'none', 'created', now))).toEqual([[undefined, ['a', 'b', 'c']]])
  })

  test('by project, a project\'s runs stand together where its newest stands, those with none under "No project"', () => {
    expect(cut(groupRuns(rows, 'project', 'created', now))).toEqual([['shop', ['a', 'c']], ['No project', ['b']]])
  })

  test('by day, the day of the date the list is ordered by: when a run started, or when it last did something', () => {
    expect(cut(groupRuns(rows, 'day', 'created', now))).toEqual([['Today', ['a', 'b']], ['Yesterday', ['c']]])
    expect(cut(groupRuns(sortRuns(rows, 'updated'), 'day', 'updated', now))).toEqual([['Today', ['c', 'a', 'b']]])
  })

  test('a list ordered by name has no days to cut it by', () => {
    expect(cut(groupRuns(rows, 'day', 'name', now))).toEqual([[undefined, ['a', 'b', 'c']]])
  })
})
