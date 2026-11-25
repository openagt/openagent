import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { projectId } from '@openagt/projects'
import { SCHEDULED_COMMANDS } from '@openagt/hooks'
import { memorySettings } from '@openagt/hooks/testing'
import { cleanup, SWITCHES_AND_PACES } from './cleanup.js'
import { NO_SETTINGS, picksSettings, readPicks, savePicks } from './picks.js'
import { DEFAULT_STATE, readState, stateDir, statePath, updateState, withPick } from './state.js'
import { removeRepo, testRepo } from './test-repo.js'

const ON = '2026-10-03T08:00:00.000Z'

test("a project's switches and paces are this computer's settings, by the project's id: the state as read holds them, and the file does not; what the file held of them before is no switch", async () => {
  const settings = memorySettings()
  picksSettings.of = async () => settings
  const repo = await testRepo()
  try {
    await mkdir(stateDir(repo), { recursive: true })
    await writeFile(statePath(repo), JSON.stringify({ ...DEFAULT_STATE, switches: { 'work-queue': ON } }))
    assert.equal((await readState(repo)).switches, undefined, "the file's own switches are not this machine's any more")

    const pace = { every: '1d', at: '10:00', since: ON }
    const state = await updateState(repo, s => withPick(withPick(s, 'switches', 'work-queue', ON), 'paces', 'triage quick', pace))
    assert.deepEqual([state.switches, state.paces], [{ 'work-queue': ON }, { 'triage quick': pace }])
    assert.deepEqual(await settings.get(SCHEDULED_COMMANDS), { [projectId(repo)]: { 'triage quick': { pace }, 'work-queue': { on: ON } } })
    const file = JSON.parse(await readFile(statePath(repo), 'utf8')) as Record<string, unknown>
    assert.equal('switches' in file || 'paces' in file, false, 'the file holds neither')
    assert.deepEqual([(await readState(repo)).switches, (await readState(repo)).paces], [{ 'work-queue': ON }, { 'triage quick': pace }])

    // Another project's stay as they are; taken back to none, the project's entry goes.
    await settings.set(SCHEDULED_COMMANDS, { ...(await settings.get(SCHEDULED_COMMANDS)), other: { tidy: { on: ON } } })
    await updateState(repo, s => withPick(withPick(s, 'switches', 'work-queue', undefined), 'paces', 'triage quick', undefined))
    assert.deepEqual(await settings.get(SCHEDULED_COMMANDS), { other: { tidy: { on: ON } } })
  } finally {
    await removeRepo(repo)
  }
})

test('a write of the state that changes no switch or pace saves none: a switch saved meanwhile, by another process, stays', async () => {
  const settings = memorySettings()
  picksSettings.of = async () => settings
  const repo = await testRepo()
  try {
    await updateState(repo, s => ({ ...s, on: true }))
    // The dashboard switches a command on while the tick holds the state it read.
    await savePicks(repo, { switches: { 'work-queue': ON } })
    await updateState(repo, s => ({ ...s, on: false }))
    assert.deepEqual(await readPicks(repo), { switches: { 'work-queue': ON } })
  } finally {
    await removeRepo(repo)
  }
})

test('outside OpenAgent, with no settings to reach, every command reads off, a state with none writes, and a switch or a pace is refused with why', async () => {
  picksSettings.of = async () => undefined
  const repo = await testRepo()
  try {
    assert.deepEqual(await readPicks(repo), {})
    await updateState(repo, s => ({ ...s, on: true }))
    assert.equal((await readState(repo)).on, true)
    await assert.rejects(updateState(repo, s => withPick(s, 'switches', 'work-queue', ON)), { message: NO_SETTINGS })
  } finally {
    await removeRepo(repo)
  }
})

test("the clean-up takes the project's switches and paces away with its files, and says so", async () => {
  const settings = memorySettings()
  picksSettings.of = async () => settings
  const repo = await testRepo()
  try {
    await updateState(repo, s => withPick(s, 'switches', 'work-queue', ON))
    const outcome = await cleanup(repo)
    assert.equal(outcome.ok, true)
    assert.ok(outcome.ok && outcome.removed.includes(SWITCHES_AND_PACES))
    assert.deepEqual(await settings.get(SCHEDULED_COMMANDS), {})
    // A project with none has nothing of them to say.
    const again = await cleanup(repo)
    assert.ok(again.ok && !again.removed.includes(SWITCHES_AND_PACES))
  } finally {
    await removeRepo(repo)
  }
})
