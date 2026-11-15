import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('./bin.js', import.meta.url))

/** `npx @openagt/uninstall` with `args`, in a throwaway home with no command on its `PATH`: what it said, and what it left in the home. */
async function uninstall(args: string[]): Promise<{ code: number; stdout: string; stderr: string; left: string[] }> {
  const home = await mkdtemp(join(tmpdir(), 'openagent-uninstall-'))
  const empty = join(home, 'no-commands')
  try {
    const ran = await new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
      execFile(process.execPath, [BIN, ...args], { env: { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: empty } }, (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
      )
    })
    return { ...ran, left: await readdir(home) }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

test('--help says what the uninstall does, and touches nothing', async () => {
  const { code, stdout, stderr, left } = await uninstall(['--help'])
  assert.equal(code, 0, stderr)
  assert.match(stdout, /^Usage: npx @openagt\/uninstall\n/)
  for (const line of stdout.split('\n')) assert.ok(line.length <= 100, line)
  assert.equal(stderr, '')
  assert.deepEqual(left, [])
})

test('an argument the uninstall does not know is refused before anything is touched', async () => {
  const { code, stdout, stderr, left } = await uninstall(['--port', '4300'])
  assert.equal(code, 2)
  assert.equal(stdout, '')
  assert.equal(stderr, 'unknown option: --port\nRun `npx @openagt/uninstall --help` for usage.\n')
  assert.deepEqual(left, [])
})
