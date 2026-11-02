import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { formatBytes } from './format-bytes.js'

test('formatBytes scales to a readable unit (#798/#752)', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5 MB')
  assert.equal(formatBytes(512 * 1024 * 1024), '512 MB')
  assert.equal(formatBytes(3 * 1024 ** 4), '3 TB')
})

test('a size that could not be read falls back rather than printing a zero', () => {
  // `du` is best-effort (missing on Windows, refused on an unreadable dir); a "0 B" worktree
  // would read as an answer.
  assert.equal(formatBytes(undefined), '–')
  assert.equal(formatBytes(Number.NaN), '–')
  assert.equal(formatBytes(-1), '–')
  assert.equal(formatBytes(undefined, ''), '')
  assert.equal(formatBytes(undefined, '-'), '-')
})
