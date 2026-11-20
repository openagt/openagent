import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { DriverQuota } from '@openagt/hooks'
import type { MintOptions } from './claude-login.js'
import { claudeLogins, claudeUsagePath, keepClaudeReading, READING_KEPT_MS } from './logins.js'

// Claude Code's accounts (`RunAgent.accounts`): its own login and who it is, a new one signed in
// with `claude setup-token`, how full the own one is through `/usage`, kept for everyone a while,
// and its logout. Never the real `claude`: it would log this computer's person out.

const NOW = 1_800_000_000_000
const OWN = { name: 'This computer' }
const ADDED = { name: 'Work', login: 'sk-ant-oat01-secret' }

const READING: DriverQuota = {
  available: true,
  windows: [
    { label: 'Current week (all models)', kind: 'week', percentUsed: 12 },
    { label: 'Current session', kind: 'session', percentUsed: 2 },
    { label: 'Current week (Opus)', kind: 'week-model', percentUsed: 90 },
  ],
}

async function inDir(body: (env: NodeJS.ProcessEnv, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-logins-'))
  try {
    await body({ HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config') }, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Claude Code's own file, as it keeps the person's account after a browser login. */
async function signedInAs(env: NodeJS.ProcessEnv, account: Record<string, string>): Promise<void> {
  await mkdir(env['HOME']!, { recursive: true })
  await writeFile(join(env['HOME']!, '.claude.json'), JSON.stringify({ oauthAccount: account }))
}

/** The accounts, counting the reads of `/usage`. */
function counted(quota: () => Promise<DriverQuota> = () => Promise.resolve(READING), now: () => number = () => NOW) {
  let reads = 0
  const logins = claudeLogins({
    now,
    quota: () => {
      reads += 1
      return quota()
    },
  })
  return { logins, reads: () => reads }
}

test("the person's own login is there from the environment or Claude Code's own file, and goes by the name the file says: its display name, else its email", () =>
  inDir(async env => {
    const logins = claudeLogins()
    assert.deepEqual([logins.list, logins.service], ['claude', 'Claude'])
    assert.equal(logins.ownLoginThere(env), false)
    assert.equal(await logins.ownName(env), undefined)
    assert.equal(logins.ownLoginThere({ ...env, CLAUDE_CODE_OAUTH_TOKEN: 'given' }), true)
    await signedInAs(env, { displayName: ' Ada ', emailAddress: 'ada@example.com' })
    assert.equal(logins.ownLoginThere(env), true)
    assert.equal(await logins.ownName(env), 'Ada')
    await signedInAs(env, { displayName: ' ', emailAddress: 'ada@example.com' })
    assert.equal(await logins.ownName(env), 'ada@example.com')
    assert.equal(await logins.ownName({ ...env, CLAUDE_CONFIG_DIR: join(env['HOME']!, 'elsewhere') }), undefined, 'Claude Code keeps it where CLAUDE_CONFIG_DIR says')
  }))

test("a new account signs in with Claude Code's own setup-token, told the page and its code where this computer has no browser, and taking the account off ends nothing", async () => {
  const asked: MintOptions[] = []
  const logins = claudeLogins({ mint: opts => (asked.push(opts ?? {}), Promise.resolve({ ok: true, login: 'sk-ant-oat01-new' })) })
  const onLink = (): void => {}
  const onRefused = (): void => {}
  const stop = new AbortController()
  assert.deepEqual(await logins.signIn([], { onLink, onRefused, onCode: () => {}, onUrl: () => {}, signal: stop.signal }, {}), { ok: true, login: 'sk-ant-oat01-new' })
  assert.deepEqual(asked, [{ onLink, onRefused, signal: stop.signal }], 'a page whose code comes back: no code to type, no page to copy')
  assert.equal(logins.isSignInCode('a-code_from#the.page~'), true)
  assert.equal(logins.isSignInCode('not a code!'), false)
  await logins.forget(ADDED, {})
})

test("the person's own login is read with /usage: a session and a week, a single model's week left out", () =>
  inDir(async env => {
    const { logins } = counted()
    assert.deepEqual(await logins.usage(OWN, { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'given' }), [
      { window: 'seven_day', percentUsed: 12 },
      { window: 'five_hour', percentUsed: 2 },
    ])
  }))

test('a good reading serves everyone for a while, so Claude Code is not asked again; then it is', () =>
  inDir(async env => {
    let now = NOW
    const { logins, reads } = counted(undefined, () => now)
    const own = { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'given' }
    await logins.usage(OWN, own)
    await logins.usage(OWN, own)
    assert.equal(reads(), 1)
    assert.equal((await stat(claudeUsagePath(env))).mode & 0o777, 0o600)
    now = NOW + READING_KEPT_MS
    await logins.usage(OWN, own)
    assert.equal(reads(), 2)
  }))

test("OpenAgent's poller keeping its reading means Claude Code is not asked at all", () =>
  inDir(async env => {
    keepClaudeReading(READING, claudeUsagePath(env), NOW - 60_000)
    const { logins, reads } = counted()
    assert.equal((await logins.usage(OWN, { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'given' }))?.length, 2)
    assert.equal(reads(), 0)
  }))

test('a failed reading is none and is not kept, nor one that throws; a kept file that does not read is none', () =>
  inDir(async env => {
    const own = { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'given' }
    const failed = counted(() => Promise.resolve({ available: false, reason: 'no-subscription' }))
    assert.equal(await failed.logins.usage(OWN, own), undefined)
    await assert.rejects(readFile(claudeUsagePath(env)))
    await failed.logins.usage(OWN, own)
    assert.equal(failed.reads(), 2)
    assert.equal(await counted(() => Promise.reject(new Error('claude is not installed'))).logins.usage(OWN, own), undefined)
    await mkdir(env['XDG_CONFIG_HOME']!, { recursive: true })
    await writeFile(claudeUsagePath(env), 'not json')
    assert.equal(await counted(() => Promise.reject(new Error('claude is not installed'))).logins.usage(OWN, own), undefined)
  }))

test('nobody signed in to Claude, and an added login, are not asked: an added one says how full it is only in its runs', () =>
  inDir(async env => {
    const { logins, reads } = counted()
    assert.equal(await logins.usage(OWN, env), undefined)
    assert.equal(await logins.usage(ADDED, { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'given' }), undefined)
    assert.equal(reads(), 0)
  }))

test("logout is Claude Code's own, in the user's environment, and what was read of the login goes with it", () =>
  inDir(async (env, dir) => {
    const bin = join(dir, 'bin')
    await mkdir(bin, { recursive: true })
    const calls = join(dir, 'calls')
    // A stand-in: never the real command, which would log this computer's person out.
    await writeFile(join(bin, 'claude'), `#!/bin/sh\necho "claude $* home=$HOME" >> "${calls}"\nexit 0\n`, { mode: 0o755 })
    const full = { ...env, PATH: `${bin}:${process.env['PATH']}` }
    keepClaudeReading(READING, claudeUsagePath(env), NOW)
    await claudeLogins().logOut(full)
    await assert.rejects(stat(claudeUsagePath(env)))
    assert.deepEqual((await readFile(calls, 'utf8')).trim().split('\n'), [`claude auth logout home=${env['HOME']}`])
    await writeFile(join(bin, 'claude'), '#!/bin/sh\nexit 3\n', { mode: 0o755 })
    await assert.rejects(claudeLogins().logOut(full))
  }))
