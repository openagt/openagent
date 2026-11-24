import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PICKED_PROFILE, PROFILES } from '@openagt/hooks'
import { rpcKind, type RpcComputerHost } from '@openagt/hooks/rpc'
import { memorySettings } from '@openagt/hooks/testing'
import { pickProfile, profiles, removeProfile, saveProfile } from './server.js'

// The profiles' functions, against a store kept in memory.

function computer(): RpcComputerHost {
  return { settings: memorySettings() }
}

test('the list only reads; every other function changes something', () => {
  assert.equal(rpcKind(profiles), 'read')
  for (const fn of [saveProfile, removeProfile, pickProfile]) assert.equal(rpcKind(fn), 'act')
})

test('a profile saved, edited and removed, Default never; a name taken or that gives no id is refused, naming the field', async () => {
  const host = computer()
  assert.deepEqual(await profiles(host, {}), { profiles: [{ id: 'default', name: 'Default', options: {} }], picked: 'default' })

  // Saved under the id its name gives, with the person, its options as the modules' controls wrote them; a profile of its own is never one.
  const options = { github: { account: 'octo-agent' }, 'agent-driver': { claude: ['Dani'] }, skills: { project: 'none' as const } }
  assert.deepEqual(await saveProfile(host, { name: ' Social Media ', options: { ...options, profiles: { profile: 'x' } } }), { ok: true, id: 'social-media' })
  assert.deepEqual(await host.settings.get(PROFILES), [{ id: 'social-media', name: 'Social Media', options }])
  assert.deepEqual(await saveProfile(host, { name: 'social media!', options: {} }), { ok: false, error: 'There is a profile Social Media already: pick another name.', field: 'name' })
  assert.deepEqual((await profiles(host, {})).profiles.map(profile => profile.id), ['default', 'social-media'])

  // Edited under its own id, renamed too; Default keeps its name.
  assert.deepEqual(await saveProfile(host, { id: 'social-media', name: 'Social', options: { plugins: { without: ['logs', 'ask'] } } }), { ok: true, id: 'social-media' })
  assert.deepEqual((await profiles(host, {})).profiles[1], { id: 'social-media', name: 'Social', options: { plugins: { without: ['logs', 'ask'] } } })
  assert.deepEqual(await saveProfile(host, { id: 'default', name: 'Default', options: { github: { account: 'octo' } } }), { ok: true, id: 'default' })
  assert.deepEqual((await profiles(host, {})).profiles[0], { id: 'default', name: 'Default', options: { github: { account: 'octo' } } })
  assert.deepEqual(await saveProfile(host, { id: 'default', name: 'Boss', options: {} }), { ok: false, error: 'Default keeps its name.', field: 'name' })
  assert.deepEqual(await saveProfile(host, { name: 'Default', options: {} }), { ok: false, error: 'There is a profile Default already: pick another name.', field: 'name' })
  assert.match((await saveProfile(host, { id: 'gone', name: 'Gone', options: {} }) as { error: string }).error, /gone/)
  assert.deepEqual(await saveProfile(host, { name: '!!!', options: {} }), { ok: false, error: 'A profile needs a name of a few words: letters and digits, at most 40 characters.', field: 'name' })

  assert.deepEqual(await removeProfile(host, { id: 'social-media' }), { ok: true })
  assert.deepEqual((await profiles(host, {})).profiles.map(profile => profile.id), ['default'])
  assert.equal((await removeProfile(host, { id: 'default' })).ok, false)
  assert.equal((await removeProfile(host, { id: '../x' })).ok, false)
})

test('the profile picked for every next run is saved on the computer; Default picks none, and a pick of a profile removed is Default', async () => {
  const host = computer()
  await saveProfile(host, { name: 'Reviewer', options: {} })
  assert.deepEqual(await pickProfile(host, { id: 'reviewer' }), { ok: true })
  assert.equal(await host.settings.get(PICKED_PROFILE), 'reviewer')
  assert.equal((await profiles(host, {})).picked, 'reviewer')
  assert.deepEqual(await pickProfile(host, { id: 'nobody' }), { ok: false, error: 'That profile is gone.' })
  assert.equal((await pickProfile(host, { id: 'Not An Id' })).ok, false)

  await removeProfile(host, { id: 'reviewer' })
  assert.equal((await profiles(host, {})).picked, 'default', 'the pick of a profile removed is Default')
  await pickProfile(host, { id: 'default' })
  assert.equal(await host.settings.get(PICKED_PROFILE), undefined)
})
