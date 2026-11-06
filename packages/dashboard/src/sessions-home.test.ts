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

test("the sessions home gets the runner's start, resume and check lines", async () => {
  await withConfigHome(async env => {
    const home = await prepareSessionsHome(sessionsHome(env), () => assert.fail('no package should fail to write its lines'))
    const written = await readFile(join(home, PROJECT_HOOKS_FILE), 'utf8')
    for (const key of ['start', 'resume', 'check']) assert.match(written, new RegExp(`^${key}: agent-runner `, 'm'))
  })
})

test('a Start with no project runs the start line of the sessions home, with no level; a branch, a machine or a level is refused', async () => {
  await withConfigHome(async env => {
    const home = sessionsHome(env)
    await mkdir(join(home, '.openagent'), { recursive: true })
    await writeFile(join(home, PROJECT_HOOKS_FILE), `start: 'printf "%s|%s" "$PROMPT" "\${PUBLISH-none}" > started.txt; echo "{\\"id\\":\\"2026-11-06T10-00-00-000Z\\"}"'\n`)
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'openagent-daemon-cwd-')))
    const runtime = createProjectRuntime({ cwd, env })
    try {
      assert.deepEqual(await runtime.onStart('Read the news', {}, SESSIONS_ID), { ok: true, agentId: '2026-11-06T10-00-00-000Z' })
      assert.equal(await readFile(join(home, 'started.txt'), 'utf8'), 'Read the news|none')
      const refused = { ok: false, error: 'A session with no project runs on this computer, with no branch and nothing to publish.' }
      assert.deepEqual(await runtime.onStart('x', { publish: 'pr' }, SESSIONS_ID), refused)
      assert.deepEqual(await runtime.onStart('x', { base: 'main' }, SESSIONS_ID), refused)
      assert.deepEqual(await runtime.onStart('x', { machine: 'm-1' }, SESSIONS_ID), refused)
    } finally {
      await runtime.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
