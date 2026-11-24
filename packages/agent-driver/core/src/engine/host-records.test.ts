import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionFolder, sessionsHome } from '@openagt/agent-data'
import type { ProjectRef } from '@openagt/hooks'
import { worktreePath } from '@openagt/git-branches'
import { findRun, runFiles, writeRun } from '../record-store.js'
import type { RunCard } from '../record.js'
import { logCardFile } from '../session-log.js'
import { localHost } from './host.js'
import { liveDir } from './live-card.js'
import { git, removeRepo, testRepo } from './test-repo.js'

// This computer's host deleting a run, its checkout and its record, and writing on a run's record
// what a module found out once the run's process was gone. Against real git: "was the work
// actually gone, and the branch kept" is not a question a fake answers.

const here = localHost({ host: 'this-box' })
const projectAt = (dir: string): ProjectRef => ({ id: 'shop', name: 'shop', dir })

/** Record a run the way a run's process does: the two files that put its row in a list. */
async function recordRun(repo: string, id: string, status: RunCard['status'] = 'stopped'): Promise<{ card: string; diary: string }> {
  const written = await writeRun(repo, { id, startedAt: '2026-01-01T00:00:00.000Z', status }, [{ kind: 'ended', status: 'stopped' }])
  assert.ok(written.ok || written.committed, 'the record landed')
  return (await runFiles(repo, id))!
}

test('deleting a run whose checkout is already gone still takes its record, and a second delete is fine (#1032)', async () => {
  const repo = await testRepo()
  try {
    const { card } = await recordRun(repo, 'run-x')
    await here.delete!({ id: 'run-x', project: projectAt(repo) })
    await assert.rejects(() => stat(card), 'the record is gone')
    await here.delete!({ id: 'run-x', project: projectAt(repo) })
  } finally {
    await removeRepo(repo)
  }
})

test('deleting a run whose checkout holds uncommitted work drops the work with the checkout and keeps the branch, unpushed (#1032/#1774)', async () => {
  const repo = await testRepo()
  const id = 'run1'
  try {
    const checkout = worktreePath(repo, id)
    await git(['worktree', 'add', '-q', '-b', 'agent-run1', checkout, 'main'], repo)
    await writeFile(join(checkout, 'index.html'), '<h1>Welcome!</h1>\n')
    await recordRun(repo, id)
    await here.delete!({ id, project: projectAt(repo) })
    await assert.rejects(() => stat(checkout), 'the checkout is gone, uncommitted edit and all')
    assert.equal(await findRun(repo, id), undefined)
    assert.equal((await git(['rev-parse', '--verify', 'refs/heads/agent-run1'], repo)).trim().length, 40, "the branch stays: it is git's")
    assert.equal((await git(['ls-remote', '--heads', 'origin', 'agent-run1'], repo)).trim(), '', 'the branch was not pushed on the way out')
  } finally {
    await removeRepo(repo)
  }
})

test('a run still working is not deleted, nor a name that is no run id', async () => {
  const repo = await testRepo()
  const id = 'run-live'
  try {
    const dir = liveDir(worktreePath(repo, id))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, logCardFile(id)), JSON.stringify({ id, startedAt: '2026-01-01T00:00:00.000Z', status: 'running', caller: { pid: 4242, host: 'this-box' } }))
    await assert.rejects(() => here.delete!({ id, project: projectAt(repo) }), /still going; stop it before deleting it/)
    await assert.rejects(() => here.delete!({ id: '../etc/passwd', project: projectAt(repo) }), /invalid session id/)
  } finally {
    await removeRepo(repo)
  }
})

test("deleting a session with no project takes its folder in the sessions home", async () => {
  const config = await realpath(await mkdtemp(join(tmpdir(), 'agent-runner-sessions-')))
  const before = process.env['XDG_CONFIG_HOME']
  process.env['XDG_CONFIG_HOME'] = config
  try {
    const id = 'run-alone'
    const folder = sessionFolder(sessionsHome(), id)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'notes.md'), 'work\n')
    await here.delete!({ id })
    await assert.rejects(() => stat(folder), 'the folder is gone')
  } finally {
    if (before === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = before
    await rm(config, { recursive: true, force: true })
  }
})

test("a run's record takes the pull request a press opened, and the work a press landed; facts it keeps none of are refused", async () => {
  const repo = await testRepo()
  try {
    await recordRun(repo, 'run-pr', 'done')
    await here.record!({ id: 'run-pr', project: projectAt(repo) }, { github: { pr: { number: 7, url: 'https://github.com/o/r/pull/7' } } })
    assert.deepEqual((await findRun(repo, 'run-pr'))?.pr, { number: 7, url: 'https://github.com/o/r/pull/7' })
    await here.record!({ id: 'run-pr', project: projectAt(repo) }, { 'git-branches': { landed: 'abc123', baseCommit: 'def456' } })
    const landed = await findRun(repo, 'run-pr')
    assert.equal(landed?.caller?.['landed'], 'abc123')
    assert.equal(landed?.caller?.['baseCommit'], 'def456')
    await assert.rejects(() => here.record!({ id: 'run-pr', project: projectAt(repo) }, { 'git-branches': { branch: 'agent-x' } }), /Nothing of this is kept/)
    await assert.rejects(() => here.record!({ id: 'run-none', project: projectAt(repo) }, { github: { pr: { number: 8, url: 'https://github.com/o/r/pull/8' } } }), /not updated/)
  } finally {
    await removeRepo(repo)
  }
})
