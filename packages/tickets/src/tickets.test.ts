import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTickets, readTicket, readTicketsMeta, hasTickets, type TicketsFs } from './tickets.js'

/** A tickets directory on disk. */
async function dir(files: Record<string, string> = {}): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'tickets-read-'))
  for (const [name, content] of Object.entries(files)) await writeFile(join(path, name), content, 'utf8')
  return path
}

test('readTickets is empty when there is no such directory', async () => {
  assert.deepEqual(await readTickets(join(await dir(), 'missing')), [])
})

test('readTickets reads the format: keys above the title, then the TLDR', async () => {
  const cwd = await dir({
    '2026-07-20_do-the-thing.md': ['priority: high', 'topics: [dx]', '', '# Do the thing', '', '## TLDR', '', 'The thing is not done.', '', '## Why it matters', '', 'Because.'].join('\n'),
  })
  const [ticket, ...rest] = await readTickets(cwd)
  assert.equal(rest.length, 0)
  assert.deepEqual(ticket, {
    file: '2026-07-20_do-the-thing.md',
    title: 'Do the thing',
    summary: 'The thing is not done.',
    priority: 'high',
    topics: ['dx'],
    date: '2026-07-20T00:00:00.000Z',
    planned: false,
  })
})

test('readTickets reads the Issue: link, split into its label and URL, and leaves it off when absent', async () => {
  const [linked] = await readTickets(await dir({ '2026-07-20_thing.md': 'Issue: [#42](https://example.com/org/repo/issues/42)\n\n# Thing\n' }))
  assert.deepEqual(linked?.issue, { label: '#42', url: 'https://example.com/org/repo/issues/42' })
  const [bare] = await readTickets(await dir({ '2026-07-20_thing.md': '# Thing\n' }))
  assert.equal(bare?.issue, undefined)
})

test('readTickets reads the Waiting: line as written, and leaves it off when absent or empty', async () => {
  const [waiting] = await readTickets(await dir({ '2026-07-20_thing.md': 'Priority: 3\nWaiting: web runs to come back\n\n# Thing\n' }))
  assert.equal(waiting?.waiting, 'web runs to come back')
  const [none] = await readTickets(await dir({ '2026-07-20_thing.md': '# Thing\n\nWaiting: in the body, not a key\n' }))
  assert.equal(none?.waiting, undefined)
  const [empty] = await readTickets(await dir({ '2026-07-20_thing.md': 'Waiting:\n\n# Thing\n' }))
  assert.equal(empty?.waiting, undefined)
})

test('readTickets reads the PR: link the same way, the ticket in review, keeps a bare value as the label, and leaves it off when absent or empty', async () => {
  const [inReview] = await readTickets(await dir({ '2026-07-20_thing.md': 'Issue: [#42](https://example.com/org/repo/issues/42)\nPR: [#1790](https://example.com/org/repo/pull/1790)\n\n# Thing\n' }))
  assert.deepEqual(inReview?.pr, { label: '#1790', url: 'https://example.com/org/repo/pull/1790' })
  assert.deepEqual(inReview?.issue, { label: '#42', url: 'https://example.com/org/repo/issues/42' })
  const [bare] = await readTickets(await dir({ '2026-07-20_thing.md': 'PR: #1790\n\n# Thing\n' }))
  assert.deepEqual(bare?.pr, { label: '#1790' })
  const [empty] = await readTickets(await dir({ '2026-07-20_thing.md': 'PR:\n\n# Thing\n' }))
  assert.equal(empty?.pr, undefined)
  const [none] = await readTickets(await dir({ '2026-07-20_thing.md': '# Thing\n' }))
  assert.equal(none?.pr, undefined)
})

test('readTickets dates a ticket by its filename, not its mtime, when the filename carries one', async () => {
  const cwd = await dir({ '2026-07-20_thing.md': '# Thing\n' })
  await new Promise(r => setTimeout(r, 1100))
  await writeFile(join(cwd, '2026-07-20_thing.md'), '# Thing, edited\n', 'utf8')
  const [ticket] = await readTickets(cwd)
  assert.equal(ticket?.date, '2026-07-20T00:00:00.000Z')
})

