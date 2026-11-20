import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { CodexLoginOptions } from './codex-accounts.js'
import { accountFolder, codexAccountsDir } from './codex-accounts.js'
import { codexLogins } from './logins.js'

// Codex's accounts (`RunAgent.accounts`): its own login and who it is, a new one signed in in a
// folder of its own, one already on the list refused, how full each login is, and its logout.
// Never the real `codex`: it would log this computer's person out.

const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const OWN = { name: 'This computer' }

async function inDir(body: (env: NodeJS.ProcessEnv, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'codex-logins-'))
  try {
    await body({ HOME: join(dir, 'home'), XDG_STATE_HOME: join(dir, 'state') }, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test("the person's own login is there from the environment or the login in their Codex home, and goes by the name Codex keeps", () =>
  inDir(async env => {
    const own = join(env['HOME']!, '.codex')
    const logins = codexLogins({ who: home => Promise.resolve(home === own ? { name: 'Ada', key: 'ada/ws' } : {}) })
    assert.deepEqual([logins.list, logins.service], ['codex', 'Codex'])
    assert.equal(logins.ownLoginThere(env), false)
    assert.equal(logins.ownLoginThere({ ...env, CODEX_API_KEY: 'given' }), true)
    await mkdir(own, { recursive: true })
    await writeFile(join(own, 'auth.json'), '{}')
    assert.equal(logins.ownLoginThere(env), true)
    assert.equal(await logins.ownName(env), 'Ada')
    assert.equal(logins.ownLoginThere({ ...env, CODEX_HOME: join(env['HOME']!, 'other') }), false, 'Codex keeps it where CODEX_HOME says')
  }))

test('a new account signs in in a folder of its own: the page to copy where this computer has a browser, a code to type where it has none', () =>
  inDir(async env => {
    const asked: CodexLoginOptions[] = []
    const logins = codexLogins({ login: opts => (asked.push(opts), Promise.resolve({ ok: true, login: 'codex-new', who: {} })) })
    const onUrl = (): void => {}
    const onCode = (): void => {}
    assert.deepEqual(await logins.signIn([], { onUrl }, env), { ok: true, login: 'codex-new' })
    assert.deepEqual(await logins.signIn([], { onLink: () => {}, onRefused: () => {}, onCode }, env), { ok: true, login: 'codex-new' })
    assert.deepEqual(asked, [
      { dir: codexAccountsDir(env), onUrl },
      { dir: codexAccountsDir(env), onCode },
    ])
    assert.equal(logins.isSignInCode('any-code-at-all'), false, 'no code is ever brought back to Codex')
  }))

test('an account on the list already is refused, leaving no folder, in words for where the person signs in', () =>
  inDir(async env => {
    const dir = codexAccountsDir(env)
    const dani = { name: 'Dani', login: 'codex-dani' }
    const logins = codexLogins({
      login: async () => {
        await mkdir(join(dir, 'codex-new'), { recursive: true })
        return { ok: true, login: 'codex-new', who: { key: 'same/ws' } }
      },
      who: home => Promise.resolve(home === accountFolder(dani, env) ? { key: 'same/ws' } : { key: 'own/ws' }),
    })
    const here = await logins.signIn([OWN, dani], { onUrl: () => {} }, env)
    assert.equal(here.ok, false)
    assert.match(!here.ok ? here.error : '', /on the list already.*copy the link into a private window/)
    await assert.rejects(stat(join(dir, 'codex-new')))
    const elsewhere = await logins.signIn([OWN, dani], { onCode: () => {} }, env)
    assert.match(!elsewhere.ok ? elsewhere.error : '', /on the list already.*open the page in a private window/)
    assert.deepEqual(await logins.signIn([OWN], { onUrl: () => {} }, env), { ok: true, login: 'codex-new' }, 'only the list it is added to')
  }))

test("a sign-in that did not go through says why; taking an added account off takes its folder, its login in it, and the person's own is never touched", () =>
  inDir(async env => {
    const logins = codexLogins({ login: () => Promise.resolve({ ok: false, error: 'Nobody signed in in time.' }) })
    assert.deepEqual(await logins.signIn([], {}, env), { ok: false, error: 'Nobody signed in in time.' })
    const dani = { name: 'Dani', login: 'codex-dani' }
    await mkdir(accountFolder(dani, env), { recursive: true })
    await writeFile(join(accountFolder(dani, env), 'auth.json'), '{}')
    await logins.forget(dani, env)
    await assert.rejects(stat(accountFolder(dani, env)))
    await logins.forget(OWN, env)
  }))

test('every login is read now, from its home, and one nobody is signed in to is not asked', () =>
  inDir(async env => {
    const dani = { name: 'Dani', login: 'codex-dani' }
    const asked: string[] = []
    const logins = codexLogins({
      who: home => Promise.resolve(home === accountFolder(dani, env) ? { key: 'dani/ws' } : {}),
      usage: home => {
        asked.push(home)
        return Promise.resolve([{ window: 'thirty_day', percentUsed: 10, resetsAt: NOW + HOUR }])
      },
    })
    assert.equal(await logins.usage(OWN, env), undefined)
    assert.deepEqual(await logins.usage(dani, env), [{ window: 'thirty_day', percentUsed: 10, resetsAt: NOW + HOUR }])
    assert.deepEqual(asked, [accountFolder(dani, env)])
    const broke = codexLogins({ who: () => Promise.resolve({ name: 'Ada' }), usage: () => Promise.reject(new Error('no Codex here')) })
    assert.equal(await broke.usage(OWN, env), undefined)
  }))

test("logout is Codex's own, of the person's own home, in the user's environment", () =>
  inDir(async (env, dir) => {
    const bin = join(dir, 'bin')
    await mkdir(bin, { recursive: true })
    const calls = join(dir, 'calls')
    const home = join(dir, 'codex-home')
    // A stand-in: never the real command, which would log this computer's person out.
    await writeFile(join(bin, 'codex'), `#!/bin/sh\necho "codex $* home=$CODEX_HOME" >> "${calls}"\nexit 0\n`, { mode: 0o755 })
    await codexLogins().logOut({ ...env, PATH: `${bin}:${process.env['PATH']}`, CODEX_HOME: home })
    assert.deepEqual((await readFile(calls, 'utf8')).trim().split('\n'), [`codex logout home=${home}`])
  }))
