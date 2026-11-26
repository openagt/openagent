import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Readable, Writable } from 'node:stream'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type SpawnLike, type SpawnedProcess, accountRotation, addAccount, goOn, markLimited, nameOwnAccount, OWN_NAME, readAccounts, usableAccounts, useFirst, removeAccount, UsageLimitError } from '@openagt/agent-driver'
import type { DriverEvent } from '@openagt/hooks'
import { CLAUDE_TOKEN_ENV, claudeAccountsDir } from './claude-accounts.js'
import { ClaudeCodeDriver } from './claude-code.js'
import { claudeLogins } from './logins.js'

// Claude Code's turns on the person's accounts: an added one's folder for Claude Code's own in the
// turn's environment, and the next free account going on with the same conversation at a limit (the
// rotation is `@openagt/agent-driver`'s, the same for every agent).

const HOUR = 60 * 60_000
const NOW = Date.parse('2026-10-22T12:00:00Z')

/** The accounts' file, and a home of the test's own: where added accounts' folders and the person's Claude folder are. */
function withFile(body: (path: string, home: Home) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-accounts-'))
    const env = { HOME: dir }
    const home: Home = {
      env,
      add(name, login, signedIn = true) {
        addAccount(name, login, join(dir, 'accounts.json'))
        const folder = join(claudeAccountsDir(env), login)
        mkdirSync(folder, { recursive: true })
        if (signedIn) writeFileSync(join(folder, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: `${name}-uuid` } }))
        return folder
      },
    }
    try {
      await body(join(dir, 'accounts.json'), home)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** A test's home: its environment, and an added account signed in there, its folder answered. */
interface Home {
  env: NodeJS.ProcessEnv
  add(name: string, login: string, signedIn?: boolean): string
}

const DANI = 'acct-00000000000000da'
const ROM = 'acct-00000000000000a0'

/** Which login a turn ran on: an added account's folder by its name, else the person's own. */
const on = (spawned: Spawned): string => spawned.env['CLAUDE_CONFIG_DIR']?.split('/').pop() ?? 'own'

/** What Claude Code says when the account's limit stops a turn, as a real one did: the line says `rejected`, then its own message. */
const LIMITED = (resetsAt: number): string[] => [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
  JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: resetsAt / 1000, rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 1, resetsAt: resetsAt / 1000 }, seven_day: { utilization: 0.61, resetsAt: (NOW + 48 * HOUR) / 1000 } } } }),
  JSON.stringify({ type: 'assistant', error: 'rate_limit', message: { content: [{ type: 'text', text: "You've hit your limit · resets 2pm" }] } }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your limit · resets 2pm", session_id: 's1' }),
]
const DONE = (said: string, util = 0.2): string[] => [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
  JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: (NOW + HOUR) / 1000, rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: util, resetsAt: (NOW + HOUR) / 1000 } } } }),
  JSON.stringify({ type: 'result', subtype: 'success', result: said, session_id: 's1' }),
]

interface Spawned {
  args: string[]
  env: NodeJS.ProcessEnv
  stdin: string
}

