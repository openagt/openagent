import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from './git.js'
import { addSessionRepos, checkedRepos, copiedFrom, dropUntouchedCopies, foundCopies, openSessionFolder, sessionRepos } from './session-folder.js'
import { readBranchStates } from './branch-state.js'

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

test("a copy picked to start from one of origin's branches starts there; a branch origin has not refuses the run, saying which", async () => {
  const at = await repoAhead()
  try {
    // origin has a branch dev, one commit past main.
    await git(['checkout', '-q', '-b', 'dev', 'main'], at.repo)
    const dev = await commit(at.repo, 'dev.md', 'dev work')
    await git(['push', '-q', 'origin', 'dev'], at.repo)
    const { path } = await openSessionFolder(join(at.dir, 'home'), 'run7', [{ name: 'app', from: at.repo, base: 'dev' }], git)
    const copy = join(path, 'app')
    assert.equal(await headOf(copy), dev, "origin's dev")
    assert.equal((await git(['branch', '--show-current'], copy)).trim(), 'agent-run7')
    await assert.rejects(openSessionFolder(join(at.dir, 'home'), 'run8', [{ name: 'app', from: at.repo, base: 'gone' }], git), /origin has no branch gone/)
    await assert.rejects(checkedRepos([{ name: 'app', from: at.repo, base: '--upload-pack=x' }], git), /not a branch name/)
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

test("a copy names the folder it was copied from; with no remote, its branch's state says that folder and whether the folder has the branch", async () => {
  const at = await repoAhead()
  try {
    await git(['remote', 'remove', 'origin'], at.repo)
    const { path } = await openSessionFolder(join(at.dir, 'home'), 'run1', [{ name: 'app', from: at.repo }], git)
    const copy = join(path, 'app')
    assert.equal(await copiedFrom(copy, git), at.repo)
    assert.equal(await copiedFrom(at.repo, git), undefined, 'a folder that is no copy names none')
    await commit(copy, 'work.md', 'the agent')
    const [state] = await readBranchStates(copy, ['agent-run1'], git)
    assert.deepEqual(state?.copiedFrom, { path: at.repo, hasBranch: false })
    await git(['fetch', '-q', copy, 'agent-run1:agent-run1'], at.repo)
    const [brought] = await readBranchStates(copy, ['agent-run1'], git)
    assert.deepEqual(brought?.copiedFrom, { path: at.repo, hasBranch: true })
    const [gone] = await readBranchStates(copy, ['agent-gone'], git)
    assert.equal(gone?.copiedFrom, undefined, 'a branch that is gone has nothing to bring')
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})

test("a copy with a remote goes back by a pull request: its branch's state names no folder", async () => {
  const at = await repoAhead()
  try {
    const { path } = await openSessionFolder(join(at.dir, 'home'), 'run1', [{ name: 'app', from: at.repo }], git)
    const [state] = await readBranchStates(join(path, 'app'), ['agent-run1'], git)
    assert.equal(state?.hasRemote, true)
    assert.equal(state?.copiedFrom, undefined)
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})

test('a session already going is given more repos: each a copy beside the ones it has, and a name of its own', async () => {
  const at = await repoAhead()
  const twin = await repoAhead()
  try {
    const home = join(at.dir, 'home')
    const first = await addSessionRepos(home, 'run4', [], [at.repo], git)
    assert.deepEqual(first.made, [{ name: 'app', from: at.repo }])
    // Another folder named app, given later: a name of its own; the one it has adds nothing.
    const more = await addSessionRepos(home, 'run4', first.repos, [at.repo, twin.repo], git)
    assert.deepEqual(more.made, [{ name: 'app-2', from: twin.repo }])
    assert.deepEqual(more.repos, [{ name: 'app', from: at.repo }, { name: 'app-2', from: twin.repo }])
    const copy = join(home, 'run4', 'app-2')
    assert.equal(await headOf(copy), twin.pushed, "made as at a session's start: from origin's main")
    const again = await addSessionRepos(home, 'run4', more.repos, [twin.repo], git)
    assert.deepEqual(again.made, [])
    // A folder of the session's that is no repo of it keeps its name: the new copy takes another.
    await git(['clone', '-q', at.repo, join(home, 'run5', 'app')], at.dir)
    const beside = await addSessionRepos(home, 'run5', [], [at.repo], git)
    assert.deepEqual(beside.made, [{ name: 'app-2', from: at.repo }])
  } finally {
    await rm(at.dir, { recursive: true, force: true })
    await rm(twin.dir, { recursive: true, force: true })
  }
})

test("the copies made while a run went on are found by the folder they name; one the agent cloned itself is not the session's", async () => {
  const at = await repoAhead()
  try {
    const home = join(at.dir, 'home')
    // A folder on a branch with commits never pushed gives its copy that branch too, which is work the clean-up keeps: on main here.
    await git(['checkout', '-q', 'main'], at.repo)
    const { repos } = await addSessionRepos(home, 'run6', [], [at.repo], git)
    await git(['clone', '-q', at.repo, join(home, 'run6', 'cloned')], at.dir)
    assert.deepEqual(await foundCopies(home, 'run6', [], git), repos)
    assert.deepEqual(await foundCopies(home, 'run6', repos, git), [], 'the ones it has are not found again')
    assert.deepEqual(await foundCopies(home, 'none', [], git), [], 'a session with no folder has none')
    // Its end drops every untouched copy its folder holds, the one added on the way too; a clone that names no start stays.
    assert.deepEqual(await dropUntouchedCopies(home, 'run6', git), ['app'])
    assert.equal(await exists(join(home, 'run6', 'cloned')), true)
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})

test("a repo is named by its top folder as it was given, the way the dashboard lists it; given by two ways to it, it counts once", async () => {
  const at = await repoAhead()
  try {
    // Another way to the same folder, as ~/projects is to ~/Projects on a disk that ignores case.
    const other = join(at.dir, 'other-way')
    await symlink(at.dir, other)
    const given = join(other, 'app')
    assert.deepEqual(await sessionRepos([given, at.repo], git), [{ name: 'app', from: given }])
    // A folder inside the repo is named by the repo's top, as git says it.
    await git(['checkout', '-q', 'main'], at.repo)
    const inside = join(at.repo, 'docs')
    await import('node:fs/promises').then(fs => fs.mkdir(inside))
    assert.deepEqual(await sessionRepos([inside], git), [{ name: 'app', from: at.repo }])
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})
