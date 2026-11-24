import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildOverview, buildRecentAgents } from './overview.js'
import type { ProjectSummary } from './projects.js'
import type { AgentMeta } from '../store/index.js'

const project = (id: string, path: string, lastActivityAt?: string): ProjectSummary => ({
  id,
  path,
  name: id,
  activated: true,
  gitHost: false,
  ...(lastActivityAt ? { lastActivityAt } : {}),
})

const meta = (status: AgentMeta['status'], intent: string, updatedAt: string): AgentMeta =>
  ({ version: 1, status, id: 'r', startedAt: updatedAt, updatedAt, intent }) as AgentMeta

test('buildOverview surfaces only running runs, most-recently-updated first', async () => {
  const metas: Record<string, AgentMeta> = {
    '/a': meta('running', 'build the API', '2026-07-13T10:00:00Z'),
    '/b': meta('done', 'finished thing', '2026-07-13T11:00:00Z'),
    '/c': meta('running', 'build the UI', '2026-07-13T12:00:00Z'),
  }
  const overview = await buildOverview([project('a', '/a'), project('b', '/b'), project('c', '/c')], {
    agents: async project => (metas[project.path] ? [{ ...metas[project.path]!, id: project.id }] : []),
  })
  assert.deepEqual(
    overview.active.map(r => ({ id: r.projectId, intent: r.intent })),
    [
      { id: 'c', intent: 'build the UI' }, // newer updatedAt first
      { id: 'a', intent: 'build the API' },
    ],
  )
})

test('buildOverview lists recent projects newest-first (capped at 5)', async () => {
  const projects = Array.from({ length: 7 }, (_, i) =>
    project(`p${i}`, `/p${i}`, `2026-07-${String(10 + i).padStart(2, '0')}T00:00:00Z`),
  )
  const overview = await buildOverview(projects, { agents: async () => [] })
  assert.equal(overview.active.length, 0)
  assert.equal(overview.recent.length, 5)
  assert.deepEqual(
    overview.recent.map(r => r.projectId),
    ['p6', 'p5', 'p4', 'p3', 'p2'], // newest-first, top 5
  )
})

test('buildOverview omits projects with no activity from recent', async () => {
  const overview = await buildOverview([project('a', '/a'), project('b', '/b', '2026-07-13T00:00:00Z')], {
    agents: async () => [],
  })
  assert.deepEqual(overview.recent.map(r => r.projectId), ['b'])
})

const agent = (id: string, startedAt: string): AgentMeta =>
  ({ version: 1, status: 'done', id, startedAt, updatedAt: startedAt }) as AgentMeta

test('buildRecentAgents pools every project newest-first and tags each with its project', async () => {
  const agents: Record<string, AgentMeta[]> = {
    '/a': [agent('a2', '2026-07-13T12:00:00Z'), agent('a1', '2026-07-13T09:00:00Z')],
    '/b': [agent('b1', '2026-07-13T11:00:00Z')],
  }
  const recent = await buildRecentAgents([project('alpha', '/a'), project('beta', '/b')], {
    agents: async ({ path }) => agents[path] ?? [],
  })
  assert.deepEqual(
    recent.map(r => ({ project: r.projectName, id: r.agent.id })),
    [
      { project: 'alpha', id: 'a2' },
      { project: 'beta', id: 'b1' },
      { project: 'alpha', id: 'a1' },
    ],
  )
})

test('buildRecentAgents pools the sessions with no project among the projects\' runs, tagged with the sessions\' id and no name', async () => {
  const recent = await buildRecentAgents([project('alpha', '/a')], {
    agents: async () => [agent('a1', '2026-07-13T09:00:00Z')],
    sessions: async () => [agent('s1', '2026-07-13T10:00:00Z')],
  })
  assert.deepEqual(
    recent.map(r => ({ projectId: r.projectId, project: r.projectName, id: r.agent.id })),
    [
      { projectId: 'session', project: '', id: 's1' },
      { projectId: project('alpha', '/a').id, project: 'alpha', id: 'a1' },
    ],
  )
})

