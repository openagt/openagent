import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProvidedCommand } from '@openagt/agent-data'
import { loginsWiring } from './logins.js'
import { provideTestContext } from './test-context.js'
import { onPerson, sendRemovePersonPicture, sendSavePersonName, sendSyncPersonFromGitHub } from './person.js'
import type { Person } from './person.js'

// The person's own name and picture through the dashboard's calls: the personal folder under a temp
// $XDG_CONFIG_HOME, GitHub's profile as the host's package would answer it.

async function withComputer(body: (asked: string[][], folder: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-person-rpc-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true })
  const before = { ...loginsWiring }
  provideTestContext({ quota: { read: async () => ({ windows: [] }), stop: () => {} } })
  const asked: string[][] = []
  Object.assign(loginsWiring, {
    home: () => dir,
    gitHost: async () => ({ package: '@openagt/skill-github', command: 'github', dir }) as unknown as ProvidedCommand,
    run: async (_root: string, _command: ProvidedCommand, args: readonly string[]) => {
      asked.push([...args])
      if (args[0] === 'accounts') return { ok: true, output: { ok: true, host: 'github.com', name: 'GitHub', requestWord: 'pull request', logo: '<svg/>', tool: 'gh', installed: true, install: 'brew install gh', accounts: [] } }
      if (args[0] === 'profile' && args[1] === 'ada') return { ok: true, output: { ok: true, login: 'ada', name: 'Ada Lovelace', avatar: 'https://avatars.githubusercontent.com/u/1' } }
      return { ok: false, error: `GitHub has no user ${args[1]}` }
    },
  })
  try {
    await body(asked, join(process.env.XDG_CONFIG_HOME, 'openagent'))
  } finally {
    Object.assign(loginsWiring, before)
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

test('Sync from GitHub copies the profile into the person\'s own record once; after that, the person is read with no git host asked', () =>
  withComputer(async (asked, folder) => {
    // The email is this computer's git's, whatever it is here: what the record holds is the point.
    const said = async (): Promise<Omit<Person, 'email'>> => {
      const { email: _email, ...rest } = await onPerson()
      return rest
    }
    assert.equal((await onPerson()).own, undefined, 'none set yet: the computer\'s name')
    assert.deepEqual(await sendSyncPersonFromGitHub('@ada'), { ok: true, changed: true, login: 'ada' })
    assert.deepEqual(asked.filter(args => args[0] === 'profile'), [['profile', 'ada']])
    assert.deepEqual(JSON.parse(readFileSync(join(folder, 'person.json'), 'utf8')), { name: 'Ada Lovelace', picture: 'https://avatars.githubusercontent.com/u/1', github: 'ada' })
    asked.length = 0
    assert.deepEqual(await said(), { name: 'Ada Lovelace', avatar: 'https://avatars.githubusercontent.com/u/1', github: 'ada', own: true })
    assert.deepEqual(asked, [], 'nothing is read live from GitHub')

    // The name is the person's to change; the picture stays, and can go.
    assert.deepEqual(await sendSavePersonName('Ada King'), { ok: true })
    assert.deepEqual(await said(), { name: 'Ada King', avatar: 'https://avatars.githubusercontent.com/u/1', github: 'ada', own: true })
    assert.deepEqual(await sendRemovePersonPicture(), { ok: true })
    assert.deepEqual(await said(), { name: 'Ada King', github: 'ada', own: true })
    assert.equal((await sendSavePersonName('a\nb')).ok, false)
    assert.deepEqual(await sendSyncPersonFromGitHub('nobody'), { ok: false, error: 'GitHub has no user nobody' })
  }))
