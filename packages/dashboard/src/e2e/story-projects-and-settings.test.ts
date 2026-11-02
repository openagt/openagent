import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { makeWorld } from './harness.js'
import { onProjects, sendAddProject } from '../dashboard-rpc/projects.js'
import { onGitStatus, onAgents, onDocs } from '../dashboard-rpc/reads.js'
import { onPreferences, patchPreferences } from '../dashboard-rpc/preferences.js'
import { onQuota } from '../dashboard-rpc/quota.js'
import { sendStart } from '../dashboard-rpc/control.js'

// The projects & settings stories (README.md): registering a repo, what the sidebar then shows,
// how settings written in the dashboard reach the agents the daemon starts, and the usage panel.

test('add a project: it is installed, registered, and readable like the sidebar reads it (#396)', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject()

    // Install left its mark in the repo: the `.openagent/` directory and its ignore file, which is
    // the one file install writes (B3).
    await stat(join(project.cwd, '.openagent', '.gitignore'))

    // The Projects sidebar shows the repo as an activated project.
    const projects = await rpc(onProjects)()
    const mine = projects.find(p => p.id === project.id)
    assert.equal(mine?.path, project.cwd)
    assert.equal(mine?.activated, true)

    // The project header's reads answer: the branch, an empty docs rail, an empty agent history.
    const status = await rpc(onGitStatus)(project.id)
    assert.equal(status?.branch, 'main')
    assert.deepEqual(await rpc(onDocs)(project.id), [])
    assert.deepEqual(await rpc(onAgents)(project.id), [])

    // Adding the same repo again is a no-op the dialog can explain, not a duplicate.
    const again = await rpc(sendAddProject)(project.cwd, false)
    assert.deepEqual(again, { ok: true, alreadyActivated: true })
    assert.equal((await rpc(onProjects)()).filter(p => p.id === project.id).length, 1)

    // A bogus path is refused with a reason, not a crash.
    const bogus = await rpc(sendAddProject)(join(world.home, 'nope'), false)
    assert.equal(bogus.ok, false)
  } finally {
    await world.close()
  }
})

test('unknown projects degrade quietly: reads are empty, writes are refused (#427)', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    await world.addProject()
    assert.deepEqual(await rpc(onAgents)('no-such-project'), [])
    assert.equal(await rpc(onGitStatus)('no-such-project'), null)
    const refused = await rpc(sendStart)('no-such-project', 'do something')
    assert.equal(refused.ok, false)
  } finally {
    await world.close()
  }
})

test('settings written in the dashboard read back, and only what the dashboard knows is kept (#858)', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    // Settings: patch your settings and read them back. The picks a Start hands to the
    // project's start hook (the coding agent, the model) are among them.
    const patched = await rpc(patchPreferences)({ driver: 'codex', model: 'gpt-5-e2e' })
    assert.equal(patched.ok, true)
    assert.equal((await rpc(onPreferences)()).driver, 'codex')
    assert.equal((await rpc(onPreferences)()).model, 'gpt-5-e2e')
    // A coding agent nobody can pick is dropped rather than stored.
    await rpc(patchPreferences)({ driver: 'no-such-agent' })
    assert.equal((await rpc(onPreferences)()).driver, undefined)
  } finally {
    await world.close()
  }
})

test('the usage panel reads the daemon quota source (#533)', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    // No reading: the panel must hear "unavailable", never an empty bar that reads as unused.
    world.quota.view = { windows: [], unavailable: 'fetch-failed' }
    assert.equal((await rpc(onQuota)()).unavailable, 'fetch-failed')

    // With a reading, the windows come through as the poller reported them.
    world.quota.view = {
      windows: [{ label: 'Current week (all models)', usedPercent: 40 } as never],
      readAt: 123,
    }
    const quota = await rpc(onQuota)()
    assert.equal(quota.windows.length, 1)
    assert.equal(quota.readAt, 123)
  } finally {
    await world.close()
  }
})
