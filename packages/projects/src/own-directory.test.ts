import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { excludeFromGit, nodeGitRunner } from '@openagt/git-branches'
import { removeOwnDirectory } from './own-directory.js'

// A tool's own directory in a real repository: its named files go, then the directory, then the
// rule hiding it; nothing else in the project changes.

const git = nodeGitRunner()
const RETRIED_RM = { recursive: true, force: true, maxRetries: 10 } as const
const DIR = '.tool'
const OWN = ['state.json', 'tool.log']
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)
const excludeOf = (repo: string): Promise<string> => readFile(join(repo, '.git', 'info', 'exclude'), 'utf8').catch(() => '')
const remove = (repo: string) => removeOwnDirectory(repo, DIR, OWN, 'the-tool')

async function repository(): Promise<string> {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'agent-data-own-dir-')))
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 't@t'], repo)
  await git(['config', 'user.name', 't'], repo)
  await writeFile(join(repo, 'README.md'), '# t\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'init'], repo)
  return repo
}

/** The tool's directory as the tool leaves it: its two files, and the rule hiding it. */
async function used(repo: string): Promise<void> {
  await mkdir(join(repo, DIR), { recursive: true })
  for (const name of OWN) await writeFile(join(repo, DIR, name), 'x\n')
  await excludeFromGit(repo, `/${DIR}`)
}

test('the named files, the directory and the rule hiding it go; a second pass finds nothing', async () => {
  const repo = await repository()
  try {
    await writeFile(join(repo, '.git', 'info', 'exclude'), '# mine\n/notes.txt\n')
    await used(repo)
    assert.deepEqual(await remove(repo), { removed: [DIR], kept: [] })
    assert.equal(await exists(join(repo, DIR)), false)
    assert.equal(await excludeOf(repo), '# mine\n/notes.txt\n', 'only the tool\'s rule went')
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), '')
    assert.deepEqual(await remove(repo), { removed: [], kept: [] })
  } finally {
    await rm(repo, RETRIED_RM)
  }
})

test('what the tool did not name stays, with the directory and its rule; the files that went are named one by one', async () => {
  const repo = await repository()
  try {
    await used(repo)
    await writeFile(join(repo, DIR, 'mine.txt'), 'a note\n')
    await mkdir(join(repo, DIR, 'state.json.d'))
    assert.deepEqual(await remove(repo), {
      removed: [`${DIR}/state.json`, `${DIR}/tool.log`],
      kept: [
        { path: `${DIR}/mine.txt`, reason: 'not made by the-tool' },
        { path: `${DIR}/state.json.d`, reason: 'not made by the-tool' },
      ],
    })
    assert.equal(await readFile(join(repo, DIR, 'mine.txt'), 'utf8'), 'a note\n')
    assert.match(await excludeOf(repo), /^\/\.tool$/m, 'what stays is still hidden')
  } finally {
    await rm(repo, RETRIED_RM)
  }
})

test('a named file git tracks stays, and so does a directory under a named file\'s name', async () => {
  const repo = await repository()
  try {
    await mkdir(join(repo, DIR))
    await writeFile(join(repo, DIR, 'state.json'), 'tracked\n')
    await git(['add', '-f', `${DIR}/state.json`], repo)
    await git(['commit', '-q', '-m', 'track it'], repo)
    await mkdir(join(repo, DIR, 'tool.log'))
    assert.deepEqual(await remove(repo), {
      removed: [],
      kept: [
        { path: `${DIR}/state.json`, reason: 'git tracks it' },
        { path: `${DIR}/tool.log`, reason: 'not made by the-tool' },
      ],
    })
    assert.equal(await readFile(join(repo, DIR, 'state.json'), 'utf8'), 'tracked\n')
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), '')
  } finally {
    await rm(repo, RETRIED_RM)
  }
})

test('a link in the directory\'s place is followed nowhere; no directory touches nothing, a rule written by hand included', async () => {
  const repo = await repository()
  const elsewhere = await realpath(await mkdtemp(join(tmpdir(), 'agent-data-own-dir-else-')))
  try {
    await excludeFromGit(repo, `/${DIR}`)
    assert.deepEqual(await remove(repo), { removed: [], kept: [] })
    assert.match(await excludeOf(repo), /^\/\.tool$/m)

    await writeFile(join(elsewhere, 'state.json'), 'not here\n')
    await symlink(elsewhere, join(repo, DIR))
    assert.deepEqual(await remove(repo), { removed: [], kept: [{ path: DIR, reason: 'not made by the-tool' }] })
    assert.equal(await readFile(join(elsewhere, 'state.json'), 'utf8'), 'not here\n')
  } finally {
    await rm(repo, RETRIED_RM)
    await rm(elsewhere, RETRIED_RM)
  }
})

test('the rule is the repository\'s: it stays while another checkout still has the directory', async () => {
  const repo = await repository()
  const other = `${repo}-other`
  try {
    await used(repo)
    await git(['worktree', 'add', '-q', '-b', 'other', other], repo)
    await mkdir(join(other, DIR))
    await writeFile(join(other, DIR, 'state.json'), 'x\n')
    assert.deepEqual(await remove(repo), { removed: [DIR], kept: [] })
    assert.match(await excludeOf(repo), /^\/\.tool$/m)
    assert.equal((await git(['status', '--porcelain'], other)).trim(), '', 'the other checkout\'s directory is still hidden')
  } finally {
    await rm(repo, RETRIED_RM)
    await rm(other, RETRIED_RM)
  }
})