test('buildRecentAgents keeps the newest thirty for the sidebar, and every run when asked for all of them', async () => {
  const runs = Array.from({ length: 1000 }, (_, at) => agent(`r${at}`, new Date(Date.UTC(2026, 0, 1, 0, at)).toISOString()))
  const read = { agents: async () => runs }
  const recent = await buildRecentAgents([project('alpha', '/a')], read)
  assert.equal(recent.length, 30)
  assert.equal(recent[0]!.agent.id, 'r999')
  const all = await buildRecentAgents([project('alpha', '/a')], read, Infinity)
  assert.equal(all.length, 1000)
})

test('buildRecentAgents tolerates a project whose runs cannot be read', async () => {
  const recent = await buildRecentAgents([project('ok', '/ok'), project('bad', '/bad')], {
    agents: async ({ path }) => {
      if (path === '/bad') throw new Error('unreadable')
      return [agent('x', '2026-07-13T10:00:00Z')]
    },
  })
  assert.deepEqual(recent.map(r => r.agent.id), ['x'])
})

test('buildOverview lists a run at work on a host beside this computer\'s, and says which (#1668, #2394)', async () => {
  const run = (id: string, over: Partial<AgentMeta>): AgentMeta =>
    ({ version: 1, status: 'running', id, startedAt: '2026-11-19T10:00:00Z', updatedAt: '2026-11-19T10:00:00Z', intent: id, ...over }) as AgentMeta
  // Two projects sharing one archive (a clone of the repository) list each run once.
  const overview = await buildOverview([project('a', '/a'), project('b', '/b')], {
    agents: async () => [run('on-the-web', { target: 'web' }), run('on-actions', { target: 'actions' }), run('ended', { target: 'web', status: 'done' }), run('here', {})],
  })
  assert.deepEqual(
    overview.active.map(r => ({ id: r.agentId, host: r.host, project: r.projectId })),
    [
      { id: 'on-the-web', host: 'web', project: 'a' },
      { id: 'on-actions', host: 'actions', project: 'a' },
      { id: 'here', host: undefined, project: 'a' },
    ],
  )
})

test('buildRecentAgents lists a run once when two checkouts share its archive (#1648)', async () => {
  const shared = [agent('r2', '2026-07-13T12:00:00Z'), agent('r1', '2026-07-13T09:00:00Z')]
  const recent = await buildRecentAgents([project('alpha', '/a'), project('alpha-clone', '/a2')], {
    agents: async () => shared,
  })
  assert.deepEqual(
    recent.map(r => ({ project: r.projectName, id: r.agent.id })),
    [
      { project: 'alpha', id: 'r2' },
      { project: 'alpha', id: 'r1' },
    ],
  )
})

test('buildOverview lists the runs at work on this computer, and none another computer runs on its own (#1648)', async () => {
  const at = '2026-07-13T12:00:00Z'
  const run = (id: string, over: Partial<AgentMeta> = {}): AgentMeta => ({ status: 'running', id, startedAt: at, updatedAt: at, intent: id, ...over }) as AgentMeta
  const overview = await buildOverview([project('a', '/a')], {
    agents: async () => [run('mine', { host: 'this-mac' }), run('theirs', { host: 'rom-thinkpad-x280' }), run('unknown'), run('their-cloud', { host: 'rom-thinkpad-x280', target: 'web' })],
    host: 'this-mac',
  })
  assert.deepEqual(
    overview.active.map(r => ({ id: r.agentId, computer: r.computer })),
    [
      { id: 'mine', computer: undefined },
      { id: 'unknown', computer: undefined },
      { id: 'their-cloud', computer: { name: 'rom-thinkpad-x280' } },
    ],
  )
})

test('buildRecentAgents reads the projects at once, not one after the other', async () => {
  let started = 0
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  const agents = async () => {
    started++
    if (started === 2) release()
    await gate
    return []
  }
  const read = buildRecentAgents([project('alpha', '/a'), project('beta', '/b')], { agents })
  await Promise.race([read, new Promise((_, reject) => setTimeout(() => reject(new Error('the second project waited for the first')), 1000))])
  assert.equal(started, 2)
})
