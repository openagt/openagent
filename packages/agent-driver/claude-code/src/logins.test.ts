import { strict as assert } from 'node:assert'
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { DriverQuota } from '@openagt/hooks'
import type { MintOptions } from './claude-login.js'
import { claudeAccountsDir } from './claude-accounts.js'
import { claudeUsagePath, keepClaudeReading } from './claude-code-quota.js'
import { claudeLogins, READING_KEPT_MS } from './logins.js'

// Claude Code's accounts (`RunAgent.accounts`): its own login and who it is, a new one signed in
// with `claude auth login` in a folder of its own, how full each is through `/usage`, the reading
// kept serving a while, and the logouts. Never the real `claude`: it would log this computer's
// person out.

const NOW = 1_800_000_000_000
const OWN = { name: 'This computer' }
const ADDED = { name: 'Work', login: 'acct-000000000000a0b1' }

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

/** A stand-in sign-in: signs `uuid` in to the folder it is run with, then reads back what it kept; `false` signs in to none. */
function signsIn(uuid: string | false, asked: MintOptions[] = []) {
  return async (opts?: MintOptions) => {
    asked.push(opts ?? {})
    const folder = opts?.env?.['CLAUDE_CONFIG_DIR']
    if (uuid !== false && folder !== undefined) await writeFile(join(folder, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: uuid } }))
    const login = await opts?.kept?.()
    return login !== undefined ? { ok: true as const, login } : { ok: false as const, error: 'Claude Code ended without signing in.' }
  }
}

test("a new account signs in with Claude Code's own `claude auth login`, in a folder of its own, told the page and its code where this computer has no browser; one already on the list is refused; taken off, it is logged out there and its folder goes", () =>
  inDir(async env => {
    const asked: MintOptions[] = []
    const loggedOut: (string | undefined)[] = []
    const logOutIn = async (in_: NodeJS.ProcessEnv) => void loggedOut.push(in_['CLAUDE_CONFIG_DIR'])
    const logins = claudeLogins({ mint: signsIn('work-uuid', asked), logOutIn })
    const onLink = (): void => {}
    const onRefused = (): void => {}
    const stop = new AbortController()
    const signed = await logins.signIn([], { onLink, onRefused, onCode: () => {}, onUrl: () => {}, signal: stop.signal }, env)
    assert.ok(signed.ok)
    const login = signed.ok ? signed.login : ''
    assert.match(login, /^acct-[0-9a-f]{16}$/)
    const folder = join(claudeAccountsDir(env), login)
    assert.equal(asked[0]!.command, 'claude auth login')
    assert.equal(asked[0]!.env?.['CLAUDE_CONFIG_DIR'], folder)
    assert.equal(asked[0]!.env?.['CLAUDE_CODE_OAUTH_TOKEN'], '', 'no login handed in beside it')
    // The person's conversations linked in before Claude Code first started there, so it never makes its own.
    assert.equal((await lstat(join(folder, 'projects'))).isSymbolicLink(), true)
    assert.deepEqual([asked[0]!.onLink, asked[0]!.onRefused, asked[0]!.signal], [onLink, onRefused, stop.signal], 'a page whose code comes back: no code to type, no page to copy')
    const work = { name: 'Work', login }
    assert.equal(logins.addedLoginThere?.(work, env), true)
    assert.equal(logins.isSignInCode('a-code_from#the.page~'), true)
    assert.equal(logins.isSignInCode('not a code!'), false)

    // The same account again, as an added one or as the person's own: refused, and nothing of it kept.
    const again = await claudeLogins({ mint: signsIn('work-uuid'), logOutIn }).signIn([work], {}, env)
    assert.equal(again.ok, false)
    await signedInAs(env, { accountUuid: 'own-uuid' })
    assert.equal((await claudeLogins({ mint: signsIn('own-uuid'), logOutIn }).signIn([work], {}, env)).ok, false)
    // A sign-in that went nowhere leaves no folder; nor does one stopped half-way, whose folder the next sign-in takes away.
    assert.equal((await claudeLogins({ mint: signsIn(false), logOutIn }).signIn([work], {}, env)).ok, false)
    assert.deepEqual(await readdirOr(claudeAccountsDir(env)), [login])
    await mkdir(join(claudeAccountsDir(env), 'acct-00000000000000ff'))
    assert.equal((await claudeLogins({ mint: signsIn(false), logOutIn }).signIn([work], {}, env)).ok, false)
    assert.deepEqual(await readdirOr(claudeAccountsDir(env)), [login])

    await logins.forget(work, env)
    assert.deepEqual(await readdirOr(claudeAccountsDir(env)), [])
    assert.equal(loggedOut.at(-1), folder, 'logged out in its folder, never the person\'s own')
    assert.equal(logins.addedLoginThere?.(work, env), false)
    // An account added before, as a login for a computer nobody sits at, has no folder: it is signed out.
    assert.equal(logins.addedLoginThere?.({ name: 'Old', login: 'sk-ant-oat01-old' }, env), false)
  }))

