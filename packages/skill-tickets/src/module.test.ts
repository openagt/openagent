import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { heldBack, holderAgent, hotLane, isHighPriority, namesOf, planAgentFor, planLink, planPath, planTicketPrompt, readListed, readMeta, readShown, routeOf, ticketLink, workOnTicketPrompt } from './module.js'

const FILE = '2026-08-30_login-page.md'

test('the prompts and paths are one wording each, made from the ticket\'s filename', () => {
  assert.equal(planTicketPrompt(FILE), 'Create tickets/2026-08-30_login-page.plan.md')
  assert.equal(workOnTicketPrompt(FILE), 'Work on tickets/2026-08-30_login-page.md. Do not start any other ticket.')
  assert.equal(planPath(FILE), 'tickets/2026-08-30_login-page.plan.md')
})

test('planAgentFor picks the newest run whose ask names the plan; holderAgent the run the lock names', () => {
  const agents = [
    { id: 'a1', ask: 'Create tickets/2026-08-30_login-page.plan.md', status: 'done', startedAt: '2026-09-01T00:00:00Z' },
    { id: 'a2', ask: 'Plan it: Create tickets/2026-08-30_login-page.plan.md please', status: 'running', startedAt: '2026-09-02T00:00:00Z' },
    { id: 'a3', ask: 'Work on tickets/2026-08-30_login-page.md. Do not start any other ticket.', status: 'done', startedAt: '2026-09-03T00:00:00Z' },
    { id: 'a4', status: 'done', startedAt: '2026-09-04T00:00:00Z' },
  ]
  assert.equal(planAgentFor(agents, FILE)?.id, 'a2')
  assert.equal(planAgentFor(agents, '2026-01-01_other.md'), undefined)
  assert.equal(holderAgent(agents, 'a3')?.id, 'a3')
  assert.equal(holderAgent(agents, 'feature/x'), undefined)
  assert.equal(holderAgent(agents, undefined), undefined)
})

test('routeOf reads the list, a ticket, its plan, and nothing else', () => {
  assert.deepEqual(routeOf([]), { view: 'list' })
  assert.deepEqual(routeOf(['p1', FILE]), { view: 'ticket', projectId: 'p1', file: FILE })
  assert.deepEqual(routeOf(['p1', FILE, 'plan']), { view: 'plan', projectId: 'p1', file: FILE })
  assert.deepEqual(routeOf(['p1']), { view: 'unknown' })
  assert.deepEqual(routeOf(['p1', '../x.md']), { view: 'unknown' })
  assert.deepEqual(routeOf(['p1', '2026-08-30_login-page.plan.md']), { view: 'unknown' })
  assert.deepEqual(routeOf(['p1', FILE, 'diff']), { view: 'unknown' })
  assert.deepEqual(routeOf(['p1', FILE, 'plan', 'x']), { view: 'unknown' })
})

test('a ticket as a link points at its file at its own priority; a plan ask points nowhere', () => {
  assert.deepEqual(ticketLink({ file: FILE, title: 'Login page', priority: '8' }), { text: 'Login page', href: `tickets/${FILE}`, priority: 8 })
  assert.deepEqual(ticketLink({ file: FILE, title: 'Login page' }), { text: 'Login page', href: `tickets/${FILE}`, priority: 5 })
  assert.deepEqual(planLink({ file: FILE, title: 'Login page', priority: '0' }), { text: planTicketPrompt(FILE), priority: 0 })
})