test('readTickets falls back to mtime when the filename carries no date, and to the epoch when even that is unknown', async () => {
  const [ticket] = await readTickets(await dir({ 'no-date-prefix.md': '# Thing\n' }))
  assert.equal(Number.isNaN(Date.parse(ticket?.date as string)), false)
  const fs: TicketsFs = { list: async () => ['no-date.md'], read: async () => '# T\n' }
  const [offGit] = await readTickets('tickets', fs)
  assert.equal(offGit?.date, '1970-01-01T00:00:00.000Z')
})

test('a leftover Status: line is preamble noise, not a field', async () => {
  const [ticket] = await readTickets(await dir({ 'a.md': 'Status: closed\n\n# Thing\n' }))
  assert.equal(ticket?.title, 'Thing')
  assert.ok(ticket && !('status' in ticket))
})

test('readTickets parses a multi-topic list, brackets and all, and leaves topics off when absent', async () => {
  const [listed] = await readTickets(await dir({ '2026-07-20_thing.md': 'topics: [dx, ui, docs]\n\n# Thing\n' }))
  assert.deepEqual(listed?.topics, ['dx', 'ui', 'docs'])
  const [bare] = await readTickets(await dir({ '2026-07-20_thing.md': '# Thing\n' }))
  assert.equal(bare?.topics, undefined)
})

test('readTickets sorts newest-first by date', async () => {
  const cwd = await dir({ '2026-07-19_older.md': '# Older\n', '2026-07-21_newer.md': '# Newer\n' })
  assert.deepEqual((await readTickets(cwd)).map(t => t.title), ['Newer', 'Older'])
})

test('readTickets still lists a ticket written before the format', async () => {
  const [ticket] = await readTickets(await dir({ '629-New_root_directory.md': '# New root directory\n\nThe root is crowded.\n\n---\nSource: https://example.com/1\n' }))
  assert.equal(ticket?.title, 'New root directory')
  assert.equal(ticket?.summary, 'The root is crowded.')
  assert.equal(ticket?.priority, undefined)
})

test('readTickets falls back to the filename when there is no heading, decoding escapes', async () => {
  const [plain] = await readTickets(await dir({ '2026-07-20_no_heading.md': 'just prose\n' }))
  assert.equal(plain?.title, '2026-07-20 no heading')
  const titles = (await readTickets(await dir({ '1-100%_sure.md': 'prose\n', '2-a%20b.md': 'prose\n' }))).map(t => t.title).sort()
  assert.deepEqual(titles, ['1-100% sure', '2-a b'])
})

test('readTickets folds .plan.md into its ticket, never as a row of its own', async () => {
  const cwd = await dir({ '2026-07-20_thing.md': '# Thing\n\nprose\n', '2026-07-20_thing.plan.md': '# [Plan] Thing\n', '2026-07-21_other.md': '# Other\n\nprose\n' })
  assert.deepEqual(
    (await readTickets(cwd)).map(t => [t.file, t.planned]).sort(),
    [
      ['2026-07-20_thing.md', true],
      ['2026-07-21_other.md', false],
    ],
  )
})

test('a .lock.md claim reads as a lock naming its holder, never as a ticket row of its own', async () => {
  const cwd = await dir({ '2026-07-20_thing.md': '# Thing\n\nprose\n', '2026-07-20_thing.lock.md': 'CLAIMED: 2026-08-30T10-00-00-000Z\n' })
  const tickets = await readTickets(cwd)
  assert.equal(tickets.length, 1, 'the lock file is a sibling, not a ticket')
  assert.equal(tickets[0]?.planned, false)
  assert.equal(tickets[0]?.locked, true)
  assert.equal(tickets[0]?.lockedBy, '2026-08-30T10-00-00-000Z')
  const detail = await readTicket(cwd, '2026-07-20_thing.md')
  assert.equal(detail?.locked, true)
  assert.equal(detail?.lockedBy, '2026-08-30T10-00-00-000Z')
})

