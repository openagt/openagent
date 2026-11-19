import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PERSON, SETTINGS_FILE, chainStore, settingsIn } from './index.js'
import { PERSON_INFO, isPersonName } from './catalog.js'
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
