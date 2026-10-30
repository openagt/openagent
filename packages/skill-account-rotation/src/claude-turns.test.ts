import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Readable, Writable } from 'node:stream'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DriverEvent, SpawnLike, SpawnedProcess } from '@openagt/agent-driver'
import { CLAUDE_ACCOUNT_ENV, CLAUDE_TOKEN_ENV, ClaudeCodeDriver } from '@openagt/agent-driver-claude'
import { accountRotation, accountsPath, addAccount, goOn, markLimited, nameOwnAccount, OWN_NAME, readAccounts, usableAccounts, UsageLimitError, useFirst } from './accounts.js'

const HOUR = 60 * 60_000
const NOW = Date.parse('2026-10-22T12:00:00Z')

function withFile(body: (path: string) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-accounts-'))
    try {
      await body(join(dir, 'accounts.json'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test('the Claude accounts are kept beside OpenAgent\'s own: under XDG_CONFIG_HOME when set, else dotted in the home', () => {
  assert.equal(accountsPath('claude', { XDG_CONFIG_HOME: '/x' }), '/x/openagent-claude-accounts.json')
  assert.equal(accountsPath('claude', { HOME: '/home/rom' }), '/home/rom/.openagent-claude-accounts.json')
})

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

test('a turn the account\'s limit stops goes on in the same conversation on the next free account, told so, and the chat says why; each account keeps its windows', withFile(async path => {
  addAccount('Dani', 'sk-ant-oat01-dani', path)
  nameOwnAccount('Rom', path)
  const seen: Spawned[] = []
  const events: DriverEvent[] = []
  const frees = NOW + 2 * HOUR
  const session = await new ClaudeCodeDriver({ spawn: turns([{ lines: LIMITED(frees), code: 1 }, { lines: DONE('finished') }], seen), env: { HOME: '/nowhere' }, accounts: accountRotation('claude', { path, now: () => NOW }) }).start({ cwd: '/ws', onEvent: e => events.push(e) })
  const turn = await session.prompt('fix the bug')
  assert.equal(turn.text, 'finished')
  assert.equal(seen.length, 2)
  // The person's own login as Claude Code keeps it, then Dani's in the turn's environment alone.
  assert.equal(seen[0]!.env[CLAUDE_TOKEN_ENV], undefined)
  assert.equal(seen[1]!.env[CLAUDE_TOKEN_ENV], 'sk-ant-oat01-dani')
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
  assert.equal(seen[2]!.env[CLAUDE_TOKEN_ENV], 'sk-ant-oat01-dani')
}))

test('a run starts on the account it was told to; with every account at its limit the turn ends, saying which frees first', withFile(async path => {
  addAccount('Dani', 'sk-ant-oat01-dani', path)
  const seen: Spawned[] = []
  const driver = new ClaudeCodeDriver({ spawn: turns([{ lines: LIMITED(NOW + 3 * HOUR), code: 1 }, { lines: LIMITED(NOW + HOUR), code: 1 }], seen), env: {}, accounts: accountRotation('claude', { path, prefer: 'Dani', now: () => NOW }) })
  const session = await driver.start({ cwd: '/ws' })
  await assert.rejects(session.prompt('go'), (err: unknown) => err instanceof UsageLimitError && err.message === `All 2 Claude accounts are at their limit: ${OWN_NAME}'s is free again in 1 h.`)
  assert.deepEqual(seen.map(s => s.env[CLAUDE_TOKEN_ENV]), ['sk-ant-oat01-dani', undefined])
  // Nothing is started while every account is out.
  await assert.rejects(session.prompt('again'), UsageLimitError)
  assert.equal(seen.length, 2)
}))

test('a limit line on a turn that went through, a turn that failed on something else, and a stopped turn are no limit to switch over', withFile(async path => {
  addAccount('Dani', 'sk-ant-oat01-dani', path)
  const rejected = LIMITED(NOW + HOUR).slice(0, 2)
  const seen: Spawned[] = []
  const session = await new ClaudeCodeDriver({ spawn: turns([{ lines: [...rejected, JSON.stringify({ type: 'result', result: 'done anyway', session_id: 's1' })] }, { lines: ['{}'], code: 1 }], seen), env: {}, accounts: accountRotation('claude', { path, now: () => NOW }) }).start({ cwd: '/ws' })
  assert.equal((await session.prompt('go')).text, 'done anyway')
  await assert.rejects(session.prompt('again'))
  assert.equal(seen.length, 2)
  assert.equal(readAccounts(path).some(a => a.limitedUntil !== undefined), false)

  const stop = new AbortController()
  const stoppedSeen: Spawned[] = []
  const stopped = await new ClaudeCodeDriver({ spawn: turns([{ lines: LIMITED(NOW + HOUR), code: 1 }], stoppedSeen), env: {}, accounts: accountRotation('claude', { path, now: () => NOW }) }).start({ cwd: '/ws', signal: stop.signal })
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

test('with one account there is no choice: a turn tries it whatever a limit said of it before, and keeps nothing', withFile(async path => {
  markLimited(OWN_NAME, NOW + HOUR, NOW, path)
  const seen: Spawned[] = []
  const session = await new ClaudeCodeDriver({ spawn: turns([{ lines: DONE('fine') }], seen), env: {}, accounts: accountRotation('claude', { path, now: () => NOW }) }).start({ cwd: '/ws' })
  assert.equal((await session.prompt('go')).text, 'fine')
  assert.equal(readAccounts(path)[0]?.windows, undefined)
}))

test('a project’s own few: its runs use only the accounts it names, in the file’s order; one named is that one’s login; none still there is all of them', withFile(async path => {
  addAccount('Dani', 'sk-ant-oat01-dani', path)
  addAccount('Rom', 'sk-ant-oat01-rom', path)
  const seen: Spawned[] = []
  const session = await new ClaudeCodeDriver({ spawn: turns([{ lines: LIMITED(NOW + HOUR), code: 1 }, { lines: DONE('done') }], seen), env: {}, accounts: accountRotation('claude', { path, only: ['Rom', 'Dani'], now: () => NOW }) }).start({ cwd: '/ws' })
  assert.equal((await session.prompt('go')).text, 'done')
  // Never the person's own: Dani's first (the file's order), then Rom's.
  assert.deepEqual(seen.map(s => s.env[CLAUDE_TOKEN_ENV]), ['sk-ant-oat01-dani', 'sk-ant-oat01-rom'])

  const one: Spawned[] = []
  await (await new ClaudeCodeDriver({ spawn: turns([{ lines: DONE('fine') }], one), env: {}, accounts: accountRotation('claude', { path, only: ['Rom'], now: () => NOW }) }).start({ cwd: '/ws' })).prompt('go')
  assert.deepEqual(one.map(s => s.env[CLAUDE_TOKEN_ENV]), ['sk-ant-oat01-rom'])

  assert.deepEqual(usableAccounts(readAccounts(path), ['Gone']).map(a => a.name), [OWN_NAME, 'Dani', 'Rom'])
}))

/** Claude Code's answer to the `initialize` a model list asks with. */
const INITIALIZED = [JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'models', response: { models: [{ value: 'opus', displayName: 'Opus 5.5', resolvedModel: 'claude-opus-5-5' }] } } })]

test('an added account whose Claude account is known runs with it beside its login; one not known runs with none, never another\'s', withFile(async path => {
  addAccount('Dani', 'sk-ant-oat01-dani', path, new Date(NOW), 'dani-account-id')
  addAccount('Rom', 'sk-ant-oat01-rom', path)
  useFirst('Dani', path)
  const seen: Spawned[] = []
  const env = { [CLAUDE_ACCOUNT_ENV]: 'the-servers-own-account' }
  const session = await new ClaudeCodeDriver({ spawn: turns([{ lines: LIMITED(NOW + HOUR), code: 1 }, { lines: LIMITED(NOW + HOUR), code: 1 }, { lines: DONE('done') }], seen), env, accounts: accountRotation('claude', { path, now: () => NOW }) }).start({ cwd: '/ws' })
  assert.equal((await session.prompt('go')).text, 'done')
  assert.deepEqual(seen.map(s => [s.env[CLAUDE_TOKEN_ENV], s.env[CLAUDE_ACCOUNT_ENV]]), [
    ['sk-ant-oat01-dani', 'dani-account-id'],
    // The person's own: as Claude Code keeps it, with what the computer's own login says of itself.
    [undefined, 'the-servers-own-account'],
    ['sk-ant-oat01-rom', undefined],
  ])
}))

test('the models are asked on the account runs take first, with who it is: what a run there is given', withFile(async path => {
  addAccount('Dani', 'sk-ant-oat01-dani', path, new Date(NOW), 'dani-account-id')
  useFirst('Dani', path)
  const seen: Spawned[] = []
  const models = await new ClaudeCodeDriver({ spawn: turns([{ lines: INITIALIZED }], seen), env: {}, accounts: accountRotation('claude', { path, now: () => NOW }) }).listModels()
  assert.deepEqual(models.map(m => m.name), ['Opus 5.5'])
  assert.deepEqual([seen[0]!.env[CLAUDE_TOKEN_ENV], seen[0]!.env[CLAUDE_ACCOUNT_ENV]], ['sk-ant-oat01-dani', 'dani-account-id'])

  // Without accounts, on whatever login Claude Code has.
  const plain: Spawned[] = []
  await new ClaudeCodeDriver({ spawn: turns([{ lines: INITIALIZED }], plain), env: {} }).listModels()
  assert.equal(plain[0]!.env[CLAUDE_TOKEN_ENV], undefined)
}))

test('the models of a login in the environment are asked in a folder of their own, removed after; the person\'s own login in their folder', withFile(async path => {
  addAccount('Dani', 'sk-ant-oat01-dani', path, new Date(NOW), 'dani-account-id')
  useFirst('Dani', path)
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

  const dani: Spawned[] = []
  await new ClaudeCodeDriver({ spawn: asked(dani), env: own, accounts: accountRotation('claude', { path, now: () => NOW }) }).listModels()
  await closed()
  const folder = dani[0]!.env['CLAUDE_CONFIG_DIR']!
  assert.notEqual(folder, own.CLAUDE_CONFIG_DIR)
  assert.equal(there[0], true)
  assert.equal(existsSync(folder), false)

  // A server person's login, in the environment Claude Code is started with.
  const person: Spawned[] = []
  await new ClaudeCodeDriver({ spawn: asked(person), env: { ...own, [CLAUDE_TOKEN_ENV]: 'sk-ant-oat01-rom' } }).listModels()
  assert.notEqual(person[0]!.env['CLAUDE_CONFIG_DIR'], own.CLAUDE_CONFIG_DIR)

  useFirst(OWN_NAME, path)
  const mine: Spawned[] = []
  await new ClaudeCodeDriver({ spawn: asked(mine), env: own, accounts: accountRotation('claude', { path, now: () => NOW }) }).listModels()
  assert.equal(mine[0]!.env['CLAUDE_CONFIG_DIR'], own.CLAUDE_CONFIG_DIR)
}))
