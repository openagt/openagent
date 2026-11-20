import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  isTicketFile,
  isTicketPath,
  queuePriorityForTicket,
  ticketFromQueueEntry,
  ticketIssueRef,
  ticketLockName,
  ticketPlanName,
  TICKETS_DIR,
} from './names.js'

test('the folder is the convention the skill names', () => {
  assert.equal(TICKETS_DIR, 'tickets')
})

test('a ticket names its plan and lock siblings by stem', () => {
  assert.equal(ticketPlanName('2026-07-31_some-ticket.md'), '2026-07-31_some-ticket.plan.md')
  assert.equal(ticketLockName('2026-07-31_some-ticket.md'), '2026-07-31_some-ticket.lock.md')
})

test('a ticket priority maps onto the queue\'s numbered sections', () => {
  assert.equal(queuePriorityForTicket('8'), 8)
  assert.equal(queuePriorityForTicket(' 2 '), 2, 'the key is read verbatim off the ticket, so it may be padded')
  // The ticket format says the key is optional, so an unmarked ticket has to mean something.
  assert.equal(queuePriorityForTicket(undefined), 5)
  // A word, an out-of-range or a fractional value is not a priority on this scale: the middle, not a guess.
  assert.equal(queuePriorityForTicket('high'), 5)
  assert.equal(queuePriorityForTicket('11'), 5)
  assert.equal(queuePriorityForTicket('2.5'), 5)
})

test('ticketFromQueueEntry reads the ticket a queued entry links back to', () => {
  assert.equal(ticketFromQueueEntry('[Add a login page](tickets/2026-07-25_login.md)'), 'tickets/2026-07-25_login.md')
  // An entry that is just text is work with no ticket behind it — a plan ask included.
  assert.equal(ticketFromQueueEntry('Apply the maintainability preset'), undefined)
  assert.equal(ticketFromQueueEntry('Create tickets/2026-07-25_login.plan.md'), undefined)
  // A link to a ticket's plan names no ticket: a plan is not a ticket.
  assert.equal(ticketFromQueueEntry('[Plan it](tickets/2026-07-25_login.plan.md)'), undefined)
  assert.equal(ticketFromQueueEntry('see the [docs](README.md)'), undefined)
  // A traversal dressed as a link is refused at the same gate.
  assert.equal(ticketFromQueueEntry('[sneaky](tickets/../../etc/passwd)'), undefined)
})

test('only a plain file inside tickets/ counts as a ticket path', () => {
  assert.equal(isTicketPath('tickets/2026-07-25_login.md'), true)
  for (const bad of ['tickets/../secrets.md', 'tickets/nested/deep.md', 'tickets/.hidden.md', 'tickets/..md', 'tickets/sub\\x.md', 'tickets/2026-07-25_login.plan.md', 'tickets/2026-07-25_login.lock.md', 'tickets/notes.txt', '/etc/passwd', 'https://example.com/x.md', 'TODO_AGENTS.md', 'tickets/']) {
    assert.equal(isTicketPath(bad), false, `expected ${bad} to be rejected`)
  }
})

test('a bare ticket filename has no path segments, no leading dot and is not a sibling', () => {
  assert.equal(isTicketFile('2026-07-25_login.md'), true)
  for (const bad of ['../login.md', 'sub/login.md', '/etc/passwd.md', 'sub\\x.md', '.hidden.md', '..md', '2026-07-25_login.plan.md', '2026-07-25_login.lock.md', 'meta.json']) {
    assert.equal(isTicketFile(bad), false, `expected ${bad} to be rejected`)
  }
})

test('a name is refused bare exactly when it is refused under tickets/', () => {
  const names = ['2026-07-25_login.md', '.hidden.md', '..md', 'sub\\x.md', 'sub/x.md', 'a.plan.md', 'a.lock.md', 'meta.json', 'notes.txt', '']
  for (const name of names) {
    assert.equal(isTicketPath(`tickets/${name}`), isTicketFile(name), `the two spellings of ${JSON.stringify(name)} disagree`)
  }
})

test('ticketIssueRef reads the issue off the Issue header line, URL first', () => {
  assert.equal(ticketIssueRef('Priority: 5\nIssue: [#42](https://example.com/org/repo/issues/42)\n\n# T\n'), '#42')
  // The URL is the identity: a label that disagrees with it loses.
  assert.equal(ticketIssueRef('Issue: [gh-7](https://example.com/o/r/issues/99)\n'), '#99')
  // A hand-written line with no URL still counts by its label.
  assert.equal(ticketIssueRef('Issue: #13\n'), '#13')
  assert.equal(ticketIssueRef('# A ticket with no Issue line\n'), undefined)
  assert.equal(ticketIssueRef('Issue: none yet\n'), undefined)
})
