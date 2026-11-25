import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { makeWorld } from './harness.js'
import { onProjects } from '../dashboard-rpc/projects.js'
import { callModule } from '../dashboard-rpc/module-calls.js'
import { onAgents, onDocs } from '../dashboard-rpc/reads.js'
import { onPreferences, patchPreferences } from '../dashboard-rpc/preferences.js'
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

    // The Projects sidebar shows the repo as a project, not one that is no longer activated.
    const projects = await rpc(onProjects)()
    const mine = projects.find(p => p.id === project.id)
    assert.equal(mine?.path, project.cwd)
    assert.equal(mine?.notes?.some(note => note.words === 'Not activated') ?? false, false)

    // The project's reads answer: an empty docs rail, an empty agent history.
    assert.deepEqual(await rpc(onDocs)(project.id), [])
    assert.deepEqual(await rpc(onAgents)(project.id), [])

    // Adding the same repo again is a no-op the dialog can explain, not a duplicate.
    const addProject = (path: string) => rpc(callModule)(null, '@openagt/projects', 'addProject', { path })
    assert.deepEqual(await addProject(project.cwd), { ok: true, output: { ok: true, alreadyActivated: true } })
    assert.equal((await rpc(onProjects)()).filter(p => p.id === project.id).length, 1)

    // A bogus path is refused with a reason, not a crash.
    const bogus = await addProject(join(world.home, 'nope'))
    assert.equal(bogus.ok && (bogus.output as { ok: boolean }).ok, false)
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
    // Settings: patch your settings and read them back. The pick a Start hands to the
    // run (how far it publishes) is among them.
    const patched = await rpc(patchPreferences)({ publish: 'pr' })
    assert.equal(patched.ok, true)
    assert.equal((await rpc(onPreferences)()).publish, 'pr')
    // A word the launcher's menu does not list is dropped rather than stored.
    await rpc(patchPreferences)({ publish: 'push' as never })
    assert.equal((await rpc(onPreferences)()).publish, undefined)
  } finally {
    await world.close()
  }
})