test('a locked ticket with a real plan is planned and locked at once', async () => {
  const [ticket] = await readTickets(await dir({ '2026-07-20_thing.md': '# Thing\n', '2026-07-20_thing.plan.md': 'Effort: 2\n\n# [Plan] Thing\n', '2026-07-20_thing.lock.md': 'CLAIMED: x\n' }))
  assert.equal(ticket?.planned, true)
  assert.equal(ticket?.locked, true)
  assert.equal(ticket?.effort, 2)
})

test('a malformed lock file still locks, just without a holder', async () => {
  const [ticket] = await readTickets(await dir({ '2026-07-20_thing.md': '# Thing\n', '2026-07-20_thing.lock.md': 'scribbles\n' }))
  assert.equal(ticket?.locked, true)
  assert.equal(ticket?.lockedBy, undefined)
})

test('readTickets reads the plan preamble\'s Effort: and Uncertainty: keys, on the 0-10 scale only, above the heading only', async () => {
  const cwd = await dir({
    '2026-07-20_a.md': '# A\n',
    '2026-07-20_a.plan.md': 'Effort: 3\nUncertainty: 4\n\n# [Plan] A\n',
    '2026-07-20_b.md': '# B\n',
    '2026-07-20_b.plan.md': 'Effort: 15\nUncertainty: 2.5\n\n# [Plan] B\n',
    '2026-07-20_c.md': '# C\n',
    '2026-07-20_c.plan.md': '# [Plan] C\n\nEffort: 3\n',
    '2026-07-20_d.md': '# D\n',
  })
  const byFile = new Map((await readTickets(cwd)).map(t => [t.file, t]))
  assert.equal(byFile.get('2026-07-20_a.md')?.effort, 3)
  assert.equal(byFile.get('2026-07-20_a.md')?.uncertainty, 4)
  assert.equal(byFile.get('2026-07-20_b.md')?.effort, undefined, 'out of range is not clamped')
  assert.equal(byFile.get('2026-07-20_b.md')?.uncertainty, undefined, 'fractional is not a value')
  assert.equal(byFile.get('2026-07-20_c.md')?.effort, undefined, 'the body is not a preamble')
  assert.equal(byFile.get('2026-07-20_a.md')?.outdated, undefined, 'no Outdated: key, no flag')
  assert.equal(byFile.get('2026-07-20_d.md')?.effort, undefined)
  const detail = await readTicket(cwd, '2026-07-20_a.md')
  assert.equal(detail?.effort, 3)
})

test('readTickets ignores non-markdown files and meta.json', async () => {
  const cwd = await dir({ '2026-07-20_thing.md': '# Thing\n', 'notes.txt': 'nope', 'meta.json': '{"lastImportedAt":"2026-07-20T10:00:00.000Z"}' })
  assert.deepEqual((await readTickets(cwd)).map(t => t.file), ['2026-07-20_thing.md'])
  assert.equal(await hasTickets(cwd), true)
})

test('hasTickets agrees with readTickets: no directory, a lone plan or lock, or a stray file is no ticket', async () => {
  assert.equal(await hasTickets(join(await dir(), 'missing')), false)
  assert.equal(await hasTickets(await dir({ '2026-07-20_thing.plan.md': '# Plan\n', '2026-07-20_thing.lock.md': 'CLAIMED: x\n' })), false)
  assert.equal(await hasTickets(await dir({ 'notes.txt': 'nope' })), false)
  assert.equal(await hasTickets(await dir({ '2026-07-20_thing.md': '# Thing\n' })), true)
})

test('readTicket reads the whole file, metadata included', async () => {
  const body = ['priority: high', 'topics: [dx]', '', '# Do the thing', '', '## TLDR', '', 'The thing is not done.', '', 'More below the fold.'].join('\n')
  const ticket = await readTicket(await dir({ '2026-07-20_do-the-thing.md': body }), '2026-07-20_do-the-thing.md')
  assert.deepEqual(ticket, {
    file: '2026-07-20_do-the-thing.md',
    title: 'Do the thing',
    summary: 'The thing is not done.',
    priority: 'high',
    topics: ['dx'],
    date: '2026-07-20T00:00:00.000Z',
    planned: false,
    content: body,
  })
})

