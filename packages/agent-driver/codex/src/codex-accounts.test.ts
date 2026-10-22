import { strict as assert } from 'node:assert'
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { PassThrough, Readable } from 'node:stream'
import { addAccount, goOn, nameOwnAccount, readAccounts, UsageLimitError, type DriverEvent, type SpawnLike, type SpawnedProcess } from '@openagt/agent-driver'
import { accountHome, codexAccountsDir, codexAccountsPath, codexWho, codexWindows, loginCodex, readCodexUsage } from './codex-accounts.js'
import { CodexDriver } from './codex.js'

const HOUR = 60 * 60_000
const NOW = Date.parse('2026-10-22T12:00:00Z')

async function inDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'codex-accounts-'))
  try {
    await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** A login as Codex keeps it, for a person in a workspace. */
function auth(user: string, workspace: string, name?: string): string {
  const claims = { sub: `auth0|${user}`, email: `${user}@example.com`, ...(name !== undefined ? { name } : {}), 'https://api.openai.com/auth': { chatgpt_user_id: user, chatgpt_account_id: workspace } }
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: `${part({ alg: 'none' })}.${part(claims)}.sig`, access_token: 'a', refresh_token: 'r', account_id: workspace } })
}

type Reply = (method: string, params: Record<string, unknown>, send: (msg: unknown) => void, home: string) => void

/** What a fake app server was started with, and every message it read. */
interface Seen {
  env: NodeJS.ProcessEnv
  messages: { method?: string; params?: Record<string, unknown> }[]
}

