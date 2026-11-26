import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { projectsUnder, withProjectsUnder } from './projects-under.js'
import { moduleAgentOf } from './module-agents.js'

// The projects a session with no project is listed under: each one it has a copy of.

const projects = [
  { id: 'shop-1', name: 'shop', path: '/w/shop' },
  { id: 'blog-1', name: 'blog', path: '/w/blog' },
]

test("a session is under each project it has a copy of, found by the folder the copy was made from; a repo that is no project of the person's counts for none", () => {
  assert.deepEqual(projectsUnder({ options: { 'git-branches': { repos: [{ name: 'shop', from: '/w/shop/' }, { name: 'vike', from: '/oss/vike' }] } } }, projects), [{ id: 'shop-1', name: 'shop' }])
  assert.deepEqual(projectsUnder(undefined, projects), [])
  const [listed, alone] = withProjectsUnder(
    [
      { id: 's1', status: 'done', startedAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:00.000Z', options: { 'git-branches': { repos: [{ name: 'blog', from: '/w/blog' }] } } },
      { id: 's2', status: 'done', startedAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:00.000Z' },
    ],
    projects,
  )
  assert.deepEqual(listed?.under, [{ id: 'blog-1', name: 'blog' }])
  assert.equal(alone?.under, undefined)
  // A module that lists it under the project opens it as the sessions'.
  assert.equal(moduleAgentOf(listed!).in, 'session')
  assert.equal(moduleAgentOf(alone!).in, undefined)
})
