import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup } from './cleanup.js'
import type { AppContext } from '@openagt/hooks'
import agentDriver from './module.js'
import { acquireRunLock, releaseRunLock, runStderrPath } from './run-lock.js'
import { git, removeRepo, testRepo } from './test-repo.js'

// The clean-up of a project removed with its files (`app.lifecycle`'s `projectRemoved`), on a real repository with a real remote: the tool's own files go, and nothing else
// in the project or on the remote changes.

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)
const excludeOf = (repo: string): Promise<string> => readFile(join(repo, '.git', 'info', 'exclude'), 'utf8').catch(() => '')

/** What a clean-up must leave as it found it: the remote's branches, every local branch, the working tree. */
async function outside(repo: string): Promise<string> {
  return [await git(['ls-remote', 'origin'], repo), await git(['for-each-ref', 'refs/heads'], repo), await git(['status', '--porcelain'], repo)].join('---\n')
}

/** A run that came and went: its lock taken and let go, its stderr file left. */
async function ranOnce(repo: string, id: string): Promise<void> {
  await acquireRunLock(repo, id, { pid: 10, isAlive: () => true })
  await writeFile(runStderrPath(repo, id), 'a warning\n')
  await releaseRunLock(repo, id, 10)
}

test('the runs\' files, the directory and the rule hiding it go; the project and the remote stay as they were', async () => {
  const repo = await testRepo()
  try {
    const before = await outside(repo)
    await ranOnce(repo, 'r1')
    assert.match(await excludeOf(repo), /^\/\.agent-runner$/m)

    assert.deepEqual(await cleanup(repo), { ok: true, removed: ['.agent-runner/runs', '.agent-runner'], kept: [] })
    assert.equal(await exists(join(repo, '.agent-runner')), false)
    assert.doesNotMatch(await excludeOf(repo), /agent-runner/)
    assert.equal(await outside(repo), before)

    assert.deepEqual(await cleanup(repo), { ok: true, removed: [], kept: [] }, 'a second pass finds nothing')
  } finally {
    await removeRepo(repo)
  }
})

test('the settings file is the person\'s and stays, with the directory and the rule hiding it; a stranger\'s file stays too', async () => {
  const repo = await testRepo()
  try {
    await ranOnce(repo, 'r1')
    await writeFile(join(repo, '.agent-runner', 'config.yml'), 'personal:\n  memory: off\n')
    await writeFile(join(repo, '.agent-runner', 'notes.txt'), 'mine\n')

    assert.deepEqual(await cleanup(repo), {
      ok: true,
      removed: ['.agent-runner/runs'],
      kept: [
        { path: '.agent-runner/config.yml', reason: 'your settings for agent-runner' },
        { path: '.agent-runner/notes.txt', reason: 'not made by agent-runner' },
      ],
    })
    assert.deepEqual((await readdir(join(repo, '.agent-runner'))).sort(), ['config.yml', 'notes.txt'])
    assert.equal(await readFile(join(repo, '.agent-runner', 'config.yml'), 'utf8'), 'personal:\n  memory: off\n')
    assert.match(await excludeOf(repo), /^\/\.agent-runner$/m, 'what stays is still hidden from git')
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), '')
  } finally {
    await removeRepo(repo)
  }
})

test('while a run\'s process is alive nothing is removed', async () => {
  const repo = await testRepo()
  try {
    await ranOnce(repo, 'r1')
    await acquireRunLock(repo, 'r2', { pid: 11, isAlive: () => true })
    assert.deepEqual(await cleanup(repo, { isAlive: pid => pid === 11 }), { ok: false, reason: 'running', runs: ['r2'] })
    assert.deepEqual((await readdir(join(repo, '.agent-runner', 'runs'))).sort(), ['r1.stderr', 'r2.lock'])

    // The process died: its lock holds nothing.
    assert.deepEqual(await cleanup(repo, { isAlive: () => false }), { ok: true, removed: ['.agent-runner/runs', '.agent-runner'], kept: [] })
  } finally {
    await removeRepo(repo)
  }
})

test('files git tracks are never removed', async () => {
  const repo = await testRepo()
  try {
    await mkdir(join(repo, '.agent-runner', 'runs'), { recursive: true })
    await writeFile(join(repo, '.agent-runner', 'runs', 'kept.stderr'), 'tracked\n')
    await git(['add', '-f', '.agent-runner/runs/kept.stderr'], repo)
    await git(['commit', '-q', '-m', 'track a run file'], repo)

    await writeFile(join(repo, '.agent-runner', 'runs', 'gone.stderr'), 'not tracked\n')
    assert.deepEqual(await cleanup(repo), { ok: true, removed: [], kept: [{ path: '.agent-runner/runs/kept.stderr', reason: 'git tracks it' }] })
    assert.deepEqual(await readdir(join(repo, '.agent-runner', 'runs')), ['kept.stderr'])
    assert.equal(await readFile(join(repo, '.agent-runner', 'runs', 'kept.stderr'), 'utf8'), 'tracked\n')
  } finally {
    await removeRepo(repo)
  }
})

