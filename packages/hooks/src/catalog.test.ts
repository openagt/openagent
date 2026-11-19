import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PERSON, SETTINGS_FILE, chainStore, settingsIn } from './index.js'
import { DEFAULT_PRESET, PERSON_INFO, PRESETS, isPersonName, isPresetName, presetIdOf, presetOf, presetsIn } from './catalog.js'
import { memoryStore } from './testing.js'

test("the person's name and picture: saved with the person, each part read strictly, and none set is the computer's", async () => {
  const store = chainStore([memoryStore()])
  const settings = settingsIn(store)
  assert.deepEqual(await settings.get(PERSON_INFO), {})
  await settings.set(PERSON_INFO, { name: 'Ada Lovelace', picture: 'https://avatars.example/ada.png', github: 'ada' })
  assert.deepEqual(await settings.get(PERSON_INFO), { name: 'Ada Lovelace', picture: 'https://avatars.example/ada.png', github: 'ada' })
  assert.match((await store.read(PERSON, SETTINGS_FILE)) ?? '', /"user-info\.person"/)

  // Only a picture on the web, and a name that is one line: what is not valid goes, the rest stays.
  const saved = (value: unknown) => store.save(PERSON, { [SETTINGS_FILE]: JSON.stringify({ 'user-info.person': value }) }, 'by hand')
  await saved({ name: ' Ada ', picture: 'file:///etc/passwd' })
  assert.deepEqual(await settings.get(PERSON_INFO), { name: 'Ada' })
  await saved({ name: 'a\nb', picture: 'https://avatars.example/ada.png' })
  assert.deepEqual(await settings.get(PERSON_INFO), { picture: 'https://avatars.example/ada.png' })
  await saved('Ada')
  assert.deepEqual(await settings.get(PERSON_INFO), {})
  assert.equal(isPersonName('x'.repeat(61)), false)
})

test('the presets: saved with the person, Default first and built in until changed, each read strictly; a preset not there is Default', async () => {
  const store = chainStore([memoryStore()])
  const settings = settingsIn(store)
  assert.deepEqual(presetsIn(await settings.get(PRESETS)), [{ id: DEFAULT_PRESET, name: 'Default', options: {} }])
  const reviewer = { id: 'reviewer', name: 'Reviewer', options: { github: { account: 'ada-agent' }, 'agent-driver': { claude: ['Work'] }, skills: { project: 'none' as const } } }
  const writer = { id: 'writer', name: 'Writer', options: {} }
  await settings.set(PRESETS, [writer, reviewer, { id: DEFAULT_PRESET, name: 'Default', options: { 'agent-driver': { codex: ['Home'] } } }])
  const all = presetsIn(await settings.get(PRESETS))
  assert.deepEqual(all.map(preset => preset.id), [DEFAULT_PRESET, 'reviewer', 'writer'])
  assert.deepEqual(all[0]?.options, { 'agent-driver': { codex: ['Home'] } }, 'Default as it was changed')
  assert.deepEqual(presetOf(all, 'reviewer'), reviewer)
  assert.equal(presetOf(all, 'gone').id, DEFAULT_PRESET)
  assert.equal(presetOf(all, undefined).id, DEFAULT_PRESET)

  // What is not a preset, or not an option one holds, is left out.
  await store.save(PERSON, { [SETTINGS_FILE]: JSON.stringify({ 'presets.saved': [{ id: 'Bad Id', name: 'x', options: {} }, { id: 'ok', name: ' Ok ', options: { github: { account: 7 }, model: 'x', skills: { project: ['a', 3] } } }] }) }, 'by hand')
  assert.deepEqual(await settings.get(PRESETS), [{ id: 'ok', name: 'Ok', options: {} }])
  assert.equal(presetIdOf(' Social Media! '), 'social-media')
  assert.deepEqual([isPresetName('Reviewer'), isPresetName('!!!'), isPresetName('x'.repeat(41))], [true, false, false])
})