/** A folder's names, none when it is not there. */
async function readdirOr(dir: string): Promise<string[]> {
  return (await import('node:fs/promises')).readdir(dir).catch((): string[] => [])
}

test("the person's own login is read with /usage: a session and a week, a single model's week left out", () =>
  inDir(async env => {
    const { logins } = counted()
    assert.deepEqual(await logins.usage(OWN, { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'given' }), [
      { window: 'seven_day', percentUsed: 12 },
      { window: 'five_hour', percentUsed: 2 },
    ])
  }))

test('the reading kept on this computer (by whoever read it: the poller, a card, a scheduler) serves a while, so Claude Code is not asked; then it is', () =>
  inDir(async env => {
    keepClaudeReading(READING, claudeUsagePath(env), NOW - 60_000)
    let now = NOW
    const { logins, reads } = counted(undefined, () => now)
    const own = { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'given' }
    assert.equal((await logins.usage(OWN, own))?.length, 2)
    assert.equal(reads(), 0)
    now = NOW - 60_000 + READING_KEPT_MS
    await logins.usage(OWN, own)
    assert.equal(reads(), 1)
  }))

test('a failed reading is none, and so is one that throws, or a kept file that does not read', () =>
  inDir(async env => {
    const own = { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'given' }
    const failed = counted(() => Promise.resolve({ available: false, reason: 'no-subscription' }))
    assert.equal(await failed.logins.usage(OWN, own), undefined)
    await failed.logins.usage(OWN, own)
    assert.equal(failed.reads(), 2)
    assert.equal(await counted(() => Promise.reject(new Error('claude is not installed'))).logins.usage(OWN, own), undefined)
    await mkdir(env['XDG_CONFIG_HOME']!, { recursive: true })
    await writeFile(claudeUsagePath(env), 'not json')
    assert.equal(await counted(() => Promise.reject(new Error('claude is not installed'))).logins.usage(OWN, own), undefined)
  }))

test('nobody signed in to Claude is not asked', () =>
  inDir(async env => {
    const { logins, reads } = counted()
    assert.equal(await logins.usage(OWN, env), undefined)
    assert.equal(reads(), 0)
  }))

test("an added account says how full it is with /usage in its own folder, the reading kept there a while; one signed out is not asked", () =>
  inDir(async env => {
    const asked: { folder: string | undefined; keptIn: string }[] = []
    const logins = claudeLogins({
      now: () => NOW,
      quota: () => Promise.reject(new Error("not the person's own")),
      quotaIn: async (in_, keptIn) => (asked.push({ folder: in_['CLAUDE_CONFIG_DIR'], keptIn }), READING),
    })
    assert.equal(await logins.usage(ADDED, env), undefined, 'signed out: no folder')
    assert.equal(asked.length, 0)
    const folder = join(claudeAccountsDir(env), ADDED.login)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'work-uuid' } }))
    assert.deepEqual(await logins.usage(ADDED, { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'given' }), [
      { window: 'seven_day', percentUsed: 12 },
      { window: 'five_hour', percentUsed: 2 },
    ])
    assert.deepEqual(asked, [{ folder, keptIn: join(folder, 'openagent-usage.json') }])
    keepClaudeReading(READING, join(folder, 'openagent-usage.json'), NOW - 60_000)
    await logins.usage(ADDED, env)
    assert.equal(asked.length, 1, 'the kept reading serves')
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
