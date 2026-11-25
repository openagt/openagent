import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeGitRunner } from './git.js'
import { readFolderBehind, updateFolder } from './folder-behind.js'

// A project's folder behind its remote (#2421), on real repositories: a remote, the project's
// folder cloned from it, and another clone that pushes what "merged" since.

const git = nodeGitRunner()
const RETRIED_RM = { recursive: true, force: true, maxRetries: 10 } as const

async function clone(bare: string, prefix: string): Promise<string> {
  const dir = join(await realpath(await mkdtemp(join(tmpdir(), prefix))), 'clone')
  await git(['clone', '--quiet', bare, dir], tmpdir())
  await git(['config', 'user.email', 't@t'], dir)
  await git(['config', 'user.name', 't'], dir)
  return dir
}

async function commit(repo: string, file: string, text: string): Promise<void> {
  await writeFile(join(repo, file), text)
  await git(['add', '-A'], repo)
  await git(['commit', '--quiet', '-m', `write ${file}`], repo)
}

/** The project's folder, up to date, and `merge`, which pushes `n` new commits to the remote from elsewhere. */
async function project(): Promise<{ folder: string; merge: (n: number) => Promise<void>; cleanup: () => Promise<void> }> {
  const bare = await realpath(await mkdtemp(join(tmpdir(), 'folder-behind-bare-')))
  await git(['init', '--quiet', '--bare', '-b', 'main', bare], bare)
  const other = await clone(bare, 'folder-behind-other-')
  await commit(other, 'README.md', '# t\n')
  await git(['push', '--quiet', 'origin', 'HEAD:main'], other)
  const folder = await clone(bare, 'folder-behind-folder-')
  let made = 0
  const merge = async (n: number) => {
    for (let i = 0; i < n; i++) await commit(other, `merged-${++made}.md`, 'merged\n')
    await git(['push', '--quiet', 'origin', 'HEAD:main'], other)
  }
  const cleanup = async () => {
    for (const dir of [bare, join(other, '..'), join(folder, '..')]) await rm(dir, RETRIED_RM)
  }
  return { folder, merge, cleanup }
}

test('a folder that lacks what merged since is said to be behind by that many commits, once the remote is asked', async () => {
  const { folder, merge, cleanup } = await project()
  try {
    await merge(3)
    assert.equal(await readFolderBehind(folder), undefined, 'the remote not asked: this clone has not heard of them')
    assert.deepEqual(await readFolderBehind(folder, { origin: git }), { branch: 'main', behind: 3 })
  } finally {
    await cleanup()
  }
})

test('up to date, nothing is said; and the remote is asked once a minute at most', async () => {
  const { folder, merge, cleanup } = await project()
  try {
    assert.equal(await readFolderBehind(folder, { origin: git }), undefined)
    await merge(1)
    assert.equal(await readFolderBehind(folder, { origin: git }), undefined, 'asked a moment ago, so not again yet')
  } finally {
    await cleanup()
  }
})

test('the update brings the folder up, the files with it, and it is behind no more', async () => {
  const { folder, merge, cleanup } = await project()
  try {
    await merge(2)
    assert.deepEqual(await readFolderBehind(folder, { origin: git }), { branch: 'main', behind: 2 })
    assert.deepEqual(await updateFolder(folder), { ok: true })
    assert.equal(await readFile(join(folder, 'merged-2.md'), 'utf8'), 'merged\n')
    assert.equal(await readFolderBehind(folder), undefined)
  } finally {
    await cleanup()
  }
})

test('a folder on another branch is not behind, and is not updated', async () => {
  const { folder, merge, cleanup } = await project()
  try {
    await git(['checkout', '--quiet', '-b', 'my-work'], folder)
    await merge(1)
    assert.equal(await readFolderBehind(folder, { origin: git }), undefined)
    assert.deepEqual(await updateFolder(folder), { ok: false, error: 'The folder is not on its main branch.' })
  } finally {
    await cleanup()
  }
})

test('a folder with a commit of its own is not moved: git refuses, in its words, and the commit stays', async () => {
  const { folder, merge, cleanup } = await project()
  try {
    await commit(folder, 'mine.md', 'mine\n')
    await merge(1)
    assert.deepEqual(await readFolderBehind(folder, { origin: git }), { branch: 'main', behind: 1 })
    const updated = await updateFolder(folder)
    assert.equal(updated.ok, false)
    assert.match(updated.ok ? '' : updated.error, /fast-forward|diverg/i)
    assert.equal(await readFile(join(folder, 'mine.md'), 'utf8'), 'mine\n')
  } finally {
    await cleanup()
  }
})

test('a folder with no remote is not behind', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'folder-behind-alone-')))
  try {
    await git(['init', '--quiet', '-b', 'main'], repo)
    assert.equal(await readFolderBehind(repo, { origin: git }), undefined)
  } finally {
    await rm(repo, RETRIED_RM)
  }
})
