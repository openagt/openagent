import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TeamCaller } from '@openagt/hooks'
import { asCaller } from './caller.js'
import { personPreferencesEnv, teamPreferencesStore } from './preferences.js'
import { registryPath } from '../registry.js'
import { onPerson } from '../dashboard-rpc/person.js'

// On a machine shared by a team, how the dashboard looks is each person's own, and the person at
// it is who signed in with GitHub.

const OWNER: TeamCaller = { login: 'suleimansh', owner: true, teamOwner: 'suleimansh' }
const ROM: TeamCaller = { login: 'brillout', name: 'Rom', id: 1005638, avatar: 'https://avatars.githubusercontent.com/u/1005638?v=4', owner: false, teamOwner: 'suleimansh' }

test('each person’s look is their own: the owner keeps the machine’s, a teammate starts from the defaults', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'team-prefs-'))
  try {
    const env = { XDG_CONFIG_HOME: dir }
    const store = teamPreferencesStore(env)
    await asCaller(OWNER, () => store.patch({ theme: 'light' }))
    assert.deepEqual(await asCaller(ROM, () => store.read()), {})
    await asCaller(ROM, () => store.patch({ theme: 'dark' }))
    assert.equal((await asCaller(OWNER, () => store.read())).theme, 'light')
    assert.equal((await store.read()).theme, 'light', 'with no caller, the machine’s')
    assert.equal((await asCaller(ROM, () => store.read())).theme, 'dark')
    assert.equal(JSON.parse(readFileSync(registryPath(personPreferencesEnv(env, 'BrillOut')), 'utf8')).preferences.theme, 'dark')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the person at the dashboard is who signed in, by GitHub’s name and picture', async () => {
  assert.deepEqual(await asCaller(ROM, () => onPerson()), {
    name: 'Rom',
    login: 'brillout',
    email: '1005638+brillout@users.noreply.github.com',
    avatar: 'https://avatars.githubusercontent.com/u/1005638?v=4',
    team: true,
  })
})
