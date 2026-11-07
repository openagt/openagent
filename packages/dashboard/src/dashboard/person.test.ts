import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { userInfo } from 'node:os'
import { asCaller, personAtPage, readPerson } from './person.js'

test("the person is their own record: name, picture and the GitHub login they were copied from; no git host is asked", async () => {
  const person = await readPerson({ record: async () => ({ name: 'Suleiman Shahbari', picture: 'https://avatars.githubusercontent.com/u/1', github: 'suleimansh' }), gitName: async () => assert.fail('git is not asked') })
  assert.deepEqual(person, { name: 'Suleiman Shahbari', avatar: 'https://avatars.githubusercontent.com/u/1', github: 'suleimansh', own: true })
})

test("with no record, git's name, else this computer's user; no picture", async () => {
  assert.deepEqual(await readPerson({ record: async () => undefined, gitName: async () => 'Suleiman Shahbari' }), { name: 'Suleiman Shahbari' })
  assert.deepEqual(await readPerson({ record: async () => undefined, gitName: async () => undefined }), { name: userInfo().username })
})

test('a page another person\'s device opened shows that person, by the name the door said; the computer\'s own person otherwise', async () => {
  const own = { name: 'Ada Lovelace', github: 'Ada', avatar: 'https://example.com/ada.png' }
  assert.deepEqual(await asCaller(undefined, async () => personAtPage(own)), own, 'the owner\'s own device: the door says nobody')
  assert.deepEqual(await asCaller('Rom%20Brillout', async () => personAtPage(own)), { name: 'Rom Brillout' })
  assert.deepEqual(await asCaller('%D7%A8%D7%95%D7%9D', async () => personAtPage(own)), { name: 'רום' })
  // A word that is no name, or no word, is nobody: the page is the computer's own.
  for (const said of ['Rom%0AX', '%E0%A4%A', '<rom>', ['rom', 'eve'], '']) assert.deepEqual(await asCaller(said, async () => personAtPage(own)), own)
  assert.deepEqual(personAtPage(own), own, 'outside a call')
})
