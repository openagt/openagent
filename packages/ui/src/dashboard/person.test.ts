import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { userInfo } from 'node:os'
import { readPerson } from './person.js'

test("the person is their own: name, picture and the GitHub login they were copied from, and git's email; no git host is asked", async () => {
  const person = await readPerson({ info: async () => ({ name: 'Suleiman Shahbari', picture: 'https://avatars.githubusercontent.com/u/1', login: 'suleimansh' }), gitName: async () => assert.fail('git is not asked'), gitEmail: async () => 'suleiman@averotech.com' })
  assert.deepEqual(person, { name: 'Suleiman Shahbari', email: 'suleiman@averotech.com', avatar: 'https://avatars.githubusercontent.com/u/1', login: 'suleimansh', own: true })
})

test("with no name set, git's name, else this computer's user; a picture of their own still shows; git's email when it has one", async () => {
  assert.deepEqual(await readPerson({ info: async () => ({}), gitName: async () => 'Suleiman Shahbari', gitEmail: async () => 'suleiman@averotech.com' }), { name: 'Suleiman Shahbari', email: 'suleiman@averotech.com' })
  assert.deepEqual(await readPerson({ info: async () => ({}), gitName: async () => undefined, gitEmail: async () => undefined }), { name: userInfo().username })
  assert.deepEqual(await readPerson({ info: async () => ({ picture: 'https://avatars.githubusercontent.com/u/1' }), gitName: async () => 'Suleiman', gitEmail: async () => undefined }), { name: 'Suleiman', avatar: 'https://avatars.githubusercontent.com/u/1' })
  // A store that cannot be read is none set.
  assert.deepEqual(await readPerson({ info: async () => Promise.reject(new Error('No store keeps the person data')), gitName: async () => 'Suleiman', gitEmail: async () => undefined }), { name: 'Suleiman' })
})
