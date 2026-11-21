import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import type { FileBranchWrite } from '@openagt/agent-data'
import { claimTickets, releaseTicket, lockContent, lockHolder, claimMessage, releaseMessage, claimHistory } from './locks.js'
import type { TicketDeps, TicketsFunnel } from './store.js'

const ROOT = '/repo'
/** Where the funnel's op runs: the branch's checkout. */
const DIR = join(ROOT, '.branches', 'tickets')

/**
 * An in-memory checkout behind a fake write funnel: the op runs against a file map, the outcome
 * is scripted. `runs: 2` re-runs the op, the way the real funnel does when a push loses a race
 * and the cycle re-applies the intent against origin's fresher state. A cycle that failed whole
 * restores the map, like the real funnel resets the checkout.
 */
function checkout(files: Record<string, string> = {}, opts: { result?: (changed: boolean) => FileBranchWrite; runs?: number } = {}) {
  const disk = new Map(Object.entries(files).map(([file, md]) => [join(DIR, file), md]))
  const logs: string[] = []
  const messages: string[] = []
  const funnel: TicketsFunnel = async (_root, message, op) => {
    const before = new Map(disk)
    for (let i = 0; i < (opts.runs ?? 1); i++) await op(DIR)
    const changed = disk.size !== before.size || [...disk].some(([key, value]) => before.get(key) !== value)
    const result = opts.result?.(changed) ?? { ok: true, changed, pushed: true }
    if (changed && (result.ok || result.committed)) messages.push(typeof message === 'function' ? message() : message)
    if (!result.ok && !result.committed) {
      disk.clear()
      for (const [key, value] of before) disk.set(key, value)
    }
    return result
  }
  const deps: TicketDeps = {
    funnel,
    write: async (path, content) => void disk.set(path, content),
    read: async path => {
      const md = disk.get(path)
      if (md === undefined) throw new Error('ENOENT')
      return md
    },
    remove: async path => void disk.delete(path),
    log: message => logs.push(message),
  }
  return { disk, logs, messages, deps }
}

test('claimTickets writes one .lock.md per claim through the funnel, as one commit naming the count', async () => {
  const { disk, messages, deps } = checkout({ 'tickets/a.md': '# a', 'tickets/b.md': '# b' })
  const locked = await claimTickets(ROOT, [{ ticket: 'a.md', holder: 'agent-1' }, { ticket: 'b.md', holder: 'agent-2' }], 'plan', deps)
  assert.deepEqual(locked.map(a => a.ticket), ['a.md', 'b.md'])
  assert.equal(disk.get(join(DIR, 'tickets/a.lock.md')), 'CLAIMED: agent-1\n')
  assert.equal(disk.get(join(DIR, 'tickets/b.lock.md')), 'CLAIMED: agent-2\n')
  assert.deepEqual(messages, ['claim 2 tickets'])
  assert.equal(claimMessage([{ ticket: 'a.md', holder: 'x' }]), 'claim tickets/a')
})

test('a plan claim skips a ticket already locked or already planned; a drain claim takes the planned one', async () => {
  const files = { 'tickets/a.md': '# a', 'tickets/a.lock.md': 'CLAIMED: someone-else', 'tickets/b.md': '# b', 'tickets/b.plan.md': '# a real plan', 'tickets/c.md': '# c' }
  const plan = checkout(files)
  const planned = await claimTickets(ROOT, [{ ticket: 'a.md', holder: 'x-0' }, { ticket: 'b.md', holder: 'x-1' }, { ticket: 'c.md', holder: 'x-2' }], 'plan', plan.deps)
  assert.deepEqual(planned.map(a => a.ticket), ['c.md'])
  assert.equal(plan.disk.get(join(DIR, 'tickets/a.lock.md')), 'CLAIMED: someone-else')
  assert.equal(plan.disk.has(join(DIR, 'tickets/b.lock.md')), false, 'the planned ticket gains no lock')
  // For a drain the `.plan.md` is the work it came to implement, so only an existing lock skips.
  const drain = checkout(files)
  const drained = await claimTickets(ROOT, [{ ticket: 'a.md', holder: 'd-0' }, { ticket: 'b.md', holder: 'd-1' }], 'drain', drain.deps)
  assert.deepEqual(drained.map(a => a.ticket), ['b.md'])
  assert.equal(drain.disk.get(join(DIR, 'tickets/b.lock.md')), 'CLAIMED: d-1\n')
})

test('a batch whose cycle could not land resolves [] and logs the error, even for an empty batch', async () => {
  const { disk, logs, deps } = checkout({ 'tickets/a.md': '# a' }, { result: () => ({ ok: false, committed: false, error: 'index.lock held' }) })
  assert.deepEqual(await claimTickets(ROOT, [{ ticket: 'a.md', holder: 'x-0' }], 'plan', deps), [])
  assert.equal(disk.has(join(DIR, 'tickets/a.lock.md')), false)
  assert.ok(logs.some(line => line.includes('could not be committed') && line.includes('index.lock held')))
})

