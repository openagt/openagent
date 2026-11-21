import { strict as assert } from 'node:assert'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loginShellPath, mergePaths, withLoginShellPath } from './shell-path.js'

/** A login shell whose rc files print their own lines, and whose PATH is `path`. */
async function fakeShell(dir: string, body: string): Promise<string> {
  const shell = join(dir, 'shell')
  await writeFile(shell, `#!/bin/sh\n${body}\n`)
  await chmod(shell, 0o755)
  return shell
}

test('the login shell is asked as a terminal starts it, and its rc output is left out', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-shell-path-'))
  try {
    // Says what it was started with, prints like an rc file, then runs the command with the rc's PATH.
    const shell = await fakeShell(dir, 'echo "flags $1 $2 $3"; echo "Welcome back"; PATH=/rc/bin:/usr/bin:/bin; export PATH; eval "$4"')
    assert.equal(await loginShellPath({ PATH: '/usr/bin:/bin' }, { shell }), '/rc/bin:/usr/bin:/bin')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a shell that does not answer in time leaves the PATH as it was', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-shell-path-'))
  try {
    const shell = await fakeShell(dir, 'sleep 30')
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' }
    const started = Date.now()
    await withLoginShellPath(env, { shell, timeoutMs: 300 })
    assert.equal(env['PATH'], '/usr/bin:/bin')
    assert.ok(Date.now() - started < 5_000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a shell that is not there leaves the PATH as it was', { skip: process.platform === 'win32' }, async () => {
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' }
  await withLoginShellPath(env, { shell: '/no/such/shell' })
  assert.equal(env['PATH'], '/usr/bin:/bin')
})

test("the terminal's folders come first, and every folder only the service had stays after them", { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-shell-path-'))
  try {
    const shell = await fakeShell(dir, 'PATH=/fnm/node-24/bin:/usr/bin:/bin; export PATH; eval "$4"')
    const env: NodeJS.ProcessEnv = { PATH: '/fnm/node-22/bin:/usr/bin:/bin:/home/p/.local/bin' }
    await withLoginShellPath(env, { shell })
    assert.equal(env['PATH'], '/fnm/node-24/bin:/usr/bin:/bin:/fnm/node-22/bin:/home/p/.local/bin')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('merged folders are each kept once, empty ones dropped', () => {
  assert.equal(mergePaths('/a::/b', '/b:/c:/a:'), '/a:/b:/c')
  assert.equal(mergePaths('', '/x'), '/x')
})
