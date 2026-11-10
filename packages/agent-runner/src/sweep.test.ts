import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logCardFile, logDiaryFile } from '@openagt/agent-driver'
import { createCheckout, worktreePath } from '@openagt/skill-branches'
import { findRun, type RunCard } from '@openagt/skill-logs'
import { hideLiveDir, liveDir, readLiveCard } from './live-card.js'
import { markerCard, writeMarker } from './records.js'
import { acquireRunLock, runStderrPath } from './run-lock.js'
import { sweep } from './sweep.js'
import { git, readUntimedDiary, removeRepo, testRepo } from './test-repo.js'

// The sweep on real checkouts: the live card and diary as agent-driver's log leaves them, and the
// markers on the branch. The agent is never run.

/** A run's lock as its process leaves it while it lives. */
function hold(repo: string, id: string, pid: number): Promise<void> {
  return acquireRunLock(repo, id, { pid, isAlive: () => true })
}

const NOW = new Date('2026-09-16T14:30:00.000Z')

/** A checkout with a live card and diary, as a run's session leaves them while it works. */
async function liveRun(repo: string, id: string, host: string, pid: number, status: RunCard['status'] = 'running', parent?: string, base?: string): Promise<RunCard> {
  const checkout = await createCheckout(repo, { agentId: id, ...(base !== undefined ? { base } : {}) })
  const started = base !== undefined ? { base, baseCommit: (await git(['rev-parse', 'HEAD'], checkout.path)).trim() } : {}
  const mark = { host, pid, ...(parent !== undefined ? { parent } : {}), ...started }
  const card: RunCard = { id, startedAt: '2026-09-16T14:01:00.000Z', status, intent: '/work-queue', driver: 'fake', model: 'opus', branch: checkout.branch, caller: { runner: mark, pid, host, kind: 'prompt' } }
  if (status !== 'running') card.endedAt = '2026-09-16T14:20:00.000Z'
  const dir = liveDir(checkout.path)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, logCardFile(id)), JSON.stringify(card, null, 2) + '\n')
  const lines = [
    { kind: 'start', prompt: '/work-queue', at: card.startedAt },
    { kind: 'said', text: 'working…', at: '2026-09-16T14:02:00.000Z' },
    ...(status !== 'running' ? [{ kind: 'ended', status, at: card.endedAt }] : []),
  ]
  await writeFile(join(dir, logDiaryFile(id)), lines.map(l => JSON.stringify(l) + '\n').join(''))
  await git(['config', 'core.excludesFile', '/dev/null'], checkout.path).catch(() => {})
  await hideLiveDir(checkout.path)
  await writeMarker(repo, markerCard({ id, startedAt: card.startedAt, prompt: '/work-queue', driver: 'fake', model: 'opus', mark }))
  return card
}

test('a running checkout under a dead pid on this machine is ended, recorded failed with what it said, and reclaimed', async () => {
  const repo = await testRepo()
  try {
    await liveRun(repo, 'dead', 'this-box', 999_999)
    await liveRun(repo, 'alive', 'this-box', 1)
    await hold(repo, 'alive', 1)
    await liveRun(repo, 'elsewhere', 'other-box', 999_999)
    const result = await sweep(repo, { host: 'this-box', isAlive: pid => pid === 1, now: () => NOW })
    assert.deepEqual(result.recorded, [{ id: 'dead', status: 'failed' }])
    assert.deepEqual(result.reclaimed, ['dead'])
    assert.equal(await stat(worktreePath(repo, 'dead')).then(() => true, () => false), false)
    const card = await findRun(repo, 'dead')
    assert.equal(card?.status, 'failed')
    assert.equal(card?.endedAt, NOW.toISOString())
    const diary = await readUntimedDiary(repo, 'dead')
    assert.deepEqual(diary.find(l => l.kind === 'said'), { kind: 'said', text: 'working…' })
    assert.deepEqual(diary.at(-1), { kind: 'ended', status: 'failed', detail: 'its process died before the run ended' })
    assert.equal((await readLiveCard(worktreePath(repo, 'alive'), 'alive'))?.status, 'running')
    assert.equal((await readLiveCard(worktreePath(repo, 'elsewhere'), 'elsewhere'))?.status, 'running')
    assert.equal((await findRun(repo, 'elsewhere'))?.status, 'running')
  } finally {
    await removeRepo(repo)
  }
})

