import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isCopyName, readHandoff, sessionCopies, workAt } from './handoff.js'

// A session's copies of repos, read off its folder in a sessions home of the test's own, with real git.

const ID = '2026-11-24T10-00-00-000Z'
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim()

test("a copy is named by one folder's own name: never a path, and none of the dot-entries", () => {
  assert.deepEqual(['site', 'my.repo', 'a b'].map(isCopyName), [true, true, true])
  assert.deepEqual(['../site', 'a/b', 'a\\b', '.openagent', '..', '', 3, undefined].map(isCopyName), [false, false, false, false, false, false, false, false])
})

test("the session's copies are the repositories in its folder, by name; a session with no folder has none", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'session-copies-')))
  const folder = join(home, ID)
  try {
    for (const name of ['site', 'api']) {
      await mkdir(join(folder, name), { recursive: true })
      git(join(folder, name), 'init', '-q', '-b', 'main')
      await writeFile(join(folder, name, 'README.md'), '# t\n')
      git(join(folder, name), 'add', '-A')
      git(join(folder, name), 'commit', '-q', '-m', 'init')
    }
    await mkdir(join(folder, 'notes'))
    await mkdir(join(folder, '.openagent'))
    assert.deepEqual(await sessionCopies(ID, home), ['api', 'site'], 'the plain folder and the live record are no copies')
    assert.deepEqual(await sessionCopies('2026-01-01T00-00-00-000Z', home), [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("a copy is read in its own folder, on the branch it is on now, from the commit it was made at, with none of what the record says of the project's branch", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'session-copies-')))
  const folder = join(home, ID)
  try {
    const site = join(folder, 'site')
    await mkdir(site, { recursive: true })
    git(site, 'init', '-q', '-b', 'main')
    await writeFile(join(site, 'README.md'), '# t\n')
    git(site, 'add', '-A')
    git(site, 'commit', '-q', '-m', 'init')
    git(site, 'checkout', '-q', '-b', 'agent-fix-footer')
    await mkdir(join(folder, 'notes'))
    const run = { record: { status: 'done', branch: 'agent-of-the-project', baseCommit: 'a'.repeat(40), landed: 'c'.repeat(40) }, changedNothing: true }
    assert.deepEqual(await workAt('/project', ID, run, 'site', { home }), { cwd: site, branch: 'agent-fix-footer', changedNothing: false, copy: true })
    // A copy that names the commit it was made at is measured from there.
    git(site, 'config', 'openagent.start', 'b'.repeat(40))
    assert.equal((await workAt('/project', ID, run, 'site', { home }))?.from, 'b'.repeat(40))
    assert.equal(await workAt('/project', ID, run, 'notes', { home }), undefined, 'a folder that is no repository')
    assert.equal(await workAt('/project', ID, run, `../${ID}/site`, { home }), undefined, 'a path is no name')
    assert.equal(await workAt('/project', ID, run, 'gone', { home }), undefined)
    // The project's own work is what the record says.
    assert.deepEqual(await workAt('/project', ID, run, undefined, { home }), { cwd: '/project', branch: 'agent-of-the-project', from: 'a'.repeat(40), landed: 'c'.repeat(40), changedNothing: true })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("a copy's files left uncommitted are read in its own folder: its row has work to say, a Commit to offer, with no commit of its own yet", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'session-copies-')))
  const site = join(home, ID, 'site')
  try {
    await mkdir(site, { recursive: true })
    git(site, 'init', '-q', '-b', 'main')
    await writeFile(join(site, 'README.md'), '# t\n')
    git(site, 'add', '-A')
    git(site, 'commit', '-q', '-m', 'init')
    git(site, 'config', 'openagent.start', git(site, 'rev-parse', 'HEAD'))
    git(site, 'checkout', '-q', '-b', `agent-${ID}`)
    const at = (await workAt('/project', ID, undefined, 'site', { home }))!
    assert.deepEqual((await readHandoff(at))?.pendingFiles, [], 'clean: nothing left')
    await writeFile(join(site, 'test2.md'), '# Test 2\n')
    const handoff = (await readHandoff(at))!
    assert.deepEqual([handoff.commits.length, handoff.pendingFiles], [0, ['test2.md']])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
