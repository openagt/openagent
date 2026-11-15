import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner, withProjectData } from '@openagt/agent-data'
import { appendQueueEntry, insertQueueEntry, parseQueueEntries, parseQueueSections, readQueue, removeQueueEntry } from './queue.js'
import { QUEUE_FILE } from './names.js'

test('parseQueueEntries reads open list items and skips checked, blank and prose lines', () => {
  const md = ['# Backlog', '', 'Some prose about the backlog.', '- [ ] fix the login redirect', '- [x] already done', '- [X] also done', '- plain bullet entry', '* star bullet entry', '2. numbered entry', '- [ ]   ', '-    '].join('\n')
  assert.deepEqual(parseQueueEntries(md), ['fix the login redirect', 'plain bullet entry', 'star bullet entry', 'numbered entry'])
})

test('the priority sections need no parser support: headings are skipped, so a sorted file drains in priority order', () => {
  const md = ['## Priority 10 (critical — act immediately)', '- restore checkout', '', '## Priority 9', '- flaky auth test', '', '## Priority 5', '- tidy the config loader', '', '## Priority 0 (only if capacity)', '- rename the legacy flag'].join('\n')
  assert.deepEqual(parseQueueEntries(md), ['restore checkout', 'flaky auth test', 'tidy the config loader', 'rename the legacy flag'])
})

test('parseQueueSections gives each open entry the priority of its section, none before any section or under another heading', () => {
  const md = ['# Backlog', '', '- before any section', '', '## Priority 10 (critical — act immediately)', '- restore checkout', '- [x] already restored', '', '## priority 5', '', '- [ ] tidy the config loader', 'prose in the section', '', '## Notes', '- not ranked', '', '## Priority 0', '- rename the legacy flag'].join('\n')
  assert.deepEqual(parseQueueSections(md), [
    { entry: 'before any section' },
    { entry: 'restore checkout', priority: 10 },
    { entry: 'tidy the config loader', priority: 5 },
    { entry: 'not ranked' },
    { entry: 'rename the legacy flag', priority: 0 },
  ])
  // The same entries, in the same order, as the plain read.
  assert.deepEqual(parseQueueSections(md).map(p => p.entry), parseQueueEntries(md))
  assert.deepEqual(parseQueueSections(''), [])
})

test('removeQueueEntry deletes the named open entry and nothing else', () => {
  const md = '- first\n- [ ] second\n- [x] done already\n- plain bullet\n'
  assert.equal(removeQueueEntry(md, 'first'), '- [ ] second\n- [x] done already\n- plain bullet\n')
  assert.equal(removeQueueEntry(md, 'second'), '- first\n- [x] done already\n- plain bullet\n')
  // An entry nobody has any more changes nothing; a checked line is not an open entry.
  assert.equal(removeQueueEntry(md, 'gone'), md)
  assert.equal(removeQueueEntry(md, 'done already'), md)
})

test('appendQueueEntry writes a plain bullet at the end', () => {
  assert.equal(appendQueueEntry('', 'x'), '- x\n')
  assert.equal(appendQueueEntry('- a', 'x'), '- a\n- x\n')
  assert.equal(appendQueueEntry('- a\n', 'x'), '- a\n- x\n')
})

test('a queued entry lands in its own priority section, not at the end of the file', () => {
  const md = ['# Backlog', '', '## Priority 7', '', '- an important thing', '', '## Priority 2', '', '- someday', ''].join('\n')
  const out = insertQueueEntry(md, 'a medium thing', 5)
  assert.match(out, /## Priority 5\n\n- a medium thing/)
  assert.ok(out.indexOf('an important thing') < out.indexOf('a medium thing'))
  assert.ok(out.indexOf('a medium thing') < out.indexOf('someday'))
})

test('an entry joins the section it belongs to when there already is one', () => {
  const md = ['## Priority 5', '', '- first', '', '## Priority 2', '', '- later', ''].join('\n')
  const out = insertQueueEntry(md, 'second', 5)
  assert.match(out, /- first\n- second/)
  assert.equal(out.match(/## Priority 5/g)?.length, 1)
})

test('a file with no priority sections gets one above its own headings; prose alone gets a section', () => {
  const md = ['# Backlog', '', 'Some prose.', '', '## MVP v1', '', '- dogfooding', ''].join('\n')
  const out = insertQueueEntry(md, 'queued thing', 5)
  assert.ok(out.indexOf('queued thing') < out.indexOf('dogfooding'))
  assert.ok(out.startsWith('# Backlog\n\nSome prose.\n'), 'the intro stays at the top')
  assert.deepEqual(parseQueueEntries(out), ['queued thing', 'dogfooding'])
  assert.match(insertQueueEntry('# Backlog\n\nSome prose.\n', 'queued thing', 5), /## Priority 5\n\n- queued thing\n$/)
})

test('an entry that outranks everything goes first; one outranked by everything goes last, in its own section', () => {
  const first = insertQueueEntry(['## Priority 2', '', '- someday', ''].join('\n'), 'urgent thing', 9)
  assert.ok(first.indexOf('urgent thing') < first.indexOf('someday'))
  const last = insertQueueEntry(['## Priority 9', '', '- urgent thing', ''].join('\n'), 'someday', 2)
  assert.ok(last.indexOf('urgent thing') < last.indexOf('someday'))
  assert.match(last, /## Priority 2\n\n- someday/)
})

test('a section heading with the format\'s own gloss is still matched', () => {
  const out = insertQueueEntry(['## Priority 10 (critical)', '', '- the fire', ''].join('\n'), 'another fire', 10)
  assert.equal(out.match(/## Priority 10/g)?.length, 1)
  assert.match(out, /- the fire\n- another fire/)
})

// Against real git: the queue lives in the project's data, read from anywhere in the repository.
const git = nodeGitRunner()
const RETRIED_RM = { recursive: true, force: true, maxRetries: 10 } as const

async function repo(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'queue-')))
  await git(['init', '-b', 'main'], path)
  await git(['config', 'user.email', 't@t'], path)
  await git(['config', 'user.name', 't'], path)
  await writeFile(join(path, 'README.md'), '# t\n')
  await git(['add', '-A'], path)
  await git(['commit', '-m', 'init'], path)
  return path
}

test('readQueue reads the queue in the project\'s data, from the project and from an agent worktree', async () => {
  const root = await repo()
  const entries = async (cwd: string) => parseQueueEntries((await readQueue(cwd)) ?? '')
  try {
    assert.equal(await readQueue(root), undefined)
    // The pure parser and the read agree on the seam every writer uses.
    await withProjectData(root, 'by hand', async dir => {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, QUEUE_FILE), '## Priority 3\n\n- [ ] by hand\n')
    })
    assert.deepEqual(await entries(root), ['by hand'])
    // From an agent's worktree: the project root is resolved, and the same queue is read.
    const wt = join(root, '.branches', 'agent-x')
    await git(['worktree', 'add', wt, '-b', 'agent-x'], root)
    assert.deepEqual(await entries(wt), ['by hand'])
  } finally {
    await rm(root, RETRIED_RM)
  }
})