/** A fake `codex app-server`: `initialize` answered, every other request handed to `reply`; it exits once stdin closes. */
function fakeServer(reply: Reply, seen: Seen[] = []): SpawnLike {
  return (_command, _args, opts) => {
    const record: Seen = { env: opts.env, messages: [] }
    seen.push(record)
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let closer: ((code: number | null) => void) | undefined
    let exited = false
    const send = (msg: unknown) => void (exited || stdout.write(`${JSON.stringify(msg)}\n`))
    createInterface({ input: stdin }).on('line', line => {
      const msg = JSON.parse(line) as { id?: number; method?: string; params?: Record<string, unknown> }
      record.messages.push(msg)
      if (msg.id === undefined || msg.method === undefined) return
      if (msg.method === 'initialize') return send({ id: msg.id, result: {} })
      reply(msg.method, { ...msg.params, id: msg.id }, send, opts.env['CODEX_HOME'] ?? '')
    })
    stdin.on('finish', () => {
      exited = true
      stdout.end()
      stdout.on('end', () => setImmediate(() => closer?.(0)))
      stdout.resume()
    })
    const proc: SpawnedProcess = {
      stdout,
      stderr: Readable.from([]),
      stdin,
      on(event, listener) {
        if (event === 'close') closer = listener as (code: number | null) => void
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
}

test('the Codex accounts list is beside OpenAgent\'s own, and their logins under the state directory, a folder each', () => {
  assert.equal(codexAccountsPath({ XDG_CONFIG_HOME: '/x' }), '/x/openagent-codex-accounts.json')
  assert.equal(codexAccountsDir({ XDG_STATE_HOME: '/s' }), '/s/agent-driver/codex-accounts')
  assert.equal(codexAccountsDir({ HOME: '/home/rom' }), '/home/rom/.local/state/agent-driver/codex-accounts')
})

test('a turn on an added account runs from a home with its own login and the conversations of the person\'s home; their own setup too only when the run loads it', () =>
  inDir(async dir => {
    const base = join(dir, 'base')
    const folder = join(dir, 'acct')
    await mkdir(join(base, 'skills'), { recursive: true })
    await writeFile(join(base, 'config.toml'), 'model = "x"\n')
    await writeFile(join(base, 'AGENTS.md'), 'be kind\n')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'auth.json'), auth('dani', 'ws'))

    const plain = await accountHome(folder, base, false)
    assert.equal(plain, join(folder, 'plain'))
    assert.equal(await readlink(join(plain, 'auth.json')), join(folder, 'auth.json'))
    assert.equal(await readlink(join(plain, 'sessions')), join(base, 'sessions'))
    // An archive the person does not have is not made in their home.
    assert.equal(await lstat(join(base, 'archived_sessions')).catch(() => undefined), undefined)
    assert.equal(await lstat(join(plain, 'config.toml')).catch(() => undefined), undefined)

    const home = await accountHome(folder, base, true)
    assert.equal(home, join(folder, 'home'))
    for (const name of ['sessions', 'config.toml', 'AGENTS.md', 'skills']) assert.equal(await readlink(join(home, name)), join(base, name))
    // What the person does not have is not linked to.
    assert.equal(await lstat(join(home, 'rules')).catch(() => undefined), undefined)
    // Asked again, it is the same, and something Codex put in a link's place is kept.
    await rm(join(home, 'AGENTS.md'))
    await writeFile(join(home, 'AGENTS.md'), 'its own\n')
    assert.equal(await accountHome(folder, base, true), home)
    assert.equal(await readFile(join(home, 'AGENTS.md'), 'utf8'), 'its own\n')
    assert.equal(await readlink(join(home, 'config.toml')), join(base, 'config.toml'))
  }))

test('who a Codex home is logged in as: the name, else the email; one person in one workspace is one account', () =>
  inDir(async dir => {
    const write = async (name: string, text: string) => (await mkdir(join(dir, name)), writeFile(join(dir, name, 'auth.json'), text))
    await write('a', auth('dani', 'ws-1', 'Dani'))
    await write('b', auth('dani', 'ws-1'))
    await write('c', auth('dani', 'ws-2'))
    await write('d', 'not json')
    const [a, b, c, d] = await Promise.all(['a', 'b', 'c', 'd'].map(name => codexWho(join(dir, name))))
    assert.equal(a!.name, 'Dani')
    assert.equal(b!.name, 'dani@example.com')
    assert.equal(a!.key, b!.key)
    assert.notEqual(a!.key, c!.key)
    assert.deepEqual(d, {})
    assert.deepEqual(await codexWho(join(dir, 'none')), {})
  }))

test('Codex\'s rate-limit windows are named by how long they last, full ones capped, and missing ones left out', () => {
  assert.deepEqual(
    codexWindows({
      primary: { usedPercent: 7, windowDurationMins: 43200, resetsAt: 1795029111 },
      secondary: null,
    }),
    [{ window: 'thirty_day', percentUsed: 7, resetsAt: 1795029111000 }],
  )
  assert.deepEqual(
    codexWindows({ primary: { usedPercent: 120, windowDurationMins: 300, resetsAt: 1 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 2 } }).map(w => [w.window, w.percentUsed]),
    [
      ['five_hour', 100],
      ['seven_day', 40],
    ],
  )
  assert.deepEqual(codexWindows(null), [])
})

test('how full an account is, read now from its own home', async () => {
  const seen: Seen[] = []
  const windows = await readCodexUsage({
    home: '/accounts/dani/plain',
    env: {},
    spawn: fakeServer((method, params, send) => {
      if (method === 'account/rateLimits/read') send({ id: params['id'], result: { rateLimits: { primary: { usedPercent: 0, windowDurationMins: 43200, resetsAt: 10 }, secondary: null } } })
    }, seen),
  })
  assert.deepEqual(windows, [{ window: 'thirty_day', percentUsed: 0, resetsAt: 10_000 }])
  assert.equal(seen[0]!.env['CODEX_HOME'], '/accounts/dani/plain')
})

test('a new account signs in in this computer\'s browser into a folder of its own; one that does not sign in leaves no folder', () =>
  inDir(async dir => {
    const opened: string[] = []
    const told: string[] = []
    const seen: Seen[] = []
    const signedIn = await loginCodex({
      dir,
      env: {},
      open: url => opened.push(url),
      onUrl: url => told.push(url),
      spawn: fakeServer((method, params, send, home) => {
        if (method !== 'account/login/start') return
        send({ id: params['id'], result: { type: 'chatgpt', loginId: 'l1', authUrl: 'https://auth.example/sign-in' } })
        void writeFile(join(home, 'auth.json'), auth('dani', 'ws', 'Dani')).then(() => send({ method: 'account/login/completed', params: { loginId: 'l1', success: true, error: null } }))
      }, seen),
    })
    assert.ok(signedIn.ok)
    assert.deepEqual(opened, ['https://auth.example/sign-in'])
    assert.deepEqual(told, ['https://auth.example/sign-in'])
    assert.deepEqual(seen[0]!.messages.find(m => m.method === 'account/login/start')?.params, { type: 'chatgpt' })
    assert.equal(signedIn.who.name, 'Dani')
    assert.match(signedIn.login, /^codex-[0-9a-f]{12}$/)
    assert.equal(seen[0]!.env['CODEX_HOME'], join(dir, signedIn.login))
    assert.equal((await stat(join(dir, signedIn.login))).mode & 0o777, 0o700)

    const refused = await loginCodex({
      dir,
      env: {},
      open: () => {},
      spawn: fakeServer((method, params, send) => {
        if (method !== 'account/login/start') return
        send({ id: params['id'], result: { type: 'chatgpt', loginId: 'l2', authUrl: 'https://auth.example/sign-in' } })
        send({ method: 'account/login/completed', params: { loginId: 'l2', success: false, error: 'Login was not completed' } })
      }),
    })
    assert.deepEqual(refused, { ok: false, error: 'Login was not completed' })
    assert.deepEqual(await readdir(dir), [signedIn.login])
  }))

/** One turn of a fake Codex app server, by the account (Codex home) it runs on. */
function turns(byHome: (home: string, turn: number) => 'limit' | 'done', seen: Seen[], frees = NOW + 2 * HOUR): SpawnLike {
  let turn = 0
  return fakeServer((method, params, send, home) => {
    if (method === 'thread/start' || method === 'thread/resume') return send({ id: params['id'], result: { thread: { id: method === 'thread/resume' ? params['threadId'] : 'thread-1' }, model: 'gpt-5.5', reasoningEffort: 'medium' } })
    if (method !== 'turn/start') return
    send({ id: params['id'], result: { turn: { id: 'turn-1' } } })
    const outcome = byHome(home, turn++)
    if (outcome === 'limit') {
      send({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: frees / 1000 }, secondary: { usedPercent: 61, windowDurationMins: 10080, resetsAt: (NOW + 48 * HOUR) / 1000 } } } })
      send({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'failed', error: { message: "You've hit your usage limit. Try again at Oct 22nd, 2026 2:00 PM.", codexErrorInfo: 'usageLimitExceeded', additionalDetails: null } } } })
    } else {
      send({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: (NOW + HOUR) / 1000 }, secondary: null } } })
      send({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'm', text: 'finished' } } })
      send({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed', error: null } } })
    }
  }, seen)
}

