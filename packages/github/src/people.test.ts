import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { keptPeople, MAX_PEOPLE, type GitHubPerson } from './people.js'

const HOUR = 60 * 60_000
const ROM: GitHubPerson = { email: 'rom@y.dev', login: 'rom', avatar: 'https://avatars.githubusercontent.com/u/1' }

/** GitHub as it knows one account, counting the emails it is asked. */
function knowingRom(asked: string[][]) {
  return async (_dir: string, emails: string[]) => {
    asked.push([...emails])
    return emails.includes('rom@y.dev') ? [ROM] : []
  }
}

test("the accounts behind a repository's emails, what GitHub said of each kept a day, a miss too", async () => {
  const asked: string[][] = []
  let now = 1_000_000
  const people = keptPeople(knowingRom(asked), () => now)
  assert.deepEqual(await people('/repos/p1', ['rom@y.dev', 'nobody@z.dev']), [ROM])
  // Asked again within the day: GitHub is not.
  now += 23 * HOUR
  assert.deepEqual((await people('/repos/p1', ['ROM@y.dev', 'nobody@z.dev'])).map(person => person.login), ['rom'])
  assert.deepEqual(asked, [['rom@y.dev', 'nobody@z.dev']])
  // Another repository is its own; a day later GitHub is asked again.
  await people('/repos/p2', ['rom@y.dev'])
  now += 2 * HOUR
  await people('/repos/p1', ['rom@y.dev'])
  assert.deepEqual(asked, [['rom@y.dev', 'nobody@z.dev'], ['rom@y.dev'], ['rom@y.dev']])
})

test('GitHub not answering keeps nothing, so it is asked again; what is no email is not asked; many are asked a few at a time', async () => {
  const asked: string[][] = []
  let failing = true
  const people = keptPeople(async (dir, emails) => (failing ? Promise.reject(new Error('offline')) : knowingRom(asked)(dir, emails)))
  assert.deepEqual(await people('/repos/p3', ['rom@y.dev']), [])
  failing = false
  assert.deepEqual(await people('/repos/p3', ['rom@y.dev', 'not an email']), [ROM])
  assert.deepEqual(asked, [['rom@y.dev']])
  const many = Array.from({ length: MAX_PEOPLE + 1 }, (_, at) => `p${at}@x.dev`)
  await people('/repos/p3', many)
  assert.deepEqual(asked.slice(1).map(some => some.length), [MAX_PEOPLE, 1])
})
