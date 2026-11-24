import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PERSON_INFO } from '@openagt/hooks'
import { act, rpcKind, type RpcComputerHost } from '@openagt/hooks/rpc'
import { computerRpcHost } from '@openagt/hooks/testing'
import type { ProfileOutcome } from '@openagt/github'
import { copyFromGitHub, copyingFrom, removePicture, saveName } from './server.js'

// Settings › Profile's functions, against a store kept in memory, GitHub's profile as a test says it.

function computer(): RpcComputerHost {
  return computerRpcHost()
}

const github = (profiles: Record<string, Omit<Extract<ProfileOutcome, { ok: true }>, 'ok'>>) => {
  const asked: string[] = []
  const copy = act(
    copyingFrom(async login => {
      asked.push(login)
      const profile = profiles[login]
      return profile ? { ok: true, ...profile } : { ok: false, reason: 'no-user', detail: `GitHub has no user ${login}` }
    }),
  )
  return { asked, copy }
}

test('each of them changes something, saved with the person', () => {
  for (const fn of [saveName, removePicture, copyFromGitHub]) assert.equal(rpcKind(fn), 'act')
})

test("a name is the person's to set, one line of at most 60 characters; the picture stays, and can go", async () => {
  const host = computer()
  await host.settings.set(PERSON_INFO, { picture: 'https://avatars.example/ada.png' })
  await saveName(host, { name: ' Ada King ' })
  assert.deepEqual(await host.settings.get(PERSON_INFO), { name: 'Ada King', picture: 'https://avatars.example/ada.png' })
  await assert.rejects(saveName(host, { name: 'a\nb' }), /one line of at most 60 characters/)
  await assert.rejects(saveName(host, { name: 7 } as unknown as { name: string }), /one line/)
  await removePicture(host, {})
  assert.deepEqual(await host.settings.get(PERSON_INFO), { name: 'Ada King' })
})

test("a GitHub profile's name and picture are copied once, with the login they came from; a second copy says nothing changed", async () => {
  const host = computer()
  const { asked, copy } = github({ ada: { login: 'ada', name: 'Ada Lovelace', avatar: 'https://avatars.githubusercontent.com/u/1' } })
  assert.deepEqual(await copy(host, { login: '@ada' }), { changed: true, login: 'ada' })
  assert.deepEqual(await host.settings.get(PERSON_INFO), { name: 'Ada Lovelace', picture: 'https://avatars.githubusercontent.com/u/1', github: 'ada' })
  assert.deepEqual(await copy(host, { login: 'ada' }), { changed: false, login: 'ada' })
  assert.deepEqual(asked, ['ada', 'ada'])
  await assert.rejects(copy(host, { login: 'nobody' }), /GitHub has no user nobody/)
  await assert.rejects(copy(host, { login: ' ' }), /Type a GitHub login/)
})

test('a profile with no name keeps the name the person set, and one with no picture on the web keeps theirs', async () => {
  const host = computer()
  await host.settings.set(PERSON_INFO, { name: 'Ada', picture: 'https://avatars.example/ada.png' })
  const { copy } = github({ ada: { login: 'Ada' } })
  assert.deepEqual(await copy(host, { login: 'ada' }), { changed: true, login: 'Ada' })
  assert.deepEqual(await host.settings.get(PERSON_INFO), { name: 'Ada', picture: 'https://avatars.example/ada.png', github: 'Ada' })
})
