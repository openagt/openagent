import { strict as assert } from 'node:assert'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { claudeWebDir, ensureToken, readToken } from './token.js'

// The bridge's key: made once, kept in the plugin's own folder, readable by its owner only.

test("the plugin's folder is under the person's config folder, else their home (#2394)", () => {
  assert.equal(claudeWebDir({ XDG_CONFIG_HOME: '/cfg', HOME: '/home/me' }), '/cfg/openagent-claude-web')
  assert.equal(claudeWebDir({ HOME: '/home/me' }), '/home/me/.openagent-claude-web')
})

test('the key is made once, 32 random bytes, and kept where only its owner reads it (#1237, #2394)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'claude-web-token-'))
  const dir = join(base, 'openagent-claude-web')
  try {
    assert.equal(await readToken(dir), undefined)
    const token = await ensureToken(dir)
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(await ensureToken(dir), token, 'kept, not made again')
    assert.equal(await readToken(dir), token)
    assert.equal((await stat(join(dir, 'token'))).mode & 0o777, 0o600)
    assert.equal((await stat(dir)).mode & 0o777, 0o700)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
