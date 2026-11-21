import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
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

test('a Start with no project goes to the host with none, and no level, its home made first; a branch, a level or an account is refused', async () => {
  await withConfigHome(async env => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'openagent-daemon-cwd-')))
    const host = fakeHost()
    const runtime = createProjectRuntime({ cwd, env, host })
    try {
      assert.deepEqual(await runtime.onStart('Read the news', {}, SESSIONS_ID), { ok: true, agentId: 'run-1', driver: 'claude-code' })
      assert.deepEqual(host.requests.map(request => [request.project, request.prompt, request.options]), [[undefined, 'Read the news', {}]])
      assert.equal((await stat(join(sessionsHome(env), '.openagent'))).isDirectory(), true, 'the home is made for it')
      const refused = { ok: false, error: 'A session with no project runs with no branch, nothing to publish, no account at a git host and no project skills.' }
      assert.deepEqual(await runtime.onStart('x', { publish: 'pr' }, SESSIONS_ID), refused)
      assert.deepEqual(await runtime.onStart('x', { base: 'main' }, SESSIONS_ID), refused)
      assert.deepEqual(await runtime.onStart('x', { account: 'octo-agent' }, SESSIONS_ID), refused)
      assert.deepEqual(await runtime.onStart('x', { projectSkills: 'none' }, SESSIONS_ID), refused)
      assert.equal(host.requests.length, 1)
    } finally {
      await runtime.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

test("a Start with no project hands the host its repos, each under its name in the session's folder; repos for a project, a repo that is no whole path, or a folder that is no repository, are refused", async () => {
  await withConfigHome(async env => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'openagent-daemon-cwd-')))
    const repos = await realpath(await mkdtemp(join(tmpdir(), 'openagent-session-repos-')))
    const host = fakeHost()
    const runtime = createProjectRuntime({ cwd, env, host })
    try {
      for (const name of ['app', 'site']) {
        await mkdir(join(repos, name))
        execFileSync('git', ['init', '-q'], { cwd: join(repos, name) })
      }
      await mkdir(join(repos, 'notes'))
      assert.deepEqual(await runtime.onStart('Compare', { repos: [join(repos, 'app'), join(repos, 'site')] }, SESSIONS_ID), { ok: true, agentId: 'run-1', driver: 'claude-code' })
      assert.deepEqual(host.requests[0]?.options['git-branches'], { repos: [{ name: 'app', from: join(repos, 'app') }, { name: 'site', from: join(repos, 'site') }] })
      assert.deepEqual(await runtime.onStart('x', { repos: [join(repos, 'app')] }), { ok: false, error: 'Repos are added to a session with no project: a project works in its own checkout.' })
      const notAPath = { ok: false, error: 'A repo is named by the path of its folder on this computer.' }
      assert.deepEqual(await runtime.onStart('x', { repos: ['app'] }, SESSIONS_ID), notAPath)
      assert.deepEqual(await runtime.onStart('x', { repos: ['/a\n/b'] }, SESSIONS_ID), notAPath)
      assert.deepEqual(await runtime.onStart('x', { repos: 'app' as unknown as string[] }, SESSIONS_ID), notAPath)
      const notARepo = await runtime.onStart('x', { repos: [join(repos, 'notes')] }, SESSIONS_ID)
      assert.equal(notARepo.ok, false)
      assert.equal(host.requests.length, 1)
    } finally {
      await runtime.dispose()
      await rm(cwd, { recursive: true, force: true })
      await rm(repos, { recursive: true, force: true })
    }
  })
})
