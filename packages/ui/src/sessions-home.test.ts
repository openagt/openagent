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

test('a Start with no project goes to the host with none, and no level, its home made first; a branch or a level is refused, and its git host account goes with it', async () => {
  await withConfigHome(async env => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'openagent-daemon-cwd-')))
    const host = fakeHost()
    const runtime = createProjectRuntime({ cwd, env, host })
    try {
      assert.deepEqual(await runtime.onStart('Read the news', {}, SESSIONS_ID), { ok: true, agentId: 'run-1' })
      assert.deepEqual(host.requests.map(request => [request.project, request.prompt, request.options]), [[undefined, 'Read the news', {}]])
      assert.equal((await stat(join(sessionsHome(env), '.openagent'))).isDirectory(), true, 'the home is made for it')
      const refused = { ok: false, error: 'A session with no project runs with no branch and no project skills.' }
      assert.deepEqual(await runtime.onStart('x', { publish: 'pr' }, SESSIONS_ID), { ok: false, error: 'A session with no project and no repo has nothing to publish.' })
      assert.deepEqual(await runtime.onStart('x', { base: 'main' }, SESSIONS_ID), refused)
      assert.deepEqual(await runtime.onStart('x', { projectSkills: 'none' }, SESSIONS_ID), refused)
      assert.equal(host.requests.length, 1)
      // The account picked for the session, or the computer's: the GitHub step works as it with no project too.
      assert.equal((await runtime.onStart('Open an issue', { account: 'octo-agent' }, SESSIONS_ID)).ok, true)
      assert.deepEqual(host.requests[1]!.options, { github: { account: 'octo-agent' } })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

test("a Start hands the host its repos, each under its name in the session's folder, with no project and in one; a repo that is no whole path, or a folder that is no repository, is refused", async () => {
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
      assert.deepEqual(await runtime.onStart('Compare', { repos: [join(repos, 'app'), join(repos, 'site')] }, SESSIONS_ID), { ok: true, agentId: 'run-1' })
      assert.deepEqual(host.requests[0]?.options['git-branches'], { repos: [{ name: 'app', from: join(repos, 'app') }, { name: 'site', from: join(repos, 'site') }] })
      assert.equal(host.requests[0]?.options.publish, undefined, 'no level sent, none in force')
      assert.equal((await runtime.onStart('Fix both', { repos: [join(repos, 'app')], publish: 'pr' }, SESSIONS_ID)).ok, true)
      assert.equal(host.requests[1]?.options.publish, 'pr', 'a level goes with the repos it is for')
      assert.equal((await runtime.onStart('x', { repos: [join(repos, 'app')] })).ok, true)
      assert.deepEqual(host.requests[2]?.options['git-branches'], { repos: [{ name: 'app', from: join(repos, 'app') }] }, 'a run in a project has its repos copied too')
      const notAPath = { ok: false, error: 'A repo is named by the path of its folder on this computer.' }
      assert.deepEqual(await runtime.onStart('x', { repos: ['app'] }, SESSIONS_ID), notAPath)
      assert.deepEqual(await runtime.onStart('x', { repos: ['/a\n/b'] }, SESSIONS_ID), notAPath)
      assert.deepEqual(await runtime.onStart('x', { repos: 'app' as unknown as string[] }, SESSIONS_ID), notAPath)
      const notARepo = await runtime.onStart('x', { repos: [join(repos, 'notes')] }, SESSIONS_ID)
      assert.equal(notARepo.ok, false)
      assert.equal(host.requests.length, 3)
    } finally {
      await rm(cwd, { recursive: true, force: true })
      await rm(repos, { recursive: true, force: true })
    }
  })
})
