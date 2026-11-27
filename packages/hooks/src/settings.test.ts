import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { defineSetting, enabledSetting, SETTINGS_FILE, settingsIn } from './settings.js'
import type { ProjectRef } from './project.js'
import { chainStore, COMPUTER, PERSON, projectScope } from './store.js'
import { memoryStore } from './testing.js'
import { readCallersWith, type TeamCaller } from './team.js'

// Settings through the store: each scope's own file, the default until something is set, and a
// file a person broke by hand that never stops a module.

const pace = defineSetting<number>({ key: 'scheduled-agents.pace', scope: 'project', default: 6, parse: value => (typeof value === 'number' && value > 0 ? value : undefined) })
const editor = defineSetting<string>({ key: 'projects.editor', scope: 'computer', default: 'code', parse: value => (typeof value === 'string' ? value : undefined) })
const name = defineSetting<string>({ key: 'user-info.name', scope: 'person', default: '', parse: value => (typeof value === 'string' ? value : undefined) })

const P1: ProjectRef = { id: 'p1', name: 'One', dir: '/projects/one' }
const P2: ProjectRef = { id: 'p2', name: 'Two', dir: '/projects/two' }

function fresh() {
  const backend = memoryStore()
  return { backend, settings: settingsIn(chainStore([backend])) }
}

test("a setting is its default until it is set, and each scope keeps its own", async () => {
  const { backend, settings } = fresh()
  assert.equal(await settings.get(pace, P1), 6)
  await settings.set(pace, 2, P1)
  await settings.set(editor, 'zed')
  await settings.set(name, 'Ada')
  assert.equal(await settings.get(pace, P1), 2)
  assert.equal(await settings.get(pace, P2), 6, 'another project has its own')
  assert.equal(await settings.get(editor), 'zed')
  assert.equal(await settings.get(name), 'Ada')
  assert.deepEqual(backend.files(projectScope(P1)), { [SETTINGS_FILE]: '{\n  "scheduled-agents.pace": 2\n}\n' })
  assert.deepEqual(Object.keys(backend.files(COMPUTER)), [SETTINGS_FILE])
  assert.deepEqual(Object.keys(backend.files(PERSON)), [SETTINGS_FILE])
  assert.deepEqual(
    backend.saves.map(save => save.message),
    ['setting scheduled-agents.pace', 'setting projects.editor', 'setting user-info.name'],
  )
})

test('a setting kept per project needs its project', async () => {
  const { settings } = fresh()
  await assert.rejects(settings.get(pace), /scheduled-agents.pace is kept per project/)
  await assert.rejects(settings.set(pace, 3), /scheduled-agents.pace is kept per project/)
})

test('a value that is not valid reads as the default, and a broken file as no setting set', async () => {
  const { settings } = fresh()
  const store = chainStore([memoryStore()])
  const broken = settingsIn(store)
  await store.save(projectScope(P1), { [SETTINGS_FILE]: '{"scheduled-agents.pace": -1}' }, 'by hand')
  assert.equal(await broken.get(pace, P1), 6)
  await store.save(projectScope(P1), { [SETTINGS_FILE]: '{ torn' }, 'by hand')
  assert.equal(await broken.get(pace, P1), 6)
  await store.save(projectScope(P1), { [SETTINGS_FILE]: '[1, 2]' }, 'by hand')
  assert.equal(await broken.get(pace, P1), 6)
  await broken.set(pace, 4, P1)
  assert.equal(await broken.get(pace, P1), 4, 'a save writes the file whole again')
  assert.equal(await settings.get(pace, P1), 6)
})

test('two saves of one scope at once keep both settings', async () => {
  const { settings } = fresh()
  const other = defineSetting<string>({ key: 'projects.terminal', scope: 'computer', default: '', parse: value => (typeof value === 'string' ? value : undefined) })
  await Promise.all([settings.set(editor, 'zed'), settings.set(other, 'ghostty')])
  assert.equal(await settings.get(editor), 'zed')
  assert.equal(await settings.get(other), 'ghostty')
})

test("a setting's key is its module's name, a dot, then its own name", () => {
  for (const key of ['tickets', 'Tickets.enabled', 'tickets.', 'tickets..enabled', 'tickets enabled']) {
    assert.throws(() => defineSetting({ key, scope: 'person', default: 0, parse: () => undefined }), /is no setting key/, key)
  }
})

test("a plugin's Enabled row is off unless the distribution starts the plugin on, and only true or false is read", async () => {
  const { settings } = fresh()
  const off = enabledSetting('tickets', 'project', false)
  const on = enabledSetting('ask', 'computer', true)
  assert.equal(off.key, 'tickets.enabled')
  assert.equal(await settings.get(off, P1), false)
  assert.equal(await settings.get(on), true)
  assert.equal(off.parse('yes'), undefined)
  assert.equal(off.parse(false), false)
})

test('on a machine shared by a team, a pick kept per person is each teammate’s own; the owner’s is the machine’s', async () => {
  const store = chainStore([memoryStore()])
  const settings = settingsIn(store)
  const agent = defineSetting<string>({ key: 'agent-driver.picked', scope: 'computer', default: 'claude', perPerson: true, parse: value => (typeof value === 'string' ? value : undefined) })
  let caller: TeamCaller | undefined
  readCallersWith(() => caller)
  try {
    caller = { login: 'suleimansh', owner: true, teamOwner: 'suleimansh' }
    await settings.set(agent, 'codex')
    await settings.set(editor, 'zed')
    caller = { login: 'BrillOut', owner: false, teamOwner: 'suleimansh' }
    assert.equal(await settings.get(agent), 'claude', 'a teammate starts from the default, not the owner’s pick')
    await settings.set(agent, 'claude-opus')
    assert.equal(await settings.get(editor), 'zed', 'a setting not kept per person is the machine’s for everyone')
    caller = undefined
    assert.equal(await settings.get(agent), 'codex', 'with no team, the machine’s')
    assert.deepEqual(JSON.parse((await store.read(COMPUTER, SETTINGS_FILE))!), { 'agent-driver.picked': 'codex', 'agent-driver.picked@brillout': 'claude-opus', 'projects.editor': 'zed' })
  } finally {
    readCallersWith(() => undefined)
  }
})
