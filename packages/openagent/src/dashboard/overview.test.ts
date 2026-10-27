import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildOverview, buildRecentAgents } from './overview.js'
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

const meta = (status: AgentMeta['status'], intent: string, updatedAt: string): AgentMeta =>
  ({ version: 1, status, id: 'r', startedAt: updatedAt, updatedAt, intent }) as AgentMeta

test('buildOverview surfaces only running runs, most-recently-updated first', async () => {
  const metas: Record<string, AgentMeta> = {
    '/a': meta('running', 'build the API', '2026-07-13T10:00:00Z'),
    '/b': meta('done', 'finished thing', '2026-07-13T11:00:00Z'),
    '/c': meta('running', 'build the UI', '2026-07-13T12:00:00Z'),
  }
  const overview = await buildOverview([project('a', '/a'), project('b', '/b'), project('c', '/c')], {
    liveAgents: async cwd => (metas[cwd] ? [{ ...metas[cwd]!, cwd }] : []),
    queue: async () => [],
  })
  assert.deepEqual(
    overview.active.map(r => ({ id: r.projectId, intent: r.intent })),
    [
      { id: 'c', intent: 'build the UI' }, // newer updatedAt first
      { id: 'a', intent: 'build the API' },
    ],
  )
})

test('buildOverview sums the open queue and lists recent projects newest-first (capped at 5)', async () => {
  const projects = Array.from({ length: 7 }, (_, i) =>
    project(`p${i}`, `/p${i}`, `2026-07-${String(10 + i).padStart(2, '0')}T00:00:00Z`),
  )
  const queues: ProjectQueue[] = [
    { projectId: 'p0', projectName: 'p0', entries: ['a', 'b', 'c'] },
    { projectId: 'p1', projectName: 'p1', entries: ['d', 'e'] },
  ]
  const overview = await buildOverview(projects, { liveAgents: async () => [], queue: async () => queues })
  assert.equal(overview.active.length, 0)
  assert.equal(overview.queueOpen, 5)
  assert.equal(overview.recent.length, 5)
  assert.deepEqual(
    overview.recent.map(r => r.projectId),
    ['p6', 'p5', 'p4', 'p3', 'p2'], // newest-first, top 5
  )
})