/** Claude Code stand-in: each turn says the next lines given, and what it was started with is kept. */
function turns(said: { lines: string[]; code?: number }[], seen: Spawned[]): SpawnLike {
  return (_cmd, args, opts) => {
    const next = said[seen.length] ?? { lines: [] }
    const spawned: Spawned = { args: [...args], env: opts.env ?? {}, stdin: '' }
    seen.push(spawned)
    const stdout = Readable.from([next.lines.map(l => l + '\n').join('')])
    const stdin = new Writable({ write: (chunk, _e, cb) => ((spawned.stdin += String(chunk)), cb()) })
    const proc: SpawnedProcess = {
      stdout,
      stderr: Readable.from([]),
      stdin,
      on(event, listener) {
        if (event === 'close') stdout.on('end', () => (listener as (c: number | null) => void)(next.code ?? 0))
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
}

test('a turn the account\'s limit stops goes on in the same conversation on the next free account, told so, and the chat says why; each account keeps its windows', withFile(async (path, home) => {
  home.add('Dani', DANI)
  nameOwnAccount('Rom', path)
  const seen: Spawned[] = []
  const events: DriverEvent[] = []
  const frees = NOW + 2 * HOUR
  const session = await new ClaudeCodeDriver({ spawn: turns([{ lines: LIMITED(frees), code: 1 }, { lines: DONE('finished') }], seen), env: home.env, accounts: accountRotation(claudeLogins(), { ownLoginThere: () => true, path, now: () => NOW }) }).start({ cwd: '/ws', onEvent: e => events.push(e) })
  const turn = await session.prompt('fix the bug')
  assert.equal(turn.text, 'finished')
  assert.equal(seen.length, 2)
  // The person's own login as Claude Code keeps it, then Dani's folder in the turn's environment alone.
  assert.deepEqual(seen.map(on), ['own', DANI])
  // The same conversation, told to go on: the prompt is in it already.
  assert.deepEqual(seen[1]!.args.slice(seen[1]!.args.indexOf('--resume'), seen[1]!.args.indexOf('--resume') + 2), ['--resume', 's1'])
  assert.match(seen[1]!.stdin, new RegExp(goOn('Claude').slice(0, 30)))
  assert.doesNotMatch(seen[1]!.stdin, /fix the bug/)
  assert.deepEqual(events.filter(e => e.type === 'notice'), [{ type: 'notice', message: "↻ Switched to Dani's Claude: Rom's hit its limit, free again in 2 h." }])
  const after = readAccounts(path)
  assert.equal(after.find(a => a.name === 'Rom')?.limitedUntil, frees)
  assert.deepEqual(after.find(a => a.name === 'Rom')?.windows?.map(w => [w.window, w.percentUsed]), [['five_hour', 100], ['seven_day', 61]])
  assert.deepEqual(after.find(a => a.name === 'Dani')?.windows?.map(w => [w.window, w.percentUsed]), [['five_hour', 20]])
  // The session stays on Dani's: the next turn does not try Rom's again.
  await session.prompt('and the test').catch(() => undefined)
  assert.equal(on(seen[2]!), DANI)
}))

test('a run starts on the account it was told to; with every account at its limit the turn ends, saying which frees first', withFile(async (path, home) => {
  home.add('Dani', DANI)
  const seen: Spawned[] = []
  const driver = new ClaudeCodeDriver({ spawn: turns([{ lines: LIMITED(NOW + 3 * HOUR), code: 1 }, { lines: LIMITED(NOW + HOUR), code: 1 }], seen), env: home.env, accounts: accountRotation(claudeLogins(), { ownLoginThere: () => true, path, prefer: 'Dani', now: () => NOW }) })
  const session = await driver.start({ cwd: '/ws' })
  await assert.rejects(session.prompt('go'), (err: unknown) => err instanceof UsageLimitError && err.message === `All 2 Claude accounts are at their limit: ${OWN_NAME}'s is free again in 1 h.`)
  assert.deepEqual(seen.map(on), [DANI, 'own'])
  // Nothing is started while every account is out.
  await assert.rejects(session.prompt('again'), UsageLimitError)
  assert.equal(seen.length, 2)
}))

test('a limit line on a turn that went through, a turn that failed on something else, and a stopped turn are no limit to switch over', withFile(async (path, home) => {
  home.add('Dani', DANI)
  const rejected = LIMITED(NOW + HOUR).slice(0, 2)
  const seen: Spawned[] = []
  const session = await new ClaudeCodeDriver({ spawn: turns([{ lines: [...rejected, JSON.stringify({ type: 'result', result: 'done anyway', session_id: 's1' })] }, { lines: ['{}'], code: 1 }], seen), env: home.env, accounts: accountRotation(claudeLogins(), { ownLoginThere: () => true, path, now: () => NOW }) }).start({ cwd: '/ws' })
  assert.equal((await session.prompt('go')).text, 'done anyway')
  await assert.rejects(session.prompt('again'))
  assert.equal(seen.length, 2)
  assert.equal(readAccounts(path).some(a => a.limitedUntil !== undefined), false)

  const stop = new AbortController()
  const stoppedSeen: Spawned[] = []
  const stopped = await new ClaudeCodeDriver({ spawn: turns([{ lines: LIMITED(NOW + HOUR), code: 1 }], stoppedSeen), env: home.env, accounts: accountRotation(claudeLogins(), { ownLoginThere: () => true, path, now: () => NOW }) }).start({ cwd: '/ws', signal: stop.signal })
  stop.abort()
  await assert.rejects(stopped.prompt('go'))
  assert.equal(stoppedSeen.length <= 1, true)
}))

test('without accounts a turn runs on whatever login Claude Code has, and a limit ends it as before', async () => {
  const seen: Spawned[] = []
  const session = await new ClaudeCodeDriver({ spawn: turns([{ lines: LIMITED(NOW + HOUR), code: 1 }], seen), env: { [CLAUDE_TOKEN_ENV]: 'the-servers-own' } }).start({ cwd: '/ws' })
  await assert.rejects(session.prompt('go'), (err: unknown) => !(err instanceof UsageLimitError))
  assert.deepEqual(seen.map(s => s.env[CLAUDE_TOKEN_ENV]), ['the-servers-own'])
})

test('with one account there is no choice: a turn tries it whatever a limit said of it before, and keeps nothing', withFile(async (path, home) => {
  markLimited(OWN_NAME, NOW + HOUR, NOW, path)
  const seen: Spawned[] = []
  const session = await new ClaudeCodeDriver({ spawn: turns([{ lines: DONE('fine') }], seen), env: home.env, accounts: accountRotation(claudeLogins(), { ownLoginThere: () => true, path, now: () => NOW }) }).start({ cwd: '/ws' })
  assert.equal((await session.prompt('go')).text, 'fine')
  assert.equal(readAccounts(path)[0]?.windows, undefined)
}))

test('a project’s own few: its runs use only the accounts it names, in the file’s order; one named is that one’s login; none still there is all of them', withFile(async (path, home) => {
  home.add('Dani', DANI)
  home.add('Rom', ROM)
  const seen: Spawned[] = []
  const session = await new ClaudeCodeDriver({ spawn: turns([{ lines: LIMITED(NOW + HOUR), code: 1 }, { lines: DONE('done') }], seen), env: home.env, accounts: accountRotation(claudeLogins(), { ownLoginThere: () => true, path, only: ['Rom', 'Dani'], now: () => NOW }) }).start({ cwd: '/ws' })
  assert.equal((await session.prompt('go')).text, 'done')
  // Never the person's own: Dani's first (the file's order), then Rom's.
  assert.deepEqual(seen.map(on), [DANI, ROM])

  const one: Spawned[] = []
  await (await new ClaudeCodeDriver({ spawn: turns([{ lines: DONE('fine') }], one), env: home.env, accounts: accountRotation(claudeLogins(), { ownLoginThere: () => true, path, only: ['Rom'], now: () => NOW }) }).start({ cwd: '/ws' })).prompt('go')
  assert.deepEqual(one.map(on), [ROM])

  assert.deepEqual(usableAccounts(readAccounts(path), ['Gone']).map(a => a.name), [OWN_NAME, 'Dani', 'Rom'])
}))

/** Claude Code's answer to the `initialize` a model list asks with. */
const INITIALIZED = [JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'models', response: { models: [{ value: 'opus', displayName: 'Opus 5.5', resolvedModel: 'claude-opus-5-5' }] } } })]