/** The text a fake server was given to say, in its turn. */
const said = (s: Seen): unknown => (s.messages.find(m => m.method === 'turn/start')?.params?.['input'] as { text: string }[])[0]!.text

test('a turn the account\'s limit stops goes on in the same conversation on the next free account, from its own home, told so; the chat says why, each account keeps its windows', () =>
  inDir(async dir => {
    const env = { HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_STATE_HOME: join(dir, 'state') }
    const path = codexAccountsPath(env)
    addAccount('Dani', 'codex-dani', path)
    nameOwnAccount('Rom', path)
    const folder = join(codexAccountsDir(env), 'codex-dani')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'auth.json'), auth('dani', 'ws'))
    const seen: Seen[] = []
    const events: DriverEvent[] = []
    const session = await new CodexDriver({ spawn: turns(home => (home === '' ? 'limit' : 'done'), seen), env, accounts: { now: () => NOW } }).start({ cwd: dir, onEvent: e => events.push(e) })
    const turn = await session.prompt('fix the bug')
    assert.equal(turn.text, 'finished')
    assert.equal(seen.length, 2)
    // The person's own Codex home as it is, then Dani's own, which shares the person's conversations.
    assert.equal(seen[0]!.env['CODEX_HOME'], undefined)
    assert.equal(seen[1]!.env['CODEX_HOME'], join(folder, 'home'))
    assert.equal(await readlink(join(folder, 'home', 'sessions')), join(env.HOME, '.codex', 'sessions'))
    assert.equal(await readlink(join(folder, 'home', 'auth.json')), join(folder, 'auth.json'))
    // The same conversation, told to go on: the prompt is in it already.
    assert.deepEqual(seen[1]!.messages.find(m => m.method === 'thread/resume')?.params?.['threadId'], 'thread-1')
    assert.equal(said(seen[1]!), goOn('Codex'))
    assert.deepEqual(events.filter(e => e.type === 'notice'), [{ type: 'notice', message: "↻ Switched to Dani's Codex: Rom's hit its limit, free again in 2 h." }])
    const after = readAccounts(path)
    assert.equal(after.find(a => a.name === 'Rom')?.limitedUntil, NOW + 2 * HOUR)
    assert.deepEqual(after.find(a => a.name === 'Rom')?.windows?.map(w => [w.window, w.percentUsed]), [['five_hour', 100], ['seven_day', 61]])
    assert.deepEqual(after.find(a => a.name === 'Dani')?.windows?.map(w => [w.window, w.percentUsed]), [['five_hour', 20]])
    // The session stays on Dani's.
    await session.prompt('and the test')
    assert.equal(seen[2]!.env['CODEX_HOME'], join(folder, 'home'))
  }))

