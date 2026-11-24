import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from '@openagt/agent-data'
import { openSessionFolder } from './session-folder.js'

// Where a session's copy of a repo starts, with real git: origin's default branch as origin has
// it, whatever the repo's own folder is on.

const git = nodeGitRunner()
const commit = async (dir: string, file: string, message: string): Promise<string> => {
  await writeFile(join(dir, file), `${message}\n`)
  await git(['add', '-A'], dir)
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message], dir)
  return (await git(['rev-parse', 'HEAD'], dir)).trim()
}
const headOf = async (dir: string): Promise<string> => (await git(['rev-parse', 'HEAD'], dir)).trim()
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

/** A repo whose origin has `main` at one commit, and whose own folder is on a side branch with a commit origin never got. */
async function repoAhead(): Promise<{ dir: string; repo: string; pushed: string; local: string }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'session-folder-')))
  const repo = join(dir, 'app')
  await git(['init', '-q', '--bare', '-b', 'main', join(dir, 'origin.git')], dir)
  await git(['init', '-q', '-b', 'main', repo], dir)
  const pushed = await commit(repo, 'README.md', 'first')
  await git(['remote', 'add', 'origin', join(dir, 'origin.git')], repo)
  await git(['push', '-q', 'origin', 'main'], repo)
  await git(['checkout', '-q', '-b', 'my-side-work'], repo)
  const local = await commit(repo, 'mine.md', 'not pushed')
  return { dir, repo, pushed, local }
}

test("a copy starts from origin's default branch as origin has it: not from the branch the folder is on, and with none of its commits that were never pushed", async () => {
  const at = await repoAhead()
  try {
    const { path, made } = await openSessionFolder(join(at.dir, 'home'), 'run1', [{ name: 'app', from: at.repo }], git)
    const copy = join(path, 'app')
    assert.deepEqual(made, [{ name: 'app', from: at.repo }])
    assert.equal((await git(['branch', '--show-current'], copy)).trim(), 'agent-run1')
    assert.equal(await headOf(copy), at.pushed, "origin's main, not the folder's side branch")
    assert.equal(await exists(join(copy, 'mine.md')), false, 'the commit never pushed is not in the copy')
    assert.equal((await git(['rev-list', '--count', 'origin/main..HEAD'], copy)).trim(), '0', 'a pull request of it would carry nothing yet')
    assert.equal((await git(['config', '--get', 'openagent.start'], copy)).trim(), at.pushed, 'where it started is kept in the copy')
    assert.equal(await headOf(at.repo), at.local, "the folder is left as it was")
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})

test('a repo with no origin, or whose origin does not answer, is copied as its folder is committed', async () => {
  const at = await repoAhead()
  try {
    await git(['remote', 'set-url', 'origin', join(at.dir, 'gone.git')], at.repo)
    const unreachable = await openSessionFolder(join(at.dir, 'home'), 'run2', [{ name: 'app', from: at.repo }], git)
    assert.equal(await headOf(join(unreachable.path, 'app')), at.local)
    await git(['remote', 'remove', 'origin'], at.repo)
    const none = await openSessionFolder(join(at.dir, 'home'), 'run3', [{ name: 'app', from: at.repo }], git)
    assert.equal(await headOf(join(none.path, 'app')), at.local)
    assert.equal((await git(['remote'], join(none.path, 'app'))).trim(), '', 'and has no origin')
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})
