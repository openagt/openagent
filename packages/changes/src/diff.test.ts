import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileChanges, readFileDiff } from './diff.js'
import { safeRepoPath } from './confined.js'

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = 4',
].join('\n')

const fakeGit = (out: string) => async () => out

test('a modified file yields the hunks, without git’s diff/index preamble', async () => {
  const diff = await readFileDiff('/repo', 'src/a.ts', 'modified', fakeGit(PATCH))
  assert.ok(diff)
  assert.equal(diff.binary, false)
  assert.equal(diff.truncated, false)
  assert.ok(diff.patch.startsWith('--- a/src/a.ts'))
  assert.ok(!diff.patch.includes('diff --git'))
  assert.equal(diff.added, 2)
  assert.equal(diff.removed, 1) // the `---`/`+++` headers are not counted as changes
})

test('a removed line that looks like a file header is still counted', async () => {
  // A removed `---` separator reads `----` in the patch and a removed `-- comment` reads
  // `--- comment`: content, not headers, and dropping them undercounted the file's own stats.
  const patch = [
    '--- a/notes.md',
    '+++ b/notes.md',
    '@@ -1,4 +1,1 @@',
    '----',
    '-title: x',
    '--- a note',
    ' kept',
  ].join('\n')
  const diff = await readFileDiff('/repo', 'notes.md', 'modified', fakeGit(patch))
  assert.ok(diff)
  assert.equal(diff.removed, 3)
  assert.equal(diff.added, 0)
})

test('a file with no diff to show yields null, not an empty card', async () => {
  assert.equal(await readFileDiff('/repo', 'src/a.ts', 'modified', fakeGit('')), null)
})

test('a binary change says so rather than dumping bytes', async () => {
  const out = 'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n'
  const diff = await readFileDiff('/repo', 'logo.png', 'modified', fakeGit(out))
  assert.ok(diff)
  assert.equal(diff.binary, true)
  assert.equal(diff.patch, '')
})

test('a long patch is cut and says it was cut', async () => {
  const body = ['--- a/big.ts', '+++ b/big.ts', '@@ -1 +1,600 @@', ...Array.from({ length: 600 }, (_, i) => `+line ${i}`)]
  const diff = await readFileDiff('/repo', 'big.ts', 'modified', fakeGit(body.join('\n')))
  assert.ok(diff)
  assert.equal(diff.truncated, true)
  assert.equal(diff.patch.split('\n').length, 500)
})

test('a long untracked file is counted whole, though its preview is cut', async () => {
  // The Changes list takes an untracked file's added count from this read, and that count is the
  // file's line count — counting the cut preview reported every big new file as 500.
  const dir = await mkdtemp(join(tmpdir(), 'openagent-diff-'))
  await writeFile(join(dir, 'big.ts'), Array.from({ length: 900 }, (_, i) => `line ${i}`).join('\n') + '\n')
  const diff = await readFileDiff(dir, 'big.ts', 'untracked', fakeGit(''))
  assert.ok(diff)
  assert.equal(diff.added, 900)
  assert.equal(diff.truncated, true)
  assert.equal(diff.patch.split('\n').length, 500)
})

test('a repo with no commits falls back to the working-tree diff', async () => {
  // `git diff HEAD` fails before the first commit; the change is still worth showing.
  let calls = 0
  const git = async (args: string[]) => {
    calls++
    if (args.includes('HEAD')) throw new Error("fatal: ambiguous argument 'HEAD'")
    return PATCH
  }
  const diff = await readFileDiff('/repo', 'src/a.ts', 'modified', git)
  assert.ok(diff)
  assert.equal(calls, 2)
})

test('an untracked file renders as all-added from its contents, and git is never asked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'file-diff-'))
  await writeFile(join(dir, 'new.ts'), 'const a = 1\nconst b = 2\n')
  const git = async () => {
    throw new Error('git should not run for an untracked file')
  }
  const diff = await readFileDiff(dir, 'new.ts', 'untracked', git)
  assert.ok(diff)
  assert.equal(diff.patch, '+const a = 1\n+const b = 2')
  assert.equal(diff.added, 2)
  assert.equal(diff.removed, 0)
})

