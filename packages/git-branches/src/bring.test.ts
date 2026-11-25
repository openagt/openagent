import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from './git.js'
import { bringBranch } from './bring.js'
import { readBranchStates } from './branch-state.js'
import { openSessionFolder } from './session-folder.js'
import { runCli } from './cli.js'

// A session's copy of a repo with no remote, its work brought back to the folder it was copied from. Real git.

const git = nodeGitRunner()
const commit = async (dir: string, file: string, message: string): Promise<string> => {
  await writeFile(join(dir, file), `${message}\n`)
  await git(['add', '-A'], dir)
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message], dir)
  return (await git(['rev-parse', 'HEAD'], dir)).trim()
}
const tip = async (dir: string, ref: string): Promise<string> => (await git(['rev-parse', '--verify', '--quiet', ref], dir).catch(() => '')).trim()
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)
const BRANCH = 'agent-run1'

/** A folder with no remote on main, and a session's copy of it where the agent committed once. */
async function copied(): Promise<{ dir: string; folder: string; copy: string; work: string }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'branches-bring-')))
  const folder = join(dir, 'app')
  await git(['init', '-q', '-b', 'main', folder], dir)
  await commit(folder, 'README.md', 'first')
  const { path } = await openSessionFolder(join(dir, 'home'), 'run1', [{ name: 'app', from: folder }], git)
  const copy = join(path, 'app')
  const work = await commit(copy, 'work.md', 'the agent')
  return { dir, folder, copy, work }
}

test("the copy's branch is added to the folder, and nothing else there changes; a second bring moves it forward", async () => {
  const at = await copied()
  try {
    await commit(at.folder, 'mine.md', 'mine, meanwhile')
    await writeFile(join(at.folder, 'README.md'), 'not committed\n')
    const before = await tip(at.folder, 'HEAD')
    assert.deepEqual(await bringBranch(at.copy, BRANCH, {}, git), { ok: true, branch: BRANCH, folder: at.folder })
    assert.equal(await tip(at.folder, `refs/heads/${BRANCH}`), at.work)
    assert.equal((await git(['branch', '--show-current'], at.folder)).trim(), 'main', 'the folder stays on its branch')
    assert.equal(await tip(at.folder, 'HEAD'), before)
    assert.equal(await readFile(join(at.folder, 'README.md'), 'utf8'), 'not committed\n', 'and its files as they were')
    assert.equal(await exists(join(at.folder, 'work.md')), false)
    const more = await commit(at.copy, 'more.md', 'more work')
    assert.equal((await bringBranch(at.copy, BRANCH, {}, git)).ok, true)
    assert.equal(await tip(at.folder, `refs/heads/${BRANCH}`), more)
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})

test("the folder's branch of that name only moves forward, and one the folder is on is left to the person", async () => {
  const at = await copied()
  try {
    await bringBranch(at.copy, BRANCH, {}, git)
    await git(['checkout', '-q', BRANCH], at.folder)
    assert.deepEqual(await bringBranch(at.copy, BRANCH, {}, git), { ok: false, reason: 'checked-out', branch: BRANCH, folder: at.folder })
    const mine = await commit(at.folder, 'mine.md', 'mine, on the agent branch')
    await git(['checkout', '-q', 'main'], at.folder)
    await commit(at.copy, 'more.md', 'more work')
    assert.deepEqual(await bringBranch(at.copy, BRANCH, {}, git), { ok: false, reason: 'diverged', branch: BRANCH, folder: at.folder })
    assert.equal(await tip(at.folder, `refs/heads/${BRANCH}`), mine, 'its commit is kept')
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})

test("merged into the folder's default branch: the branch goes from the folder, and the copy reads its work as merged", async () => {
  const at = await copied()
  try {
    const start = await tip(at.folder, 'HEAD')
    const out = await bringBranch(at.copy, BRANCH, { merge: true }, git)
    assert.deepEqual(out, { ok: true, branch: BRANCH, folder: at.folder, merged: { ok: true, branch: BRANCH, into: 'main', commit: at.work, from: start, deleted: true } })
    assert.equal(await readFile(join(at.folder, 'work.md'), 'utf8'), 'the agent\n', "the work is in the folder's main")
    assert.equal(await tip(at.folder, `refs/heads/${BRANCH}`), '', 'its branch went with that')
    assert.equal(await tip(at.copy, 'refs/heads/main'), await tip(at.folder, 'refs/heads/main'), "the copy's main is the folder's")
    const [state] = await readBranchStates(at.copy, [BRANCH], git, start)
    assert.equal(state?.merged, true)
    assert.deepEqual(state?.copiedFrom, { path: at.folder, hasBranch: false })
    assert.equal(state?.commits.length, 1, 'measured from where the copy started, its work is still counted')
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})

test('a merge the folder refuses changes nothing but the added branch; a repository that is no copy is refused', async () => {
  const at = await copied()
  try {
    await git(['checkout', '-q', '-b', 'try-header'], at.folder)
    assert.deepEqual(await bringBranch(at.copy, BRANCH, { merge: true }, git), { ok: false, reason: 'not-on-default', branch: BRANCH, into: 'main', current: 'try-header', folder: at.folder })
    assert.equal(await tip(at.folder, `refs/heads/${BRANCH}`), at.work)
    assert.equal(await exists(join(at.folder, 'work.md')), false)
    assert.deepEqual(await bringBranch(at.folder, 'main', {}, git), { ok: false, reason: 'not-a-copy', branch: 'main' })
    assert.deepEqual(await bringBranch(at.copy, 'agent-gone', {}, git), { ok: false, reason: 'no-branch', branch: 'agent-gone' })
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})

test('the command line: bring --merge from inside the copy, and a refusal as one line on stderr', async () => {
  const at = await copied()
  try {
    const out: string[] = []
    const err: string[] = []
    const io = { cwd: at.copy, stdout: (line: string) => out.push(line), stderr: (line: string) => err.push(line) }
    await git(['checkout', '-q', '-b', 'try-header'], at.folder)
    assert.equal(await runCli(['bring', BRANCH, '--merge'], io, git), 1)
    assert.match(err.join('\n'), /is on try-header, not on main; switch it to main, then merge/)
    await git(['checkout', '-q', 'main'], at.folder)
    assert.equal(await runCli(['bring', BRANCH, '--merge'], io, git), 0)
    assert.equal(JSON.parse(out.at(-1)!).merged.into, 'main')
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})
