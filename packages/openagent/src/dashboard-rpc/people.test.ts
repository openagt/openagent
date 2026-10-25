import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { GitHostSource } from '../store/git-host.js'
import { onGitHostPeople } from './people.js'

const HOUR = 60 * 60_000

/** A git host that knows one account, counting the emails it is asked. */
function host(asked: string[][]): GitHostSource {
  return {
    requests: async () => ({ ok: true, requests: [] }),
    open: async () => ({ ok: false, error: 'no' }),
    merge: async () => ({ ok: false, error: 'no' }),
    home: async () => undefined,
    me: async () => undefined,
    people: async emails => {
      asked.push([...emails])
      return emails.includes('rom@y.dev') ? [{ email: 'rom@y.dev', login: 'rom', avatar: 'https://avatars.githubusercontent.com/u/1' }] : []
    },
  }
}

test("the git host's accounts behind a project's emails, what it said of each kept a day, a miss too", async () => {
  const asked: string[][] = []
  let now = 1_000_000
  const deps = { gitHost: async () => host(asked), now: () => now, resolve: async (id: string) => `/repos/${id}` }
  assert.deepEqual(await onGitHostPeople('p1', ['rom@y.dev', 'nobody@z.dev'], deps), [{ email: 'rom@y.dev', login: 'rom', avatar: 'https://avatars.githubusercontent.com/u/1' }])
  // Asked again within the day: the host is not.
  now += 23 * HOUR
  assert.deepEqual((await onGitHostPeople('p1', ['ROM@y.dev', 'nobody@z.dev'], deps)).map(person => person.login), ['rom'])
  assert.deepEqual(asked, [['rom@y.dev', 'nobody@z.dev']])
  // Another project is its own; a day later the host is asked again.
  await onGitHostPeople('p2', ['rom@y.dev'], deps)
  now += 2 * HOUR
  await onGitHostPeople('p1', ['rom@y.dev'], deps)
  assert.deepEqual(asked, [['rom@y.dev', 'nobody@z.dev'], ['rom@y.dev'], ['rom@y.dev']])
})

test('no git host, or no such project: nobody, and nothing kept', async () => {
  const asked: string[][] = []
  assert.deepEqual(await onGitHostPeople('p3', ['rom@y.dev'], { gitHost: async () => undefined, resolve: async () => '/repos/p3' }), [])
  assert.deepEqual(await onGitHostPeople('p3', ['rom@y.dev'], { gitHost: async () => host(asked), resolve: async () => '/repos/p3' }), [{ email: 'rom@y.dev', login: 'rom', avatar: 'https://avatars.githubusercontent.com/u/1' }])
  assert.deepEqual(await onGitHostPeople('gone', ['rom@y.dev'], { gitHost: async () => host(asked), resolve: async () => undefined }), [])
})