test('buildOverview omits projects with no activity from recent', async () => {
  const overview = await buildOverview([project('a', '/a'), project('b', '/b', '2026-07-13T00:00:00Z')], {
    liveAgents: async () => [],
    queue: async () => [],
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

test('buildRecentAgents tolerates a project whose runs cannot be read', async () => {
  const recent = await buildRecentAgents([project('ok', '/ok'), project('bad', '/bad')], {
    agents: async ({ path }) => {
      if (path === '/bad') throw new Error('unreadable')
      return [agent('x', '2026-07-13T10:00:00Z')]
    },
  })
  assert.deepEqual(recent.map(r => r.agent.id), ['x'])
})

test('buildOverview lists a web run whose cloud side is still at work, and says where it is (#1668)', async () => {
  const now = Date.parse('2026-08-23T20:00:00Z')
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 60 * 60 * 1000).toISOString()
  const web = (id: string, over: Partial<AgentMeta>): AgentMeta =>
    ({ version: 1, status: 'done', id, startedAt: at(1), updatedAt: at(1), target: 'web', intent: id, ...over }) as AgentMeta
  // Two projects sharing one archive (a clone of the repository) list each run once.
  const overview = await buildOverview([project('a', '/a'), project('b', '/b')], {
    liveAgents: async () => [],
    agents: async () => [
      web('working', { sessionId: 'session_01Work' }),
      web('parked', { sessionId: 'session_01Park' }),
      web('opened', { sessionId: 'session_01Pr', pr: { number: 3, url: 'u' } }),
      web('stale', { startedAt: at(13), updatedAt: at(13) }),
      web('stopped', { status: 'stopped' }),
    ],
    waiting: sessionId => sessionId === 'session_01Park',
    now: () => now,
    queue: async () => [],
  })
  assert.deepEqual(
    overview.active.map(r => ({ id: r.agentId, cloud: r.cloud, cwd: r.cwd })),
    [
      { id: 'working', cloud: 'in-cloud', cwd: '/a' },
      { id: 'parked', cloud: 'waiting', cwd: '/a' },
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

test('buildOverview names the machine that started a run when it is not this one (#1648)', async () => {
  const at = '2026-07-13T12:00:00Z'
  const run = (id: string, host?: string): AgentMeta =>
    ({ version: 1, status: 'running', id, startedAt: at, updatedAt: at, intent: id, cwd: `/wt/${id}`, ...(host ? { host } : {}) }) as AgentMeta
  const overview = await buildOverview([project('a', '/a')], {
    liveAgents: async () => [run('mine', 'this-mac'), run('theirs', 'rom-thinkpad-x280'), run('unknown')] as never,
    agents: async () => [],
    queue: async () => [],
    host: 'this-mac',
  })
  assert.deepEqual(
    overview.active.map(r => ({ id: r.agentId, computer: r.computer })),
    [
      { id: 'mine', computer: undefined },
      { id: 'theirs', computer: 'rom-thinkpad-x280' },
      { id: 'unknown', computer: undefined },
    ],
  )
})

test('buildOverview lists the runs the other computers say are running, by the machine they are on', async () => {
  const at = (minute: number) => `2026-07-13T12:${String(minute).padStart(2, '0')}:00Z`
  const run = (id: string, status: AgentMeta['status'], minute: number, over: Partial<AgentMeta> = {}): AgentMeta =>
    ({ version: 1, status, id, startedAt: at(minute), updatedAt: at(minute), intent: id, ...over }) as AgentMeta
  const theirs = { ...project('them~m1', '/home/them'), machine: 'http://laptop' }
  const overview = await buildOverview([project('a', '/a'), theirs], {
    liveAgents: async cwd => (cwd === '/a' ? [{ ...run('here', 'running', 1), cwd: '/wt/here' }] : []),
    agents: async () => [],
    queue: async () => [],
    machineRuns: async ({ id }) =>
      id === 'a'
        ? [run('sent', 'running', 2, { remoteLabel: 'Droplet' }), run('asked', 'waiting', 3, { remoteLabel: 'Droplet' }), run('here', 'running', 1, { remoteLabel: 'Droplet' })]
        : [run('there', 'running', 4, { remoteLabel: 'MacBook' }), run('gone', 'unknown', 5, { remoteLabel: 'MacBook' })],
  })
  assert.deepEqual(
    overview.active.map(r => ({ project: r.projectId, id: r.agentId, computer: r.computer })),
    [
      { project: 'them~m1', id: 'there', computer: 'MacBook' },
      { project: 'a', id: 'sent', computer: 'Droplet' },
      { project: 'a', id: 'here', computer: undefined },
    ],
  )
})

test('buildOverview reads no folder of a project only another computer has', async () => {
  const read: string[] = []
  const theirs = { ...project('them~m1', '/home/them'), machine: 'http://laptop' }
  const queued: string[][] = []
  await buildOverview([project('a', '/a'), theirs], {
    liveAgents: async cwd => (read.push(cwd), []),
    agents: async cwd => (read.push(cwd), []),
    queue: async projects => (queued.push(projects.map(p => p.id)), []),
  })
  assert.deepEqual(read, ['/a', '/a'])
  assert.deepEqual(queued, [['a']])
})

test('buildRecentAgents asks for the runs by the project, so another computer\'s project is read as its computer says it', async () => {
  const theirs = { ...project('them~m1', '/home/them'), machine: 'http://laptop' }
  const recent = await buildRecentAgents([project('a', '/a'), theirs], {
    agents: async ({ machine }) => (machine ? [agent('there', '2026-07-13T11:00:00Z')] : [agent('here', '2026-07-13T10:00:00Z')]),
  })
  assert.deepEqual(
    recent.map(r => [r.projectId, r.agent.id]),
    [
      ['them~m1', 'there'],
      ['a', 'here'],
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
