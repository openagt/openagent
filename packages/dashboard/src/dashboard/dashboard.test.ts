import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildDashboard } from './dashboard.js'
import type { ProjectSummary } from './projects.js'
import type { ProjectQueue } from './queue.js'
import type { AgentMeta } from '../store/index.js'

const project = (id: string, path: string, lastActivityAt?: string): ProjectSummary => ({
  id,
  path,
  name: id,
  activated: true,
  gitHost: false,
  ...(lastActivityAt ? { lastActivityAt } : {}),
})

const agent = (status: AgentMeta['status'], startedAt: string): AgentMeta =>
  ({ version: 1, status, id: startedAt, startedAt, updatedAt: startedAt }) as AgentMeta

test('buildDashboard rolls up the totals and the working-now list its readers ask for', async () => {
  const projects = [project('a', '/a', '2026-07-13T00:00:00Z'), project('b', '/b', '2026-07-10T00:00:00Z')]
  const queues: ProjectQueue[] = [
    { projectId: 'a', projectName: 'a', entries: ['one', 'two'] },
    { projectId: 'b', projectName: 'b', entries: [] },
  ]
  const data = await buildDashboard(projects, {
    liveAgents: async cwd => (cwd === '/a' ? [{ ...agent('running', '2026-07-14T11:00:00Z'), cwd }] : []),
    queue: async () => queues,
  })

  assert.deepEqual(data.totals, { projects: 2, openTodos: 2 })
  assert.equal(data.active.length, 1)
  assert.deepEqual(data.queue, queues)
  assert.equal(data.projects.length, 2)
})

test('buildDashboard orders projects most-recently-active first, which onboarding takes the head of', async () => {
  // The checklist acts on `projects[0]`, so the order *is* an output here even though the
  // timestamp it sorts on is not one of the fields.
  const data = await buildDashboard([project('old', '/old', '2026-07-01T00:00:00Z'), project('new', '/new', '2026-07-13T00:00:00Z')], {
    liveAgents: async () => [],
    queue: async () => [],
  })

  assert.deepEqual(data.projects.map(p => p.projectId), ['new', 'old'])
})

test('buildDashboard reports per-project ticket presence, which onboarding reads (#958)', async () => {
  const data = await buildDashboard([project('a', '/a'), project('b', '/b')], {
    liveAgents: async () => [],
    queue: async () => [],
    tickets: async cwd => cwd === '/a',
    providesTickets: async cwd => cwd !== '/b',
  })

  assert.equal(data.projects.find(p => p.projectId === 'a')!.hasTickets, true)
  assert.equal(data.projects.find(p => p.projectId === 'b')!.hasTickets, false)
  // Whether a project can have tickets at all (#1774): a step to populate them is offered only where a package provides them.
  assert.equal(data.projects.find(p => p.projectId === 'a')!.providesTickets, true)
  assert.equal(data.projects.find(p => p.projectId === 'b')!.providesTickets, false)
})

test('the payload carries only what a reader asks for', async () => {
  // The guard on #1139's leftovers. Every field that needed `listAgents` — the status rollup, the
  // two-week activity window, the per-project agent count — outlived the surfaces that drew them by
  // a release, and kept costing a fan-out over every project's whole archive on each poll. Pinning
  // the shape is what makes a field added back here a decision rather than an accident.
  const data = await buildDashboard([project('a', '/a')], { liveAgents: async () => [], queue: async () => [] })

  assert.deepEqual(Object.keys(data).sort(), ['active', 'projects', 'queue', 'totals'])
  assert.deepEqual(Object.keys(data.totals).sort(), ['openTodos', 'projects'])
  assert.deepEqual(Object.keys(data.projects[0]!).sort(), ['hasTickets', 'projectId', 'providesTickets'])
})
