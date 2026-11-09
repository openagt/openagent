import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionsHome } from '@openagt/agent-data'
import { createProjectRuntime } from './daemon-runtime.js'
import { PROJECT_HOOKS_FILE } from './project-hooks.js'
import { SESSIONS_ID } from './project-address.js'
import { prepareSessionsHome } from './sessions-home.js'

// A session with no project: started in the sessions home by the home's own hook lines, which the
// daemon writes there as it writes a project's when the project is added.

/** Run `body` with the process's config home at a folder of its own: the runner the hook-line writer starts reads the sessions home off it. */
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

test("the sessions home gets the runner's start, resume and check lines, written fresh each time: they are OpenAgent's own", async () => {
  await withConfigHome(async env => {
    const home = sessionsHome(env)
    await mkdir(join(home, '.openagent'), { recursive: true })
    await writeFile(join(home, PROJECT_HOOKS_FILE), 'start: an-older-line "$PROMPT"\n')
    await prepareSessionsHome(home, () => assert.fail('no package should fail to write its lines'))
    const written = await readFile(join(home, PROJECT_HOOKS_FILE), 'utf8')
    for (const key of ['start', 'resume', 'check']) assert.match(written, new RegExp(`^${key}: agent-runner `, 'm'))
    assert.match(written, /--repos "\$REPOS"/, "the start line hands the session's repos on")
  })
})

test('a Start with no project runs the start line of the sessions home, with no level; a branch, a level or an account is refused, and a machine takes it', async () => {
  await withConfigHome(async env => {
    const home = sessionsHome(env)
    await mkdir(join(home, '.openagent'), { recursive: true })
    await writeFile(join(home, PROJECT_HOOKS_FILE), `start: 'printf "%s|%s" "$PROMPT" "\${PUBLISH-none}" > started.txt; echo "{\\"id\\":\\"2026-11-06T10-00-00-000Z\\"}"'\n`)
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'openagent-daemon-cwd-')))
    const runtime = createProjectRuntime({ cwd, env })
    try {
      assert.deepEqual(await runtime.onStart('Read the news', {}, SESSIONS_ID), { ok: true, agentId: '2026-11-06T10-00-00-000Z' })
      assert.equal(await readFile(join(home, 'started.txt'), 'utf8'), 'Read the news|none')
      const refused = { ok: false, error: 'A session with no project runs with no branch, nothing to publish, no account at a git host and no project skills.' }
      assert.deepEqual(await runtime.onStart('x', { publish: 'pr' }, SESSIONS_ID), refused)
      assert.deepEqual(await runtime.onStart('x', { base: 'main' }, SESSIONS_ID), refused)
      // A machine takes a session with no project: this one is not saved, which is the only thing against it.
      assert.deepEqual(await runtime.onStart('x', { machine: 'm-1' }, SESSIONS_ID), { ok: false, error: 'That machine is no longer saved. Pick another place to run.' })
      assert.deepEqual(await runtime.onStart('x', { account: 'octo-agent' }, SESSIONS_ID), refused)
      assert.deepEqual(await runtime.onStart('x', { projectSkills: 'none' }, SESSIONS_ID), refused)
    } finally {
      await runtime.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

test("a Start with no project hands its repos' folders to the start line one per line; repos for a project, or a repo that is no whole path, are refused", async () => {
  await withConfigHome(async env => {
    const home = sessionsHome(env)
    await mkdir(join(home, '.openagent'), { recursive: true })
    await writeFile(join(home, PROJECT_HOOKS_FILE), `start: 'printf "%s" "\${REPOS-none}" > started.txt; echo "{\\"id\\":\\"2026-11-06T10-00-00-000Z\\"}"'\n`)
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'openagent-daemon-cwd-')))
    const runtime = createProjectRuntime({ cwd, env })
    try {
      assert.deepEqual(await runtime.onStart('Compare', { repos: ['/home/me/app', '/home/me/site'] }, SESSIONS_ID), { ok: true, agentId: '2026-11-06T10-00-00-000Z' })
      assert.equal(await readFile(join(home, 'started.txt'), 'utf8'), '/home/me/app\n/home/me/site')
      assert.deepEqual(await runtime.onStart('x', { repos: ['/home/me/app'] }), { ok: false, error: 'Repos are added to a session with no project: a project works in its own checkout.' })
      const notAPath = { ok: false, error: 'A repo is named by the path of its folder on this computer.' }
      assert.deepEqual(await runtime.onStart('x', { repos: ['app'] }, SESSIONS_ID), notAPath)
      assert.deepEqual(await runtime.onStart('x', { repos: ['/a\n/b'] }, SESSIONS_ID), notAPath)
      assert.deepEqual(await runtime.onStart('x', { repos: 'app' as unknown as string[] }, SESSIONS_ID), notAPath)
    } finally {
      await runtime.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