test('a run that ended but whose process died before the record: recorded as it ended, reclaimed; a waiting run is recorded and kept', async () => {
  const repo = await testRepo()
  try {
    await liveRun(repo, 'ended', 'this-box', 999_999, 'done')
    await liveRun(repo, 'asked', 'this-box', 999_999, 'waiting')
    const result = await sweep(repo, { host: 'this-box', isAlive: () => false, now: () => NOW })
    assert.deepEqual(result.recorded.sort((a, b) => a.id.localeCompare(b.id)), [{ id: 'asked', status: 'waiting' }, { id: 'ended', status: 'done' }])
    assert.equal((await findRun(repo, 'ended'))?.status, 'done')
    assert.deepEqual(result.reclaimed, ['ended'])
    assert.equal((await findRun(repo, 'ended'))?.branch, undefined, 'its branch held nothing and went with the checkout: the record names none')
    assert.equal((await findRun(repo, 'asked'))?.branch, 'agent-asked', 'a kept checkout keeps its branch on the record')
    assert.deepEqual(result.kept, [{ id: 'asked', reason: 'waiting' }])
    assert.equal((await findRun(repo, 'asked'))?.status, 'waiting')
    assert.equal(await stat(worktreePath(repo, 'asked')).then(() => true, () => false), true, 'the answer resumes the run there')
    // The next tick finds the waiting run as it left it: kept, and its record, which says so already, is not written again.
    const again = await sweep(repo, { host: 'this-box', isAlive: () => false, now: () => NOW })
    assert.deepEqual(again.recorded, [])
    assert.deepEqual(again.kept, [{ id: 'asked', reason: 'waiting' }])
  } finally {
    await removeRepo(repo)
  }
})

test("a run started from another run's branch that committed nothing: its branch goes with the checkout, measured from the commit on its mark", async () => {
  const repo = await testRepo()
  try {
    await git(['checkout', '-q', '-b', 'agent-plan'], repo)
    await writeFile(join(repo, 'plan.txt'), 'the plan\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-q', '-m', 'Plan'], repo)
    await git(['push', '-q', 'origin', 'agent-plan'], repo)
    await git(['checkout', '-q', 'main'], repo)
    await liveRun(repo, 'sub', 'this-box', 999_999, 'done', undefined, 'agent-plan')
    const result = await sweep(repo, { host: 'this-box', isAlive: () => false, now: () => NOW })
    assert.deepEqual(result.reclaimed, ['sub'])
    assert.equal((await findRun(repo, 'sub'))?.branch, undefined, 'the record names no branch')
    assert.equal((await git(['ls-remote', '--heads', 'origin', 'agent-sub'], repo)).trim(), '', 'and nothing was pushed')
  } finally {
    await removeRepo(repo)
  }
})

test('a marker of this machine with no checkout behind it: failed with the stderr the spawn left, else stopped as gone', async () => {
  const repo = await testRepo()
  try {
    const mark = { host: 'this-box', pid: 999_999 }
    await writeMarker(repo, markerCard({ id: 'crashed', startedAt: '2026-09-16T14:01:00.000Z', prompt: '/work-queue', driver: 'fake', model: 'opus', mark }))
    await mkdir(join(repo, '.agent-runner', 'runs'), { recursive: true })
    await writeFile(runStderrPath(repo, 'crashed'), 'node: cannot find module agent-driver\n')
    await writeMarker(repo, markerCard({ id: 'vanished', startedAt: '2026-09-16T14:02:00.000Z', prompt: '/work-queue', driver: 'fake', model: 'opus', mark }))
    await writeMarker(repo, markerCard({ id: 'theirs', startedAt: '2026-09-16T14:03:00.000Z', prompt: '/work-queue', driver: 'fake', model: 'opus', mark: { ...mark, host: 'other-box' } }))
    const result = await sweep(repo, { host: 'this-box', isAlive: () => false, now: () => NOW })
    assert.deepEqual(result.recorded.sort((a, b) => a.id.localeCompare(b.id)), [{ id: 'crashed', status: 'failed' }, { id: 'vanished', status: 'stopped' }])
    assert.match((await readUntimedDiary(repo, 'crashed'))[0]!['detail'] as string, /cannot find module agent-driver/)
    assert.equal((await findRun(repo, 'theirs'))?.status, 'running', "another machine's marker is that machine's")
  } finally {
    await removeRepo(repo)
  }
})