test('a Codex run with skills off goes on an added account from a home with only the conversations of OpenAgent\'s own kept home', () =>
  inDir(async dir => {
    const env = { HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_STATE_HOME: join(dir, 'state') }
    const path = codexAccountsPath(env)
    addAccount('Dani', 'codex-dani', path)
    const folder = join(codexAccountsDir(env), 'codex-dani')
    await mkdir(folder, { recursive: true })
    const seen: Seen[] = []
    const session = await new CodexDriver({ spawn: turns(() => 'done', seen), env, personal: { memory: false, connectors: true, skills: false }, accounts: { prefer: 'Dani', now: () => NOW } }).start({ cwd: dir })
    await session.prompt('go')
    assert.equal(seen[0]!.env['CODEX_HOME'], join(folder, 'plain'))
    assert.equal(await readlink(join(folder, 'plain', 'sessions')), join(env.XDG_STATE_HOME, 'agent-driver', 'codex-home', 'sessions'))
  }))

test('with every Codex account at its limit the turn ends, saying which frees first; another failure is no limit to switch over', () =>
  inDir(async dir => {
    const env = { HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_STATE_HOME: join(dir, 'state') }
    const path = codexAccountsPath(env)
    addAccount('Dani', 'codex-dani', path)
    await mkdir(join(codexAccountsDir(env), 'codex-dani'), { recursive: true })
    const seen: Seen[] = []
    const session = await new CodexDriver({ spawn: turns(() => 'limit', seen), env, accounts: { now: () => NOW } }).start({ cwd: dir })
    await assert.rejects(session.prompt('go'), (err: unknown) => err instanceof UsageLimitError && err.message === "All 2 Codex accounts are at their limit: This computer's is free again in 2 h.")
    assert.equal(seen.length, 2)

    const other = join(dir, 'other')
    const otherEnv = { ...env, XDG_CONFIG_HOME: other }
    addAccount('Dani', 'codex-dani', codexAccountsPath(otherEnv))
    const failing: Seen[] = []
    const failed = await new CodexDriver({
      spawn: fakeServer((method, params, send) => {
        if (method === 'thread/start') return send({ id: params['id'], result: { thread: { id: 'thread-1' } } })
        if (method !== 'turn/start') return
        send({ id: params['id'], result: { turn: { id: 'turn-1' } } })
        send({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'failed', error: { message: 'The model is not supported.', codexErrorInfo: 'badRequest' } } } })
      }, failing),
      env: otherEnv,
      accounts: { now: () => NOW },
    }).start({ cwd: dir })
    await assert.rejects(failed.prompt('go'), /not supported/)
    assert.equal(failing.length, 1)
    assert.equal(readAccounts(codexAccountsPath(otherEnv)).some(a => a.limitedUntil !== undefined), false)
  }))