test("an added account's turn runs in its folder, linked to the person's conversations and setup, with no login handed in beside it; one signed out takes no turn", withFile(async (path, home) => {
  const folder = home.add('Dani', DANI)
  home.add('Rom', ROM, false)
  const personal = join(home.env['HOME']!, '.claude')
  mkdirSync(join(personal, 'skills'), { recursive: true })
  writeFileSync(join(personal, 'settings.json'), '{}')
  useFirst('Rom', path)
  const seen: Spawned[] = []
  const env = { ...home.env, [CLAUDE_TOKEN_ENV]: 'the-servers-own' }
  const session = await new ClaudeCodeDriver({ spawn: turns([{ lines: DONE('done') }], seen), env, accounts: accountRotation(claudeLogins(), { ownLoginThere: () => true, path, prefer: 'Dani', now: () => NOW }) }).start({ cwd: '/ws' })
  assert.equal((await session.prompt('go')).text, 'done')
  // Rom's, first but signed out, is passed over.
  assert.deepEqual(seen.map(on), [DANI])
  assert.equal(seen[0]!.env['CLAUDE_CONFIG_DIR'], folder)
  assert.equal(seen[0]!.env[CLAUDE_TOKEN_ENV], undefined, "the computer's own login is not the account's")
  for (const name of ['projects', 'skills', 'settings.json']) assert.equal(lstatSync(join(folder, name)).isSymbolicLink() && readlinkSync(join(folder, name)), join(personal, name))
  assert.equal(existsSync(join(folder, 'CLAUDE.md')), false, 'nothing the person does not have')
}))

