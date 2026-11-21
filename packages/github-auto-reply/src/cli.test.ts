import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GhRunner } from '@openagt/github'
import { runCli, USAGE, type CliDeps } from './cli.js'

// The command the plugin's scheduler row checks GitHub with: JSON on stdout, a line for a person on
// stderr, an exit code that says refusal or usage error. gh is scripted throughout.

/** A run's environment: the account it was given, one of OpenAgent's, so gh works as it. */
const IN_A_RUN = { XDG_CONFIG_HOME: '/cfg', GH_CONFIG_DIR: '/cfg/openagent-github/octo' }

async function run(cwd: string, argv: string[], deps: CliDeps = {}): Promise<{ code: number; out: unknown; err: string }> {
  const outLines: string[] = []
  const errLines: string[] = []
  const code = await runCli(argv, { cwd, stdout: line => outLines.push(line), stderr: line => errLines.push(line) }, { ...deps, env: { ...IN_A_RUN, ...deps.env } })
  return { code, out: outLines.length ? JSON.parse(outLines.join('\n')) : undefined, err: errLines.join('\n') }
}

test('no command: the usage; an unknown command, a bad flag, a --since that is no time: what was wrong; exit 2', async () => {
  const none = await run('/r', [])
  assert.equal(none.code, 2)
  assert.ok(none.err.startsWith(USAGE))
  assert.match((await run('/r', ['frobnicate'])).err, /^unknown command: frobnicate\nRun `github-auto-reply --help` for usage\.$/m)
  assert.match((await run('/r', ['replies', '--nope'])).err, /^unknown option: --nope$/m)
  const since = await run('/r', ['replies', '--since', 'yesterday'])
  assert.deepEqual([since.code, since.out], [2, undefined])
  assert.match(since.err, /--since is a time, like 2026-10-09T10:00:00Z, not "yesterday"/)
})

test('replies asks GitHub as the account the run was given, and a GitHub that cannot answer is a git-host-failed refusal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-reply-cli-'))
  try {
    const asked: { args: string[]; env: Record<string, string> | undefined }[] = []
    const gh: GhRunner = async (args, _cwd, env) => {
      asked.push({ args, env })
      throw new Error('gh: not logged in')
    }
    const failed = await run(dir, ['replies', '--since', '2026-10-09T10:00:00Z'], { gh })
    assert.deepEqual([failed.code, failed.out], [1, { ok: false, reason: 'git-host-failed', detail: 'gh: not logged in' }])
    assert.equal(failed.err, 'the pull requests could not be read: gh: not logged in')
    assert.equal(asked[0]?.env?.['GH_CONFIG_DIR'], IN_A_RUN.GH_CONFIG_DIR, 'as the run’s account, never the person’s gh')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
