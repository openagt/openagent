import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentMeta } from '../store/index.js'
import { isSessionCopy } from '../store/branches.js'
import { copyTarget, isCopyName, sessionCopies } from './session-copies.js'

// A session's copies of repos, read off its folder in a sessions home of the test's own, with real git.

const ID = '2026-11-24T10-00-00-000Z'
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim()

/** A sessions home with one session's folder: two copies, each on a branch of its own with a commit, a plain folder, and the run's live record. */
async function home(): Promise<{ home: string; folder: string }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'session-copies-')))
  const folder = join(dir, ID)
  for (const name of ['site', 'api']) {
    await mkdir(join(folder, name), { recursive: true })
    git(join(folder, name), 'init', '-q', '-b', 'main')
    await writeFile(join(folder, name, 'README.md'), '# t\n')
    git(join(folder, name), 'add', '-A')
    git(join(folder, name), 'commit', '-q', '-m', 'init')
    git(join(folder, name), 'checkout', '-q', '-b', `agent-${ID}`)
  }
  await mkdir(join(folder, 'notes'))
  await mkdir(join(folder, '.openagent'))
  return { home: dir, folder }
}

const agent: AgentMeta = { id: ID, startedAt: '2026-11-24T10:00:00.000Z', status: 'done', branch: 'agent-of-the-project', baseCommit: 'a'.repeat(40), prBase: 'release', pr: { number: 9, url: 'https://x/pull/9' } } as AgentMeta

test('a copy is named by one folder\'s own name: never a path, and none of the dot-entries', () => {
  assert.deepEqual(['site', 'my.repo', 'a b'].map(isCopyName), [true, true, true])
  assert.deepEqual(['../site', 'a/b', 'a\\b', '.openagent', '..', '', 3, undefined].map(isCopyName), [false, false, false, false, false, false, false, false])
})

test("the session's copies are the repositories in its folder, by name; a session with no folder has none", async () => {
  const at = await home()
  try {
    assert.deepEqual(await sessionCopies(ID, at.home), ['api', 'site'], 'the plain folder and the live record are no copies')
    assert.deepEqual(await sessionCopies('2026-01-01T00-00-00-000Z', at.home), [])
  } finally {
    await rm(at.home, { recursive: true, force: true })
  }
})

test("a copy is acted on in its own folder, on the branch it is on now, with none of what the record says of the project's branch", async () => {
  const at = await home()
  try {
    git(join(at.folder, 'site'), 'branch', '-m', 'agent-fix-footer')
    const target = await copyTarget(agent, 'site', { home: at.home })
    assert.equal(target?.cwd, join(at.folder, 'site'))
    assert.deepEqual(target?.agent, { id: ID, startedAt: agent.startedAt, status: 'done', branch: 'agent-fix-footer' })
    // A copy that names the commit it was made at is measured from there.
    git(join(at.folder, 'site'), 'config', 'openagent.start', 'b'.repeat(40))
    assert.equal((await copyTarget(agent, 'site', { home: at.home }))?.agent.baseCommit, 'b'.repeat(40))
    assert.equal(await copyTarget(agent, 'notes', { home: at.home }), undefined, 'a folder that is no repository')
    assert.equal(await copyTarget(agent, '../' + ID + '/site', { home: at.home }), undefined, 'a path is no name')
    assert.equal(await copyTarget(agent, 'gone', { home: at.home }), undefined)
  } finally {
    await rm(at.home, { recursive: true, force: true })
  }
})

test('the branches reader takes a copy for a repository, and the sessions home, a session\'s folder and a plain folder in it for what they are', async () => {
  const at = await home()
  try {
    assert.equal(await isSessionCopy(join(at.folder, 'site'), at.home), true)
    assert.deepEqual(await Promise.all([at.home, at.folder, join(at.folder, 'notes'), join(at.folder, 'site', 'src'), join(at.folder, 'gone')].map(root => isSessionCopy(root, at.home))), [false, false, false, false, false])
  } finally {
    await rm(at.home, { recursive: true, force: true })
  }
})