test('the command\'s answers are read back: a list, one ticket or its refusal, the import stamp', () => {
  const row = { file: FILE, title: 'Login page', summary: '', date: '2026-08-30T00:00:00.000Z', planned: false }
  assert.deepEqual(readListed({ ok: true, output: [row, { file: 'x' }, 'no'] }), { tickets: [row] })
  assert.deepEqual(readListed({ ok: true, output: { ok: false } }), { error: 'the tickets command did not print a list' })
  assert.deepEqual(readListed({ ok: false, error: 'tickets took too long' }), { error: 'tickets took too long' })
  const detail = { ...row, content: '# Login page\n' }
  assert.deepEqual(readShown({ ok: true, output: { ok: true, ticket: detail, plan: 'Effort: 1\n', holder: 'a1' } }), { shown: { ticket: detail, plan: 'Effort: 1\n', holder: 'a1' } })
  assert.deepEqual(readShown({ ok: true, output: { ok: true, ticket: detail } }), { shown: { ticket: detail } })
  assert.deepEqual(readShown({ ok: true, output: { ok: false, reason: 'no-ticket', file: FILE } }), { shown: null })
  assert.deepEqual(readShown({ ok: true, output: { ok: true, ticket: row } }), { error: 'the tickets command did not print a ticket' })
  assert.deepEqual(readShown({ ok: false, error: 'boom' }), { error: 'boom' })
  assert.deepEqual(readMeta({ ok: true, output: { lastImportedAt: '2026-09-01T00:00:00Z' } }), { lastImportedAt: '2026-09-01T00:00:00Z' })
  assert.deepEqual(readMeta({ ok: true, output: {} }), {})
  assert.deepEqual(readMeta({ ok: false, error: 'x' }), {})
})

test('heldBack: a PR: line is in review, a Waiting: line is waiting, in review first when both; anything else is free to work', () => {
  const pr = { label: '#12', url: 'https://example.com/pull/12' }
  assert.equal(heldBack({ pr }), 'in-review')
  assert.equal(heldBack({ waiting: 'the vendor' }), 'waiting')
  assert.equal(heldBack({ pr, waiting: 'the vendor' }), 'in-review')
  assert.equal(heldBack({}), undefined)
  assert.equal(heldBack({ waiting: '' }), undefined)
})

test('hotLane: a ticket in review is in no lane; a waiting one is in Waiting at any priority; a claim outranks both', () => {
  assert.equal(hotLane({ priority: '9', pr: { label: '#12', url: 'u' } }), null)
  assert.equal(hotLane({ priority: '9', waiting: 'the vendor' }), 'waiting')
  assert.equal(hotLane({ priority: '2', waiting: 'the vendor' }), 'waiting')
  assert.equal(hotLane({ waiting: 'the vendor', pr: { label: '#12', url: 'u' } }), 'waiting')
  assert.equal(hotLane({ locked: true, priority: '9', waiting: 'the vendor' }), 'claimed')
})

test('hotLane: a claimed ticket is in the claimed lane whatever its priority, an unclaimed one at 7 or up is high priority, the rest are off the card', () => {
  assert.equal(hotLane({ locked: true }), 'claimed')
  assert.equal(hotLane({ locked: true, priority: '2' }), 'claimed')
  assert.equal(hotLane({ priority: '7' }), 'high-priority')
  assert.equal(hotLane({ priority: '10' }), 'high-priority')
  assert.equal(hotLane({ locked: false, priority: '6' }), null)
  assert.equal(hotLane({}), null)
  // The format's 0-10 scale, never a P0/P1 reading, never a word.
  assert.equal(hotLane({ priority: '0' }), null)
  assert.equal(hotLane({ priority: 'high' }), null)
  assert.equal(isHighPriority(' 8 '), true)
  assert.equal(isHighPriority(undefined), false)
})

test('a path under tickets/ is called what its ticket is called: a ticket by its title, a plan as the plan of its ticket, which it opens', () => {
  const tickets = [{ file: FILE, title: 'Login page' }]
  assert.deepEqual(namesOf([`tickets/${FILE}`, 'tickets/2026-08-30_login-page.plan.md'], tickets), {
    [`tickets/${FILE}`]: { title: 'Login page' },
    'tickets/2026-08-30_login-page.plan.md': { title: 'Plan: Login page', href: `tickets/${FILE}` },
  })
  // A ticket that is not listed (closed, deleted), its plan, and a path that is no ticket's have no name.
  assert.deepEqual(namesOf(['tickets/2026-01-01_gone.md', 'tickets/2026-01-01_gone.plan.md', 'docs/readme.md', 'tickets/'], tickets), {})
})
