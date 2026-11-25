import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionsHome } from '@openagt/agent-data'
import { fakeHost } from '@openagt/hooks/testing'
import { createProjectRuntime } from './daemon-runtime.js'
import { SESSIONS_ID } from './project-address.js'

// A session with no project: started on this computer's host with no project, in the sessions
// home, which the daemon makes as it makes a project's folder.

/** Run `body` with the process's config home at a folder of its own: the sessions home is read off it. */
async function withConfigHome(body: (env: { XDG_CONFIG_HOME: string }) => Promise<void>): Promise<void> {
  const cfg = await realpath(await mkdtemp(join(tmpdir(), 'openagent-sessions-cfg-')))
  const before = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = cfg
  try {
    await body({ XDG_CONFIG_HOME: cfg })
  } finally {
    if (before === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = before
    await rm(cfg, { recursive: true, force: true })
  }
}

test('a Start with no project goes to the host with none, its home made first, and its level and its git host account go with it', async () => {
  await withConfigHome(async env => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'openagent-daemon-cwd-')))
    const host = fakeHost()
    const runtime = createProjectRuntime({ cwd, env, host })
    try {
      assert.deepEqual(await runtime.onStart('Read the news', {}, SESSIONS_ID), { ok: true, agentId: 'run-1' })
      assert.deepEqual(host.requests.map(request => [request.project, request.prompt, request.options]), [[undefined, 'Read the news', {}]])
      assert.equal((await stat(join(sessionsHome(env), '.openagent'))).isDirectory(), true, 'the home is made for it')
      // The level is for the repos the session's options give it: the host drops one with none.
      assert.equal((await runtime.onStart('x', { publish: 'pr' }, SESSIONS_ID)).ok, true)
      assert.equal(host.requests[1]!.options.publish, 'pr')
      // The account picked for the session, or the computer's: the GitHub step works as it with no project too.
      assert.equal((await runtime.onStart('Open an issue', { options: { github: { account: 'octo-agent' } } }, SESSIONS_ID)).ok, true)
      assert.deepEqual(host.requests[2]!.options, { github: { account: 'octo-agent' } })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