test('the models are asked on the account runs take first, in its folder: what a run there is given', withFile(async (path, home) => {
  const folder = home.add('Dani', DANI)
  useFirst('Dani', path)
  const seen: Spawned[] = []
  const models = await new ClaudeCodeDriver({ spawn: turns([{ lines: INITIALIZED }], seen), env: home.env, accounts: accountRotation(claudeLogins(), { ownLoginThere: () => true, path, now: () => NOW }) }).listModels()
  assert.deepEqual(models.map(m => m.name), ['Opus 5.5'])
  assert.equal(seen[0]!.env['CLAUDE_CONFIG_DIR'], folder)

  // Without accounts, on whatever login Claude Code has.
  const plain: Spawned[] = []
  await new ClaudeCodeDriver({ spawn: turns([{ lines: INITIALIZED }], plain), env: {} }).listModels()
  assert.equal(plain[0]!.env[CLAUDE_TOKEN_ENV], undefined)
}))

test('the models of a login in the environment are asked in a folder of their own, removed after; the person\'s own login in their folder', withFile(async path => {
  const there: boolean[] = []
  const asked = (seen: Spawned[]): SpawnLike => {
    const spawn = turns([{ lines: INITIALIZED }], seen)
    return (cmd, args, opts) => {
      const folder = opts.env?.['CLAUDE_CONFIG_DIR']
      there.push(folder !== undefined && existsSync(folder))
      return spawn(cmd, args, opts)
    }
  }
  const closed = () => new Promise(resolve => setImmediate(resolve))
  const own = { CLAUDE_CONFIG_DIR: '/home/me/.claude' }

  // A server person's login, in the environment Claude Code is started with.
  const person: Spawned[] = []
  await new ClaudeCodeDriver({ spawn: asked(person), env: { ...own, [CLAUDE_TOKEN_ENV]: 'sk-ant-oat01-rom' } }).listModels()
  await closed()
  const folder = person[0]!.env['CLAUDE_CONFIG_DIR']!
  assert.notEqual(folder, own.CLAUDE_CONFIG_DIR)
  assert.equal(there[0], true)
  assert.equal(existsSync(folder), false)

  useFirst(OWN_NAME, path)
  const mine: Spawned[] = []
  await new ClaudeCodeDriver({ spawn: asked(mine), env: own, accounts: accountRotation(claudeLogins(), { ownLoginThere: () => true, path, now: () => NOW }) }).listModels()
  assert.equal(mine[0]!.env['CLAUDE_CONFIG_DIR'], own.CLAUDE_CONFIG_DIR)
}))

test('the person\'s own login first and not there: a run takes the next account, and a limit there hands over past it; alone it is still tried', withFile(async (path, home) => {
  home.add('Dani', DANI)
  useFirst('This computer', path)
  const rotation = accountRotation(claudeLogins(), { path, now: () => NOW, ownLoginThere: () => false })
  assert.equal(rotation.first(home.env)?.name, 'Dani')
  const seen: Spawned[] = []
  const session = await new ClaudeCodeDriver({ spawn: turns([{ lines: DONE('fine') }], seen), env: home.env, accounts: rotation }).start({ cwd: '/w' })
  await session.prompt('go')
  assert.deepEqual(seen.map(on), [DANI])
  removeAccount('Dani', path)
  assert.equal(rotation.first(home.env)?.name, 'This computer')
}))
