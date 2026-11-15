import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freed } from './install.js'

const BIN = fileURLToPath(new URL('./bin.js', import.meta.url))

/** `npx @openagt/install` with `args`, in a throwaway home with `path` as its `PATH` (no command by default): what it said, and what it left in the home. */
async function install(args: string[], path?: string): Promise<{ code: number; stdout: string; stderr: string; left: string[] }> {
  const home = await mkdtemp(join(tmpdir(), 'openagent-install-'))
  try {
    const ran = await new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
      execFile(process.execPath, [BIN, ...args], { env: { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: path ?? join(home, 'no-commands') } }, (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
      )
    })
    return { ...ran, left: await readdir(home, { recursive: true }) }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

test('--help says what the install does, and touches nothing', async () => {
  const { code, stdout, stderr, left } = await install(['--help'])
  assert.equal(code, 0, stderr)
  assert.match(stdout, /^Usage: npx @openagt\/install\n/)
  for (const line of stdout.split('\n')) assert.ok(line.length <= 100, line)
  assert.equal(stderr, '')
  assert.deepEqual(left, [])
})

test('an argument the install does not know is refused before anything is touched', async () => {
  const { code, stdout, stderr, left } = await install(['--port', '4300'])
  assert.equal(code, 2)
  assert.equal(stdout, '')
  assert.equal(stderr, 'unknown option: --port\nRun `npx @openagt/install --help` for usage.\n')
  assert.deepEqual(left, [])
})

test('a password sudo does not take leaves no certificate behind, so a dashboard started here keeps its own address', { skip: process.platform !== 'linux' }, async t => {
  if (!(await freed(4200, 0))) return t.skip('a program holds port 4200, which the install checks first')
  const commands = await mkdtemp(join(tmpdir(), 'openagent-commands-'))
  try {
    // sudo refuses the password; no dashboard of the install's runs yet; the browsers' and the port's commands are there.
    const scripts = { sudo: 'echo "sudo: 3 incorrect password attempts" >&2; exit 1', systemctl: 'case "$*" in *is-active*) exit 3;; esac', certutil: '', nft: '' }
    for (const [name, body] of Object.entries(scripts)) await writeFile(join(commands, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    const { code, stderr, left } = await install([], [commands, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter))
    assert.equal(code, 1)
    assert.match(stderr, /OpenAgent could not be installed: .*Run this again to try once more\.\n$/)
    assert.deepEqual(left, ['.config'])
  } finally {
    await rm(commands, { recursive: true, force: true })
  }
})
