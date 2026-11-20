import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { worktreeSize } from './worktree.js'

// A worktree's size only ever labels a "remove this" button (#798), so every failure mode has to
// come back as "unknown" rather than a throw or a wrong number.

test('worktreeSize converts du kilobytes to bytes', async () => {
  const size = await worktreeSize('/some/tree', async () => '2048\t/some/tree\n')
  assert.equal(size, 2048 * 1024)
})

test('worktreeSize reads a real directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wt-size-'))
  await writeFile(join(dir, 'f.txt'), 'x'.repeat(4096))
  const size = await worktreeSize(dir)
  // du reports in disk blocks, so assert it is a plausible number rather than an exact one; on a
  // platform without `du` the read is undefined, which is also a pass.
  assert.ok(size === undefined || size > 0)
})

test('worktreeSize reports unknown when du fails', async () => {
  const size = await worktreeSize('/gone', async () => {
    throw new Error('du: /gone: No such file or directory')
  })
  assert.equal(size, undefined)
})

test('worktreeSize reports unknown for output it cannot parse', async () => {
  assert.equal(await worktreeSize('/x', async () => 'not a number\n'), undefined)
  assert.equal(await worktreeSize('/x', async () => ''), undefined)
})
