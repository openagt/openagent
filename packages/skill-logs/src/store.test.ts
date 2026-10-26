import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner, fileBranchPath, withFileBranch, writeSharing, DATA_BRANCH } from '@openagt/agent-data'
import { deleteRun, findRun, listRuns, patchRun, readDiary, runFiles, writeRun } from './store.js'
import { RUNS_DIR } from './names.js'

const git = nodeGitRunner()
const RETRIED_RM = { recursive: true, force: true, maxRetries: 10 } as const

/** A repo committing as `email`, with a bare origin it shares the records with. */
async function repo(email = 'Dev@Example.com'): Promise<{ root: string; bare: string; cleanup: () => Promise<void> }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'logs-store-')))
  const bare = await realpath(await mkdtemp(join(tmpdir(), 'logs-store-bare-')))
  await git(['init', '--bare', '-b', 'main', bare], bare)
  await git(['init', '-b', 'main'], root)
  await git(['config', 'user.email', email], root)
  await git(['config', 'user.name', 't'], root)
  await git(['config', 'commit.gpgsign', 'false'], root)
  await writeFile(join(root, 'README.md'), '# t\n')
  await git(['add', '-A'], root)
  await git(['commit', '-m', 'init'], root)
  await git(['remote', 'add', 'origin', bare], root)
  await git(['push', 'origin', 'main'], root)
  await writeSharing(root, true)
  return { root, bare, cleanup: async () => { for (const dir of [root, bare]) await rm(dir, RETRIED_RM) } }
}

const card = (id: string, over: Record<string, unknown> = {}) => ({ id, startedAt: id.replace(/-(\d\d)-(\d\d)-(\d\d\d)Z$/, ':$1:$2.$3Z'), status: 'done' as const, ...over })
const R1 = '2026-07-04T00-00-00-000Z'
const R2 = '2026-07-05T00-00-00-000Z'
const R3 = '2026-07-06T00-00-00-000Z'

test('a run is recorded under the person the repo commits as, one pushed commit; listed newest first; found, read, patched and deleted', async () => {
  const { root, bare, cleanup } = await repo()
  try {
    const wrote = await writeRun(root, card(R2, { intent: 'second', caller: { pid: 1 } }), [{ kind: 'said', text: 'hi' }, { kind: 'ended', status: 'done' }])
    assert.deepEqual(wrote, { ok: true, changed: true, pushed: true })
    assert.deepEqual(await writeRun(root, card(R1, { intent: 'first' }), []), { ok: true, changed: true, pushed: true })
    const person = join(await fileBranchPath(root, DATA_BRANCH), RUNS_DIR, 'dev@example.com')
    assert.deepEqual(JSON.parse(await readFile(join(person, `${R2}.json`), 'utf8')), { ...card(R2), intent: 'second', caller: { pid: 1 } })
    assert.equal(await readFile(join(person, `${R2}.jsonl`), 'utf8'), '{"kind":"said","text":"hi"}\n{"kind":"ended","status":"done"}\n')
    assert.equal((await git(['log', '-1', '--format=%s', DATA_BRANCH], bare)).trim(), `logs: record run ${R1}`)
    assert.equal((await git(['status', '--porcelain'], person)).trim(), '', 'committed, not merely written')

    assert.deepEqual((await listRuns(root)).map(c => [c.id, c.person]), [[R2, 'dev@example.com'], [R1, 'dev@example.com']], 'newest first, each with the person it is kept under')
    assert.deepEqual((await listRuns(root, { since: Date.parse('2026-07-04T12:00:00.000Z') })).map(c => c.id), [R2], 'since keeps the runs started at or after it')
    assert.deepEqual(await findRun(root, R1), { ...card(R1), intent: 'first' })
    assert.equal(await findRun(root, 'nope'), undefined)
    assert.equal(await findRun(root, '../escape'), undefined)
    assert.deepEqual(await readDiary(root, R2), [{ kind: 'said', text: 'hi' }, { kind: 'ended', status: 'done' }])
    assert.deepEqual(await readDiary(root, R1), [])
    assert.equal(await readDiary(root, 'nope'), undefined)
    assert.deepEqual(await runFiles(root, R1), { card: join(person, `${R1}.json`), diary: join(person, `${R1}.jsonl`) })

    assert.equal(await patchRun(root, R1, { branch: 'claude/fix', pr: { number: 7, url: 'https://x/pull/7' } }), true)
    assert.equal((await git(['log', '-1', '--format=%s', DATA_BRANCH], bare)).trim(), `logs: patch run ${R1}`)
    assert.deepEqual((await findRun(root, R1))?.pr, { number: 7, url: 'https://x/pull/7' })
    // The sync the daemon runs a minute later keeps it: the patch was committed, not left dirty.
    await withFileBranch(root, DATA_BRANCH, 'sync', async () => {})
    assert.equal((await findRun(root, R1))?.branch, 'claude/fix')
    assert.equal(await patchRun(root, 'nope', { branch: 'x' }), false, 'no such run: nothing patched')

    // A file another package keeps beside the run, named after its id, goes with it.
    await withFileBranch(root, DATA_BRANCH, 'a plan beside the run', async checkout => writeFile(join(checkout, RUNS_DIR, 'dev@example.com', `${R1}.plan.md`), '# Plan\n'))
    assert.deepEqual(await deleteRun(root, R1), { ok: true, changed: true, pushed: true })
    assert.equal(await git(['show', `${DATA_BRANCH}:${RUNS_DIR}/dev@example.com/${R1}.plan.md`], bare).then(() => true, () => false), false, 'the file beside it went too')
    assert.equal(await git(['show', `${DATA_BRANCH}:${RUNS_DIR}/dev@example.com/${R2}.json`], bare).then(() => true, () => false), true, 'another run stays')
    assert.equal((await git(['log', '-1', '--format=%s', DATA_BRANCH], bare)).trim(), `logs: delete run ${R1}`)
    assert.deepEqual((await listRuns(root)).map(c => c.id), [R2])
    assert.equal(await git(['show', `${DATA_BRANCH}:${RUNS_DIR}/dev@example.com/${R1}.jsonl`], bare).then(() => true, () => false), false, 'the diary went with it')
    assert.deepEqual(await deleteRun(root, R1), { ok: true, changed: false, pushed: false }, 'gone already: a landed no-op')
  } finally {
    await cleanup()
  }
})

