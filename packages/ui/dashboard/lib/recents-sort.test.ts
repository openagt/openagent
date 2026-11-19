import { describe, expect, test } from 'vitest'
import type { AgentMeta } from '../../src/index.js'
import { sortRuns } from './recents-sort.js'

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
