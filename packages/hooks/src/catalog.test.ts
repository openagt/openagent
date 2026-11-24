import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { COMPUTER, PERSON, SETTINGS_FILE, chainStore, settingsIn } from './index.js'
import { DEFAULT_PROFILE, PERSON_INFO, PROFILES, SCHEDULED_COMMANDS, START_FROM, isPersonName, isProfileName, profileIdOf, profileOf, profilesIn } from './catalog.js'
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

test('the profiles: saved with the person, Default first and built in until changed, each module slice kept, the ones the engine takes read strictly; a profile not there is Default', async () => {
  const store = chainStore([memoryStore()])
  const settings = settingsIn(store)
  assert.deepEqual(profilesIn(await settings.get(PROFILES)), [{ id: DEFAULT_PROFILE, name: 'Default', options: {} }])
  const reviewer = { id: 'reviewer', name: 'Reviewer', options: { github: { account: 'ada-agent', prBase: 'develop' }, 'agent-driver': { claude: ['Work'], model: 'claude-opus-5-5', effort: 'high' }, skills: { project: 'none' as const }, plugins: { without: ['logs', 'tickets'] } } }
  const writer = { id: 'writer', name: 'Writer', options: {} }
  await settings.set(PROFILES, [writer, reviewer, { id: DEFAULT_PROFILE, name: 'Default', options: { 'agent-driver': { codex: ['Home'] } } }])
  const all = profilesIn(await settings.get(PROFILES))
  assert.deepEqual(all.map(profile => profile.id), [DEFAULT_PROFILE, 'reviewer', 'writer'])
  assert.deepEqual(all[0]?.options, { 'agent-driver': { codex: ['Home'] } }, 'Default as it was changed')
  assert.deepEqual(profileOf(all, 'reviewer'), reviewer)
  assert.equal(profileOf(all, 'gone').id, DEFAULT_PROFILE)
  assert.equal(profileOf(all, undefined).id, DEFAULT_PROFILE)

  // What is not a profile, or not an option one holds, is left out.
  await store.save(PERSON, { [SETTINGS_FILE]: JSON.stringify({ 'profiles.saved': [{ id: 'Bad Id', name: 'x', options: {} }, { id: 'ok', name: ' Ok ', options: { github: { account: 7 }, model: 'x', skills: { project: ['a', 3] }, plugins: { without: ['Not A Plugin'] } } }, { id: 'quiet', name: 'Quiet', options: { plugins: { without: ['logs', 'Not A Plugin'] } } }] }) }, 'by hand')
  assert.deepEqual(await settings.get(PROFILES), [{ id: 'ok', name: 'Ok', options: {} }, { id: 'quiet', name: 'Quiet', options: { plugins: { without: ['logs'] } } }])
  assert.equal(profileIdOf(' Social Media! '), 'social-media')
  assert.deepEqual([isProfileName('Reviewer'), isProfileName('!!!'), isProfileName('x'.repeat(41))], [true, false, false])
})

test("the scheduled commands a computer runs: kept on the computer, by project then command, each with its switch and pace read strictly; one with neither is none", async () => {
  const store = chainStore([memoryStore()])
  const settings = settingsIn(store)
  assert.deepEqual(await settings.get(SCHEDULED_COMMANDS), {})
  const picks = { 'shop-1a2b': { 'work-queue': { on: '2026-10-03T08:00:00.000Z', pace: { work: true as const } }, 'update-tickets': { pace: { every: '1d', at: '10:00', since: '2026-10-03T08:00:00.000Z' } } } }
  await settings.set(SCHEDULED_COMMANDS, picks)
  assert.deepEqual(await settings.get(SCHEDULED_COMMANDS), picks)
  assert.match((await store.read(COMPUTER, SETTINGS_FILE)) ?? '', /"scheduled-agents\.commands"/)

  const saved = (value: unknown) => store.save(COMPUTER, { [SETTINGS_FILE]: JSON.stringify({ 'scheduled-agents.commands': value }) }, 'by hand')
  await saved({ shop: { 'work-queue': { on: 'yesterday', pace: { every: 6 } }, triage: { on: '2026-10-03T08:00:00.000Z', pace: 'often' } }, empty: { tidy: {} }, other: 'on' })
  assert.deepEqual(await settings.get(SCHEDULED_COMMANDS), { shop: { triage: { on: '2026-10-03T08:00:00.000Z' } } })
  await saved([])
  assert.deepEqual(await settings.get(SCHEDULED_COMMANDS), {})
})

test('where every next run of a project starts, by its id: the local branch or a branch of origin’s, the main branch being no entry; a pick that is not one is dropped', () => {
  const local = { kind: 'local' }
  const published = { kind: 'published', branch: 'local' }
  assert.deepEqual(START_FROM.parse({ 'app-1a2b': local, 'web-3c4d': 'main', '': local, 'api-5e6f': true }), { 'app-1a2b': local })
  assert.deepEqual(START_FROM.parse({ 'app-1a2b': published, 'web-3c4d': local }), { 'app-1a2b': published, 'web-3c4d': local }, 'a branch literally named local is no local pick')
  assert.deepEqual(START_FROM.parse({ 'app-1a2b': 'local' }), {}, 'a bare word is no pick')
  assert.deepEqual(START_FROM.parse({ a: { kind: 'published' }, b: { kind: 'published', branch: '--upload-pack=x' }, c: { kind: 'published', branch: 'a b' }, d: { kind: 'main' } }), {}, 'a pick names a branch')
  assert.equal(START_FROM.parse(['app-1a2b']), undefined)
  assert.equal(START_FROM.parse('local'), undefined)
  const many = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`p-${i}`, local]))
  assert.equal(Object.keys(START_FROM.parse(many) ?? {}).length, 200, 'bounded')
})
