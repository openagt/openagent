import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_PREVIEW_CHARS, MAX_PREVIEW_LINES, readFileContent, safeRepoPath } from './read.js'

const scratch = () => mkdtemp(join(tmpdir(), 'file-read-'))

test('readFileContent returns the file, without its trailing newline as a blank line', async () => {
  const dir = await scratch()
  await writeFile(join(dir, 'a.ts'), 'const a = 1\nconst b = 2\n')
  const content = await readFileContent(dir, 'a.ts')
  assert.deepEqual(content, { path: 'a.ts', text: 'const a = 1\nconst b = 2', truncated: false, binary: false })
})

test('readFileContent cuts a long file and says so', async () => {
  const dir = await scratch()
  await writeFile(join(dir, 'big.ts'), Array.from({ length: MAX_PREVIEW_LINES + 50 }, (_, i) => `line ${i}`).join('\n'))
  const content = await readFileContent(dir, 'big.ts')
  assert.ok(content)
  assert.equal(content.truncated, true)
  assert.equal(content.text.split('\n').length, MAX_PREVIEW_LINES)
})

test('readFileContent reports a binary file rather than rendering bytes', async () => {
  const dir = await scratch()
  await writeFile(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]))
  const content = await readFileContent(dir, 'logo.png')
  assert.deepEqual(content, { path: 'logo.png', text: '', truncated: false, binary: true })
})

test('readFileContent yields an empty body for an empty file, not null', async () => {
  const dir = await scratch()
  await writeFile(join(dir, 'empty.ts'), '')
  const content = await readFileContent(dir, 'empty.ts')
  assert.deepEqual(content, { path: 'empty.ts', text: '', truncated: false, binary: false })
})

test('readFileContent refuses a traversing path', async () => {
  const dir = await scratch()
  await writeFile(join(dir, 'a.ts'), 'x')
  assert.equal(await readFileContent(dir, '../../etc/passwd'), null)
  assert.equal(await readFileContent(dir, '/etc/passwd'), null)
  assert.equal(await readFileContent(dir, '.git/config'), null)
})

test('readFileContent refuses a symlink that points out of the checkout', async () => {
  // The string guard passes here: the path is plain and repo-relative. Only resolving it catches
  // this, which is why the confined read re-checks after resolve.
  const dir = await scratch()
  const outside = await scratch()
  await writeFile(join(outside, 'secret.txt'), 'token')
  await mkdir(join(dir, 'src'))
  await symlink(join(outside, 'secret.txt'), join(dir, 'src', 'link.txt'))
  assert.equal(await readFileContent(dir, 'src/link.txt'), null)
})

test('readFileContent is null for a file that is not there', async () => {
  const dir = await scratch()
  assert.equal(await readFileContent(dir, 'nope.ts'), null)
})

test('safeRepoPath still rejects everything that is not a plain repo-relative path', () => {
  assert.equal(safeRepoPath('src/a.ts'), true)
  for (const bad of ['', '../outside.ts', '/etc/passwd', 'C:\\win.ini', '--output=/tmp/x', '.git/config', 'a\0b']) {
    assert.equal(safeRepoPath(bad), false, `expected ${JSON.stringify(bad)} to be rejected`)
  }
})

test('readFileContent cuts a file of one very long line, as a minified bundle is, and says so', async () => {
  const dir = await scratch()
  await writeFile(join(dir, 'bundle.js'), 'x'.repeat(MAX_PREVIEW_CHARS + 10))
  const content = await readFileContent(dir, 'bundle.js')
  assert.ok(content)
  assert.equal(content.truncated, true)
  assert.equal(content.text.length, MAX_PREVIEW_CHARS)
})
