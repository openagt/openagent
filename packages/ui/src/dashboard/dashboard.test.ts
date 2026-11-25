import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildDashboard } from './dashboard.js'
import type { ProjectSummary } from './projects.js'
import type { AgentMeta } from '../store/index.js'

const project = (id: string, path: string, lastActivityAt?: string): ProjectSummary => ({
  id,
  path,
  name: id,
  ...(lastActivityAt ? { lastActivityAt } : {}),
})

const agent = (status: AgentMeta['status'], startedAt: string): AgentMeta =>
  ({ version: 1, status, id: startedAt, startedAt, updatedAt: startedAt }) as AgentMeta

test('buildDashboard rolls up the totals and the working-now list its readers ask for', async () => {
  const projects = [project('a', '/a', '2026-07-13T00:00:00Z'), project('b', '/b', '2026-07-10T00:00:00Z')]
  const data = await buildDashboard(projects, {
    agents: async project => (project.path === '/a' ? [agent('running', '2026-07-14T11:00:00Z')] : []),
  })

  assert.deepEqual(data.totals, { projects: 2 })
  assert.equal(data.active.length, 1)
})

test('the payload carries only what a reader asks for', async () => {
  // The guard on #1139's leftovers. Every field that needed `listAgents` — the status rollup, the
  // two-week activity window, the per-project agent count — outlived the surfaces that drew them by
  // a release, and kept costing a fan-out over every project's whole archive on each poll. Pinning
  // the shape is what makes a field added back here a decision rather than an accident.
  const data = await buildDashboard([project('a', '/a')], { agents: async () => [] })

  assert.deepEqual(Object.keys(data).sort(), ['active', 'totals'])
  assert.deepEqual(Object.keys(data.totals).sort(), ['projects'])
})