test('readTicket is null for a missing file, a sibling, meta.json, or a path that escapes the directory', async () => {
  const cwd = await dir({ '2026-07-20_thing.md': '# Thing\n', '2026-07-20_thing.plan.md': '# [Plan] Thing\n', 'meta.json': '{}' })
  assert.equal(await readTicket(cwd, 'nope.md'), null)
  assert.equal(await readTicket(cwd, '2026-07-20_thing.plan.md'), null)
  assert.equal(await readTicket(cwd, 'meta.json'), null)
  assert.equal(await readTicket(cwd, '../thing.md'), null)
  assert.equal(await readTicket(cwd, '/etc/passwd.md'), null)
  assert.equal(await readTicket(cwd, 'sub/thing.md'), null)
  assert.equal((await readTicket(cwd, '2026-07-20_thing.md'))?.planned, true)
})

test('readTicketsMeta reads the last-import stamp, and answers "not known" for every way the file can be unusable', async () => {
  assert.deepEqual(await readTicketsMeta(await dir({ 'meta.json': JSON.stringify({ lastImportedAt: '2026-07-20T10:00:00.000Z' }) })), { lastImportedAt: '2026-07-20T10:00:00.000Z' })
  assert.deepEqual(await readTicketsMeta(join(await dir(), 'missing')), {}, 'no directory at all')
  assert.deepEqual(await readTicketsMeta(await dir({ 'x.md': '# t' })), {}, 'no meta.json')
  for (const [label, raw] of [['not JSON', 'not json'], ['a string', '"a string"'], ['null', 'null'], ['no stamp', '{}'], ['not a string', '{"lastImportedAt":17}'], ['unparseable', '{"lastImportedAt":"soon"}']]) {
    assert.deepEqual(await readTicketsMeta(await dir({ 'meta.json': raw! })), {}, label)
  }
})

test('the reader works over a git-style seam: relative paths, no modification times', async () => {
  const tree: Record<string, string> = {
    'tickets/2026-07-20_a.md': 'Priority: 7\n\n# A\n\n## TLDR\n\nA line.\n',
    'tickets/2026-07-20_a.lock.md': 'CLAIMED: agent-1\n',
    'tickets/2026-07-19_b.md': '# B\n',
  }
  const fs: TicketsFs = {
    list: async dir => Object.keys(tree).filter(p => p.startsWith(`${dir}/`)).map(p => p.slice(dir.length + 1)),
    read: async path => tree[path],
  }
  const tickets = await readTickets('tickets', fs)
  assert.deepEqual(
    tickets.map(t => [t.file, t.priority, t.locked, t.lockedBy]),
    [
      ['2026-07-20_a.md', '7', true, 'agent-1'],
      ['2026-07-19_b.md', undefined, undefined, undefined],
    ],
  )
  assert.equal((await readTicket('tickets', '2026-07-20_a.md', fs))?.content, tree['tickets/2026-07-20_a.md'])
})

test('readTickets reads the plan preamble\'s Outdated: yes as the outdated flag; any other value, or the key below the heading, is no flag', async () => {
  const cwd = await dir({
    '2026-07-20_a.md': '# A\n',
    '2026-07-20_a.plan.md': 'Effort: 3\nOutdated: yes\n\n# [Plan] A\n',
    '2026-07-20_b.md': '# B\n',
    '2026-07-20_b.plan.md': 'Outdated: no\n\n# [Plan] B\n',
    '2026-07-20_c.md': '# C\n',
    '2026-07-20_c.plan.md': '# [Plan] C\n\nOutdated: yes\n',
  })
  const byFile = new Map((await readTickets(cwd)).map(t => [t.file, t]))
  assert.equal(byFile.get('2026-07-20_a.md')?.outdated, true)
  assert.equal(byFile.get('2026-07-20_a.md')?.effort, 3)
  assert.equal(byFile.get('2026-07-20_b.md')?.outdated, undefined)
  assert.equal(byFile.get('2026-07-20_c.md')?.outdated, undefined, 'the body is not a preamble')
})