test('safeRepoPath rejects everything that is not a plain repo-relative path', () => {
  assert.equal(safeRepoPath('src/a.ts'), true)
  assert.equal(safeRepoPath('a.ts'), true)
  for (const bad of [
    '',
    '../outside.ts',
    'src/../../outside.ts',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    '--output=/tmp/pwned', // git would read a leading dash as a flag
    '.git/config',
    '.git\\config',
    '.GIT/config', // macOS and Windows are case-insensitive: this opens the same file
    'nested/.Git/config',
    'src//a.ts',
    'a\0b',
  ]) {
    assert.equal(safeRepoPath(bad), false, `expected ${JSON.stringify(bad)} to be rejected`)
  }
})

test('an unsafe path is refused before any read', async () => {
  const git = async () => {
    throw new Error('git should not run for an unsafe path')
  }
  assert.equal(await readFileDiff('/repo', '../../etc/passwd', 'modified', git), null)
})

const NUMSTAT = ['3\t1\tsrc/a.ts', '0\t7\tsrc/gone.ts', '-\t-\tlogo.png'].join('\n')

test('readFileChanges counts every changed file from one numstat, not a diff each', async () => {
  let calls = 0
  const git = async () => {
    calls++
    return NUMSTAT
  }
  const changes = await readFileChanges(
    '/repo',
    { 'src/a.ts': 'modified', 'src/gone.ts': 'deleted', 'logo.png': 'modified' },
    git,
  )
  assert.equal(calls, 1)
  assert.deepEqual(changes, [
    { path: 'logo.png', status: 'modified', added: 0, removed: 0, binary: true },
    { path: 'src/a.ts', status: 'modified', added: 3, removed: 1, binary: false },
    { path: 'src/gone.ts', status: 'deleted', added: 0, removed: 7, binary: false },
  ])
})

test('readFileChanges counts an untracked file, which no diff lists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'file-changes-'))
  await writeFile(join(dir, 'new.ts'), 'a\nb\nc\n')
  const changes = await readFileChanges(dir, { 'new.ts': 'untracked' }, async () => '')
  assert.deepEqual(changes, [{ path: 'new.ts', status: 'untracked', added: 3, removed: 0, binary: false }])
})

test('readFileChanges is sorted by path, so a live session does not reshuffle the list', async () => {
  const git = async () => ['1\t0\tz.ts', '1\t0\ta.ts', '1\t0\tm.ts'].join('\n')
  const changes = await readFileChanges('/repo', { 'z.ts': 'modified', 'a.ts': 'modified', 'm.ts': 'modified' }, git)
  assert.deepEqual(
    changes.map(c => c.path),
    ['a.ts', 'm.ts', 'z.ts'],
  )
})

test('readFileChanges drops an unsafe path rather than passing it to git', async () => {
  const changes = await readFileChanges('/repo', { '../outside.ts': 'modified' }, async () => {
    throw new Error('git should not run')
  })
  assert.deepEqual(changes, [])
})

test('readFileChanges on a clean checkout is empty and asks git nothing', async () => {
  const changes = await readFileChanges('/repo', {}, async () => {
    throw new Error('git should not run')
  })
  assert.deepEqual(changes, [])
})

test('an untracked file reached through a symlink out of the repo is refused', async () => {
  // The untracked branch reads the file itself rather than asking git, so it carries the
  // containment duty itself and goes through the confined read (#828).
  const { mkdir, symlink } = await import('node:fs/promises')
  const dir = await mkdtemp(join(tmpdir(), 'file-diff-link-'))
  const outside = await mkdtemp(join(tmpdir(), 'file-diff-out-'))
  await writeFile(join(outside, 'secret.txt'), 'token')
  await mkdir(join(dir, 'src'))
  await symlink(join(outside, 'secret.txt'), join(dir, 'src', 'link.txt'))
  assert.equal(await readFileDiff(dir, 'src/link.txt', 'untracked', async () => ''), null)
})
