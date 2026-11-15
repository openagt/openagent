import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { newTicketFile, readTicketFile, topicsIn, writeTicketFile } from './ticket-file.js'

const LINKED = `Priority: 8
Topics: [install, windows]
Issue: [#2361](https://example.com/issues/2361)

# Install on Windows

## TLDR

It works on a Mac.
`

test('a ticket reads as its priority, topics, title and text, the other lines above its title kept as written', () => {
  assert.deepEqual(readTicketFile(LINKED), {
    priority: '8',
    topics: ['install', 'windows'],
    waiting: '',
    title: 'Install on Windows',
    body: '## TLDR\n\nIt works on a Mac.',
    kept: ['Issue: [#2361](https://example.com/issues/2361)'],
  })
})

test('a ticket read and written back unchanged is the same file', () => {
  assert.equal(writeTicketFile(readTicketFile(LINKED)), LINKED)
})

test('an edit changes only what was edited: the issue line stays', () => {
  const edited = writeTicketFile({ ...readTicketFile(LINKED), priority: '', topics: ['install'], body: 'Shorter.' })
  assert.equal(edited, 'Topics: [install]\nIssue: [#2361](https://example.com/issues/2361)\n\n# Install on Windows\n\nShorter.\n')
})

test('a priority or topics line written in lowercase reads as the field, and is written back as one line', () => {
  const fields = readTicketFile('priority: 8\ntopics: [ui]\n\n# Login page\n')
  assert.equal(fields.priority, '8')
  assert.deepEqual(fields.topics, ['ui'])
  assert.equal(writeTicketFile({ ...fields, priority: '3' }), 'Priority: 3\nTopics: [ui]\n\n# Login page\n')
})

test('what a ticket waits on is a field: read in any case, written back after the topics, and cleared when emptied', () => {
  const fields = readTicketFile('Priority: 9\nIssue: [#4](https://example.com/issues/4)\nwaiting: the design review\n\n# Checkout\n')
  assert.equal(fields.waiting, 'the design review')
  assert.deepEqual(fields.kept, ['Issue: [#4](https://example.com/issues/4)'])
  assert.equal(writeTicketFile(fields), 'Priority: 9\nWaiting: the design review\nIssue: [#4](https://example.com/issues/4)\n\n# Checkout\n')
  assert.equal(writeTicketFile({ ...fields, waiting: ' ' }), 'Priority: 9\nIssue: [#4](https://example.com/issues/4)\n\n# Checkout\n')
})

test('a new ticket with nothing above its title is its title and its text', () => {
  assert.equal(writeTicketFile({ priority: '', topics: [], waiting: '', title: ' Dark mode ', body: '', kept: [] }), '# Dark mode\n')
  assert.equal(writeTicketFile({ priority: '3', topics: [], waiting: '', title: 'Dark mode', body: 'A toggle.', kept: [] }), 'Priority: 3\n\n# Dark mode\n\nA toggle.\n')
})

test('topics are typed with commas, brackets optional, each once, lowercased', () => {
  assert.deepEqual(topicsIn('UI, ux ,, ui'), ['ui', 'ux'])
  assert.deepEqual(topicsIn('[dx, ui]'), ['dx', 'ui'])
  assert.deepEqual(topicsIn('  '), [])
})

test('a new ticket is named by its day and its title, and never takes a name already there', () => {
  assert.equal(newTicketFile('Add a footer: with the year!', '2026-11-13', new Set()), '2026-11-13_add-a-footer-with-the-year.md')
  assert.equal(newTicketFile('Dark mode', '2026-11-13', new Set(['2026-11-13_dark-mode.md', '2026-11-13_dark-mode-2.md'])), '2026-11-13_dark-mode-3.md')
  assert.equal(newTicketFile('!!!', '2026-11-13', new Set()), '2026-11-13_ticket.md')
})
