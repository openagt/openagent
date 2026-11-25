import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { projectId } from '@openagt/projects'
import { SCHEDULED_COMMANDS } from '@openagt/hooks'
import { memorySettings, rpcHost } from '@openagt/hooks/testing'
import { addAutomation } from './automation.js'
import { picksSettings } from './picks.js'
import { show, status } from './server.js'
import { git, removeRepo, testRepo, writeSkill } from './test-repo.js'

// The server part runs in the dashboard's own process: it reads this computer's switches and paces
// from the settings the dashboard hands it, never from a distribution handed down.
picksSettings.of = async () => {
  throw new Error('no distribution is handed down to the dashboard itself')
}

test("status is the project's scheduler with this computer's switches and paces read from the settings it is handed, in this project alone", async () => {
  const repo = await testRepo()
  try {
    await writeSkill(repo, 'triage', 'schedule:\n  every: 6h\n')
    const settings = memorySettings()
    const on = '2026-10-03T08:00:00.000Z'
    await settings.set(SCHEDULED_COMMANDS, { [projectId(repo)]: { triage: { on, pace: { every: '2d', since: on } } }, [projectId('/work/other')]: { triage: { on: '2026-10-04T08:00:00.000Z' } } })
    const read = await status(rpcHost({ root: repo, settings }), {})
    assert.deepEqual([read.on, read.running, read.switches, read.paces], [false, false, { triage: on }, { triage: { every: '2d', since: on } }])
    assert.deepEqual(read.schedule.map(command => command.command), ['triage'])
    assert.deepEqual(read.unreadable, [])
  } finally {
    await removeRepo(repo)
  }
})

test('show answers an automation saved with add as its file says it now; anything else is refused with why', async () => {
  const repo = await testRepo()
  try {
    const host = rpcHost({ root: repo, settings: memorySettings() })
    assert.equal((await addAutomation(repo, { name: 'tidy', prompt: 'Tidy up.', every: '1d' }, git, { onThisMachine: true })).ok, true)
    const { version, ...shown } = await show(host, { name: 'tidy' })
    assert.deepEqual(shown, { name: 'tidy', prompt: 'Tidy up.', every: '1d', file: '.scheduler/automations/tidy.md', onThisMachine: true })
    assert.equal(typeof version === 'string' && version !== '', true, 'it names a version')
    await writeSkill(repo, 'triage', 'schedule:\n  every: 6h\n')
    await assert.rejects(show(host, { name: 'triage' }), { message: '.claude/skills/triage is a skill of the project, or an automation changed by hand since it was saved: edit or remove its files yourself' })
    await assert.rejects(show(host, { name: 'never-saved' }), { message: 'the schedule lists nothing named never-saved' })
    // A page can send anything.
    await assert.rejects(show(host, { name: 7 } as unknown as { name: string }), { message: 'an automation is shown by its name' })
  } finally {
    await removeRepo(repo)
  }
})
