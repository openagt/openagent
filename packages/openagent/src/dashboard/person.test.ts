import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { userInfo } from 'node:os'
import type { GitHostSource } from '../store/git-host.js'
import { asCaller, personAtPage, readPerson } from './person.js'

/** A git host that says `me` is signed in, for the projects named in `at`. */
function hosts(at: Record<string, Awaited<ReturnType<GitHostSource['me']>>>) {
  return async (root: string): Promise<GitHostSource | undefined> =>
    root in at
      ? { requests: async () => ({ ok: true, requests: [] }), open: async () => ({ ok: false, error: 'no' }), merge: async () => ({ ok: false, error: 'no' }), home: async () => undefined, me: async () => at[root] }
      : undefined
}

test('the person is git\'s name, with the picture of the first project that has a git host', async () => {
  const person = await readPerson({
    gitName: async () => 'Suleiman Shahbari',
    projects: async () => ['/plain', '/github', '/other'],
    gitHost: hosts({ '/github': { login: 'suleimansh', name: 'Suleiman S', avatar: 'https://avatars.githubusercontent.com/u/1' }, '/other': { login: 'someone-else' } }),
  })
  assert.deepEqual(person, { name: 'Suleiman Shahbari', login: 'suleimansh', avatar: 'https://avatars.githubusercontent.com/u/1' })
})

test('nobody signed in at the first git host (no gh, say): no picture, and no other project is asked', async () => {
  const asked: string[] = []
  const counting = hosts({ '/a': undefined, '/b': { login: 'never-asked' } })
  const person = await readPerson({
    gitName: async () => 'Suleiman Shahbari',
    projects: async () => ['/a', '/b'],
    gitHost: async root => (asked.push(root), counting(root)),
  })
  assert.deepEqual(person, { name: 'Suleiman Shahbari' })
  assert.deepEqual(asked, ['/a'])
})

test('with no git name, the git host\'s name, then the login; with no git host either, this computer\'s user', async () => {
  const github = hosts({ '/github': { login: 'suleimansh', name: 'Suleiman S' } })
  assert.deepEqual(await readPerson({ gitName: async () => undefined, projects: async () => ['/github'], gitHost: github }), { name: 'Suleiman S', login: 'suleimansh' })
  assert.deepEqual(await readPerson({ gitName: async () => undefined, projects: async () => ['/github'], gitHost: hosts({ '/github': { login: 'suleimansh' } }) }), { name: 'suleimansh', login: 'suleimansh' })
  assert.deepEqual(await readPerson({ gitName: async () => undefined, projects: async () => [], gitHost: github }), { name: userInfo().username })
})

test('a page another person\'s device opened shows that person, by the account the door said; the computer\'s own person otherwise', async () => {
  const own = { name: 'Ada Lovelace', login: 'Ada', avatar: 'https://example.com/ada.png' }
  assert.deepEqual(await asCaller(undefined, async () => personAtPage(own)), own)
  assert.deepEqual(await asCaller('ada', async () => personAtPage(own)), own, 'the owner\'s own device')
  assert.deepEqual(await asCaller('rom', async () => personAtPage(own)), { name: 'rom', login: 'rom', avatar: 'https://github.com/rom.png' })
  // What is no account a door writes is no person: the page shows the computer's own.
  for (const said of ['Rom', 'rom/../x', ['rom', 'eve'], '']) assert.deepEqual(await asCaller(said, async () => personAtPage(own)), own)
  assert.deepEqual(personAtPage(own), own, 'outside a call')
})