test('a marker whose lock a live process holds and whose checkout is not there yet is a run still booting: left alone', async () => {
  const repo = await testRepo()
  try {
    // A detached run's marker carries no pid: the lock, taken before the marker, is what says it lives.
    const mark = { host: 'this-box' }
    await writeMarker(repo, markerCard({ id: 'booting', startedAt: '2026-09-16T14:01:00.000Z', prompt: '/work-queue', driver: 'fake', model: 'opus', mark }))
    await hold(repo, 'booting', 1)
    const result = await sweep(repo, { host: 'this-box', isAlive: pid => pid === 1, now: () => NOW })
    assert.deepEqual(result.recorded, [])
    assert.equal((await findRun(repo, 'booting'))?.status, 'running')
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), '')
  } finally {
    await removeRepo(repo)
  }
})

test('a run being resumed holds its lock: its kept checkout still saying waiting is not recorded over the running record', async () => {
  const repo = await testRepo()
  try {
    // The resume has written the record running and holds the lock; its session has not reopened the live card yet.
    await liveRun(repo, 'resuming', 'this-box', 999_999, 'waiting')
    await hold(repo, 'resuming', 1)
    const mark = { host: 'this-box', pid: 1 }
    await writeMarker(repo, markerCard({ id: 'resuming', startedAt: '2026-09-16T14:01:00.000Z', prompt: '/work-queue', driver: 'fake', model: 'opus', mark }))
    const result = await sweep(repo, { host: 'this-box', isAlive: pid => pid === 1, now: () => NOW })
    assert.deepEqual(result, { recorded: [], reclaimed: [], kept: [] })
    assert.equal((await findRun(repo, 'resuming'))?.status, 'running')
  } finally {
    await removeRepo(repo)
  }
})

test('a run the sweep ends tells its parent: one that died mid-work, one that never started; one that had ended by itself is not told again', async () => {
  const repo = await testRepo()
  try {
    await liveRun(repo, 'died', 'this-box', 999_999, 'running', 'p1')
    await liveRun(repo, 'ended', 'this-box', 999_999, 'done', 'p1')
    await liveRun(repo, 'orphan', 'this-box', 999_999)
    await writeMarker(repo, markerCard({ id: 'vanished', startedAt: '2026-09-16T14:02:00.000Z', prompt: 'Do task two', driver: 'fake', mark: { host: 'this-box', pid: 999_999, parent: 'p1' } }))
    const told: unknown[] = []
    const result = await sweep(repo, { host: 'this-box', isAlive: () => false, now: () => NOW, resume: async (id, line) => void told.push({ id, line }) })
    assert.deepEqual(result.recorded.map(r => r.id).sort(), ['died', 'ended', 'orphan', 'vanished'])
    assert.deepEqual(told, [
      { id: 'p1', line: { text: 'The run died, started for this run, ended failed: its process died before the run ended.' } },
      { id: 'p1', line: { text: 'The run vanished, started for this run, ended stopped: its process is gone and left no checkout.' } },
    ])
    assert.equal(((await findRun(repo, 'died'))?.caller?.['runner'] as { parent?: string }).parent, 'p1', 'the record keeps the parent')
  } finally {
    await removeRepo(repo)
  }
})