test('a run recorded again stays where it sits, even under another person; a card that does not parse is skipped', async () => {
  const { root, cleanup } = await repo('me@example.com')
  try {
    // Another machine's run, filed under its person on the branch.
    await withFileBranch(root, DATA_BRANCH, 'seed', async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, RUNS_DIR, 'them@example.com'), { recursive: true })
      await writeFile(join(dir, RUNS_DIR, 'them@example.com', `${R3}.json`), JSON.stringify(card(R3, { status: 'running' })))
      await writeFile(join(dir, RUNS_DIR, 'them@example.com', `${R3}.jsonl`), '')
      await writeFile(join(dir, RUNS_DIR, 'them@example.com', 'broken.json'), '{not json')
    })
    assert.deepEqual((await listRuns(root)).map(c => [c.id, c.status]), [[R3, 'running']])
    // This machine ends it: the card stays under them, not under me.
    assert.equal((await writeRun(root, card(R3, { status: 'stopped', endedAt: 'later' }), [{ kind: 'ended', status: 'stopped' }])).ok, true)
    const files = await runFiles(root, R3)
    assert.ok(files?.card.includes('/them@example.com/'))
    assert.equal((await findRun(root, R3))?.status, 'stopped')
    assert.deepEqual(await readDiary(root, R3), [{ kind: 'ended', status: 'stopped' }])
    assert.equal((await writeRun(root, { ...card('../escape'), id: '../escape' }, [])).ok, false, 'not an id: nothing written')
  } finally {
    await cleanup()
  }
})

test('a repo with no remote records locally and says the push did not happen', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'logs-store-solo-')))
  try {
    await git(['init', '-b', 'main'], root)
    await git(['config', 'user.email', 's@s'], root)
    await git(['config', 'user.name', 's'], root)
    await writeFile(join(root, 'README.md'), '# t\n')
    await git(['add', '-A'], root)
    await git(['commit', '-m', 'init'], root)
    assert.deepEqual(await writeRun(root, card(R1), []), { ok: true, changed: true, pushed: false })
    assert.deepEqual((await listRuns(root)).map(c => c.id), [R1])
    assert.deepEqual(await listRuns('/nowhere'), [], 'no checkout, no runs')
  } finally {
    await rm(root, RETRIED_RM)
  }
})
