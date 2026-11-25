import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DATA_BRANCH, nodeGitRunner } from '@openagt/git-branches'
import { projectId } from '@openagt/projects'
import { writeSharing } from '@openagt/store-filesystem'
import { SCHEDULED_COMMANDS } from '@openagt/hooks'
import { memorySettings, rpcHost } from '@openagt/hooks/testing'
import { QUEUE_FILE } from './names.js'
import { entries, taker } from './server.js'

const git = nodeGitRunner()

test("who takes from the queue is the scheduler's switch and pace for work-queue on this computer, in this project alone", async () => {
  const settings = memorySettings()
  const host = rpcHost({ root: '/work/shop', settings })
  assert.deepEqual(await taker(host, {}), { on: false }, 'nothing switched on')
  const on = '2026-10-03T08:00:00.000Z'
  await settings.set(SCHEDULED_COMMANDS, { [projectId('/work/shop')]: { 'work-queue': { on, pace: { every: '6h', since: on } }, triage: { on } }, [projectId('/work/other')]: { 'work-queue': { on } } })
  assert.deepEqual(await taker(host, {}), { on: true, pace: { every: '6h', since: on } })
  // A pace set while it is off: still off.
  await settings.set(SCHEDULED_COMMANDS, { [projectId('/work/shop')]: { 'work-queue': { pace: { work: true } } } })
  assert.deepEqual(await taker(host, {}), { on: false, pace: { work: true } })
})

test("the entries are the queue's open lines in file order, each with its section's priority, read as the command reads them; a project with no queue has none", async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'queue-server-')))
  try {
    await git(['init', '-q', '-b', 'main'], repo)
    await git(['config', 'user.email', 's@s'], repo)
    await git(['config', 'user.name', 's'], repo)
    await git(['commit', '-q', '--allow-empty', '-m', 'init'], repo)
    // Its records shared on its agent-data branch, the person's yes given once.
    await writeSharing(repo, true)
    const host = rpcHost({ root: repo, settings: memorySettings() })
    assert.deepEqual(await entries(host, {}), [], 'no agent-data branch: no queue')
    const commit = (await git(['commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', 'create the agent-data branch'], repo)).trim()
    await git(['checkout', '-q', '-B', DATA_BRANCH, commit], repo)
    await writeFile(join(repo, QUEUE_FILE), '- On top\n\n## Priority 8\n\n- [Do A](tickets/2026-08-30_a.md)\n- [x] done already\n\n## Later\n\n- someday\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-q', '-m', 'seed'], repo)
    await git(['checkout', '-q', 'main'], repo)
    const placed = [{ entry: 'On top' }, { entry: '[Do A](tickets/2026-08-30_a.md)', priority: 8 }, { entry: 'someday' }]
    assert.deepEqual(await entries(host, {}), placed, "this machine's copy")
    assert.deepEqual(await entries(host, { fresh: true }), placed, 'with no origin, the same copy')
  } finally {
    await rm(repo, { recursive: true, force: true, maxRetries: 10 })
  }
})
