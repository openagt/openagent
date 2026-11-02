import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { OwnProjectsAsked, PROJECTS_KEPT_MS, elsewhereHomes, elsewhereId, elsewhereSummary, homeOf, idInLineName, isElsewhereId, lineNameOf, ownProjectsOf, type OwnMachine, type OwnProject } from './elsewhere.js'
import { projectId } from '../registry.js'

const shop: OwnProject = { id: 'shop-1abc', name: 'shop', path: '/Users/me/shop', address: 'github.com/me/shop', spelling: 'github.com/Me/shop', share: true, gitHost: true, activated: true }
const notes: OwnProject = { id: 'notes-2def', name: 'notes', path: '/Users/me/notes', share: false, gitHost: false, activated: true }

test('what a computer says of its projects is taken only where it reads as projects', () => {
  assert.deepEqual(ownProjectsOf('nope'), [])
  assert.deepEqual(
    ownProjectsOf([
      shop,
      { ...notes, lastActivityAt: 'not a time', extra: 'dropped' },
      // An id that is not of the URL-safe kind a computer makes, which goes in an id here too.
      { ...shop, id: 'shop/../x' },
      { ...shop, id: 'x~y' },
      { ...shop, name: '' },
      { ...shop, path: 7 },
      null,
    ]),
    [shop, notes],
  )
})

test('what a computer says of a project\'s pages is taken as package names, a few dozen at most', () => {
  const said = ownProjectsOf([{ ...shop, modules: ['@openagt/skill-queue', 7, '', 'x'.repeat(600), ...Array.from({ length: 60 }, (_, i) => `p${i}`)] }])
  assert.deepEqual(said[0]!.modules!.slice(0, 2), ['@openagt/skill-queue', 'p0'])
  assert.equal(said[0]!.modules!.length, 47)
  assert.equal(ownProjectsOf([{ ...shop, modules: 'all' }])[0]!.modules, undefined)
})

test("another computer's project has an id here no project of this computer's has, and it reads back to that computer and project", () => {
  const machines: OwnMachine[] = [
    { id: 'http://127.0.0.1:4210', projects: [shop] },
    { id: 'http://127.0.0.1:4211', projects: [shop] },
  ]
  const id = elsewhereId(shop.id, 'http://127.0.0.1:4211')
  assert.equal(isElsewhereId(id), true)
  assert.match(id, /^[a-z0-9-]+~[a-z0-9]+$/, 'safe in an address')
  assert.equal(isElsewhereId(projectId('/Users/me/shop~x')), false, "this computer's own ids never are")
  assert.equal(homeOf(machines, id)?.machine, machines[1])
  assert.equal(homeOf(machines, id)?.project, shop)
  assert.equal(homeOf(machines, elsewhereId('gone', 'http://127.0.0.1:4211')), undefined)
  assert.equal(homeOf(machines, elsewhereId(shop.id, 'http://127.0.0.1:9999')), undefined)
  assert.equal(homeOf(machines, shop.id), undefined)
})

test('a project is named to its computer by its address, or by its id there when it has none', () => {
  assert.equal(lineNameOf(shop), 'github.com/me/shop')
  assert.equal(lineNameOf(notes), '#notes-2def')
  assert.equal(idInLineName(lineNameOf(notes)), 'notes-2def')
  assert.equal(idInLineName(lineNameOf(shop)), undefined)
})

test("each repository is listed once: as this computer's when it has it, else as the first computer's that does", () => {
  const blog: OwnProject = { ...shop, id: 'blog-3', name: 'blog', address: 'github.com/me/blog' }
  const laptop: OwnMachine = { id: 'http://127.0.0.1:4210', projects: [shop, notes, blog] }
  const home: OwnMachine = { id: 'http://127.0.0.1:4211', projects: [blog, { ...notes, id: 'notes-9' }] }
  const quiet: OwnMachine = { id: 'http://127.0.0.1:4212' }
  const homes = elsewhereHomes([laptop, home, quiet], new Set(['github.com/me/shop']))
  assert.deepEqual(
    homes.map(one => [one.machine.id, one.project.id]),
    [
      ['http://127.0.0.1:4210', 'notes-2def'],
      ['http://127.0.0.1:4210', 'blog-3'],
      // Two projects with no address are two projects, whatever they are named.
      ['http://127.0.0.1:4211', 'notes-9'],
    ],
  )
})

test("another computer's project is listed as the page lists projects, marked with the computer it is on", () => {
  const machine: OwnMachine = { id: 'http://127.0.0.1:4210', projects: [{ ...shop, lastActivityAt: '2026-10-27T00:00:00.000Z' }] }
  assert.deepEqual(elsewhereSummary({ machine, project: machine.projects![0]! }), {
    id: elsewhereId(shop.id, machine.id),
    path: shop.path,
    name: 'shop',
    activated: true,
    gitHost: true,
    machine: 'http://127.0.0.1:4210',
    lastActivityAt: '2026-10-27T00:00:00.000Z',
  })
})

test("another computer's project is listed with the pages its computer said it has", () => {
  const machine: OwnMachine = { id: 'http://127.0.0.1:4210', projects: [{ ...shop, modules: ['@openagt/skill-queue'] }] }
  assert.deepEqual(elsewhereSummary({ machine, project: machine.projects![0]! }).modules, ['@openagt/skill-queue'])
})

test('a computer is asked for its projects once in a while, and what it said is kept only when it changed', async () => {
  let now = 1_000_000
  const asked: string[] = []
  const kept: [string, OwnProject[]][] = []
  let answer: unknown = [shop]
  const machines: OwnMachine[] = [{ id: 'laptop', projects: [shop] }, { id: 'home' }]
  const projects = new OwnProjectsAsked<OwnMachine>(
    async machine => {
      asked.push(machine.id)
      if (machine.id === 'home') throw new Error('it is off')
      return answer
    },
    async (machine, said) => void kept.push([machine.id, said]),
    () => now,
  )
  await projects.refresh(machines)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(asked, ['laptop', 'home'])
  // The laptop said what it had said before, and the machine that did not answer had nothing kept for it.
  assert.deepEqual(kept, [])

  now += PROJECTS_KEPT_MS - 1
  await projects.refresh(machines)
  assert.deepEqual(asked, ['laptop', 'home'], 'asked again only once its word is old')

  now += 1
  answer = [shop, notes]
  await projects.refresh(machines)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(kept, [['laptop', [shop, notes]]])
})

test('a computer never heard from is waited for, the first time, so its projects are on the first list', async () => {
  let kept: OwnProject[] | undefined
  const projects = new OwnProjectsAsked<OwnMachine>(
    async () => [shop],
    async (_machine, said) => void (kept = said),
  )
  await projects.refresh([{ id: 'laptop' }])
  assert.deepEqual(kept, [shop])
})