test('a project taken off the list with its files: the module removes what the function removes, and is refused in words while a run is alive; without its files nothing goes', async () => {
  const repo = await testRepo()
  const removed = agentDriver.hooks['app.lifecycle']!.projectRemoved!
  const project = { id: 'repo-1', dir: repo, name: 'repo' }
  const asked: unknown[] = []
  const app = { skills: async (...args: unknown[]) => (asked.push(args), []) } as unknown as AppContext
  try {
    await ranOnce(repo, 'r1')
    assert.equal(await removed(project, app, { files: false }), undefined)
    assert.equal(await exists(join(repo, '.agent-runner')), true)

    await acquireRunLock(repo, 'r2', { pid: process.pid, isAlive: () => true })
    await assert.rejects(async () => removed(project, app, { files: true }), { message: 'a run is still working here (r2): stop it first' })

    await releaseRunLock(repo, 'r2', process.pid)
    assert.deepEqual(await removed(project, app, { files: true }), { removed: ['.agent-runner/runs', '.agent-runner'], kept: [] })
    assert.deepEqual(asked, [[{ project }, { every: true }]], "every module's skills are asked, for the rules hiding their links")
  } finally {
    await removeRepo(repo)
  }
})

test('a project is not taken off the list while a run\'s process holds its lock there; a lock a dead process left does not count', async () => {
  const repo = await testRepo()
  const refuse = agentDriver.hooks['app.lifecycle']!.refuseRemoval!
  const project = { id: 'repo-1', dir: repo, name: 'repo' }
  const app = {} as AppContext
  try {
    assert.equal(await refuse(project, app), undefined, 'no run ever ran here')
    await ranOnce(repo, 'r1')
    assert.equal(await refuse(project, app), undefined, 'a run that ended holds no lock')
    await acquireRunLock(repo, 'r2', { pid: process.pid, isAlive: () => true })
    assert.equal(await refuse(project, app), 'An agent is working in this project. Stop it, then remove the project.')
    await releaseRunLock(repo, 'r2', process.pid)
    await writeFile(join(repo, '.agent-runner', 'runs', 'r3.lock'), `${2 ** 31 - 1}\n`)
    assert.equal(await refuse(project, app), undefined)
  } finally {
    await removeRepo(repo)
  }
})

test('only the tool\'s own kinds of file go from the runs\' directory: a person\'s file there stays, and keeps the directories', async () => {
  const repo = await testRepo()
  try {
    await ranOnce(repo, 'r1')
    await writeFile(join(repo, '.agent-runner', 'runs', 'notes.txt'), 'mine\n')
    assert.deepEqual(await cleanup(repo), { ok: true, removed: [], kept: [{ path: '.agent-runner/runs/notes.txt', reason: 'not made by agent-runner' }] })
    assert.deepEqual(await readdir(join(repo, '.agent-runner', 'runs')), ['notes.txt'])
    assert.match(await excludeOf(repo), /^\/\.agent-runner$/m)
  } finally {
    await removeRepo(repo)
  }
})

test('a link in the directory\'s place is followed nowhere: what it points at is untouched', async () => {
  const repo = await testRepo()
  const elsewhere = await mkdtemp(join(tmpdir(), 'agent-runner-elsewhere-'))
  try {
    await mkdir(join(elsewhere, 'runs'))
    await writeFile(join(elsewhere, 'runs', 'r1.stderr'), 'someone else\'s\n')
    await symlink(elsewhere, join(repo, '.agent-runner'))
    assert.deepEqual(await cleanup(repo), { ok: true, removed: [], kept: [{ path: '.agent-runner', reason: 'not made by agent-runner' }] })
    assert.equal(await readFile(join(elsewhere, 'runs', 'r1.stderr'), 'utf8'), 'someone else\'s\n')
  } finally {
    await removeRepo(repo)
    await rm(elsewhere, { recursive: true, force: true })
  }
})

test('the rule hiding the directory is the repository\'s: it stays while another checkout holds one, and a rule this pass removed nothing for stays', async () => {
  const repo = await testRepo()
  try {
    // A project the tool never worked in, with the same rule written by hand.
    await writeFile(join(repo, '.git', 'info', 'exclude'), '/.agent-runner\n')
    assert.deepEqual(await cleanup(repo), { ok: true, removed: [], kept: [] })
    assert.equal(await excludeOf(repo), '/.agent-runner\n')

    // A second checkout of the same repository, a project of its own, with the person's settings.
    const other = join(repo, '..', 'other')
    await git(['worktree', 'add', '-q', '-b', 'other', other], repo)
    await mkdir(join(other, '.agent-runner'))
    await writeFile(join(other, '.agent-runner', 'config.yml'), 'personal:\n  memory: off\n')
    await ranOnce(repo, 'r1')
    assert.deepEqual(await cleanup(repo), { ok: true, removed: ['.agent-runner/runs', '.agent-runner'], kept: [] })
    assert.equal(await excludeOf(repo), '/.agent-runner\n', 'the other checkout\'s directory is still hidden')
    assert.equal((await git(['status', '--porcelain'], other)).trim(), '')
  } finally {
    await removeRepo(repo)
  }
})