test('the default write creates tickets/ when the checkout has none', async () => {
  const { mkdtemp, rm, readFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(join(tmpdir(), 'tickets-lock-'))
  try {
    const funnel: TicketsFunnel = async (_root, _message, op) => {
      await op(dir)
      return { ok: true, changed: true, pushed: true }
    }
    assert.deepEqual((await claimTickets(ROOT, [{ ticket: 'a.md', holder: 'x-0' }], 'plan', { funnel })).map(a => a.ticket), ['a.md'])
    assert.equal(await readFile(join(dir, 'tickets/a.lock.md'), 'utf8'), 'CLAIMED: x-0\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a batch that committed but could not push is kept, and the gap is logged', async () => {
  const { logs, deps } = checkout({ 'tickets/a.md': '# a' }, { result: () => ({ ok: false, committed: true, error: 'network down' }) })
  assert.deepEqual((await claimTickets(ROOT, [{ ticket: 'a.md', holder: 'x-0' }], 'plan', deps)).map(a => a.ticket), ['a.md'])
  assert.ok(logs.some(line => line.includes('cannot see these 1 claim(s)')))
})

test('a re-run op re-judges the batch instead of double-claiming', async () => {
  const { disk, messages, deps } = checkout({ 'tickets/a.md': '# a' }, { runs: 2 })
  assert.deepEqual((await claimTickets(ROOT, [{ ticket: 'a.md', holder: 'x-0' }], 'plan', deps)).map(a => a.ticket), ['a.md'])
  assert.equal(disk.get(join(DIR, 'tickets/a.lock.md')), 'CLAIMED: x-0\n')
  assert.deepEqual(messages, ['claim tickets/a'])
})

test('releaseTicket frees the lock and says so in the commit; no lock is no-lock', async () => {
  const { disk, messages, deps } = checkout({ 'tickets/a.lock.md': lockContent('agent-1') })
  assert.equal(await releaseTicket(ROOT, 'a.md', {}, deps), 'released')
  assert.equal(disk.has(join(DIR, 'tickets/a.lock.md')), false)
  assert.deepEqual(messages, [releaseMessage('a.md')])
  assert.equal(releaseMessage('a.md'), 'release tickets/a')
  const empty = checkout({ 'tickets/a.md': '# a' })
  assert.equal(await releaseTicket(ROOT, 'a.md', {}, empty.deps), 'no-lock')
  assert.deepEqual(empty.messages, [], 'nothing committed')
})

test('a release whose cycle could not land reports error and changes nothing; one that could not push stands', async () => {
  const failed = checkout({ 'tickets/a.lock.md': lockContent('agent-1') }, { result: () => ({ ok: false, committed: false, error: 'index.lock held' }) })
  assert.equal(await releaseTicket(ROOT, 'a.md', {}, failed.deps), 'error')
  assert.equal(failed.disk.get(join(DIR, 'tickets/a.lock.md')), lockContent('agent-1'))
  const unpushed = checkout({ 'tickets/a.lock.md': lockContent('agent-1') }, { result: () => ({ ok: false, committed: true, error: 'no network' }) })
  assert.equal(await releaseTicket(ROOT, 'a.md', {}, unpushed.deps), 'released')
  assert.equal(unpushed.disk.has(join(DIR, 'tickets/a.lock.md')), false)
  assert.ok(unpushed.logs.some(line => /could not be pushed/.test(line)))
})

test('a heldBy release frees the exact claim named, leaves anyone else\'s alone, and answers no-lock when gone', async () => {
  const mine = checkout({ 'tickets/a.lock.md': lockContent('agent-1') })
  assert.equal(await releaseTicket(ROOT, 'a.md', { heldBy: 'agent-1' }, mine.deps), 'released')
  assert.equal(mine.disk.has(join(DIR, 'tickets/a.lock.md')), false)
  const theirs = checkout({ 'tickets/a.lock.md': lockContent('someone-else') })
  assert.equal(await releaseTicket(ROOT, 'a.md', { heldBy: 'agent-1' }, theirs.deps), 'not-holder')
  assert.equal(theirs.disk.get(join(DIR, 'tickets/a.lock.md')), lockContent('someone-else'))
  assert.deepEqual(theirs.messages, [], 'nothing committed')
  const gone = checkout({ 'tickets/a.md': '# a' })
  assert.equal(await releaseTicket(ROOT, 'a.md', { heldBy: 'agent-1' }, gone.deps), 'no-lock')
})

test('lockHolder reads the claim and rejects non-claims', () => {
  assert.equal(lockHolder(lockContent('agent-1')), 'agent-1')
  assert.equal(lockHolder('  \nCLAIMED: run-42 (my session)'), 'run-42 (my session)')
  assert.equal(lockHolder('# A real plan\n\nCLAIMED elsewhere…'), undefined)
  assert.equal(lockHolder('CLAIMED:'), undefined)
  assert.equal(lockHolder(''), undefined)
})

test('claimHistory lists the holders the lock\'s commits added, newest first, each once', () => {
  const patch = [
    'diff --git a/tickets/x.lock.md b/tickets/x.lock.md',
    'deleted file mode 100644',
    '--- a/tickets/x.lock.md',
    '+++ /dev/null',
    '-CLAIMED: run-3',
    'diff --git a/tickets/x.lock.md b/tickets/x.lock.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/tickets/x.lock.md',
    '+CLAIMED: run-3',
    '-CLAIMED: run-1',
    '+CLAIMED: run-2',
    '+CLAIMED: run-3',
    '+not a claim',
    '+CLAIMED: run-1',
  ].join('\n')
  assert.deepEqual(claimHistory(patch), ['run-3', 'run-2', 'run-1'])
  assert.deepEqual(claimHistory(''), [])
})
