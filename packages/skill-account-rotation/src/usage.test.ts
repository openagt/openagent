import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { DriverQuota } from '@openagt/agent-driver'
import { accountsPath, addAccount, noteWindows } from './accounts.js'
import { runCli } from './cli.js'
import { loginWiring, type LoginWiring } from './login.js'
import { claudeUsagePath, keepClaudeReading, READING_KEPT_MS } from './usage.js'

const NOW = 1_800_000_000_000
const HOUR = 3_600_000

const READING: DriverQuota = {
  available: true,
  windows: [
    { label: 'Current week (all models)', kind: 'week', percentUsed: 12 },
    { label: 'Current session', kind: 'session', percentUsed: 2 },
    { label: 'Current week (Opus)', kind: 'week-model', percentUsed: 90 },
  ],
}

async function inDir(body: (env: NodeJS.ProcessEnv) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'account-rotation-usage-'))
  try {
    await body({ HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_STATE_HOME: join(dir, 'state') })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** A computer signed in to Claude only, unless a test says more; counts the reads of `/usage`. */
function computer(env: NodeJS.ProcessEnv, more: Partial<LoginWiring> = {}, quota: () => Promise<DriverQuota> = () => Promise.resolve(READING)): { wiring: LoginWiring; reads: () => number } {
  let reads = 0
  const wiring: LoginWiring = {
    ...loginWiring(env),
    now: () => NOW,
    env: { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'a login in the environment' },
    claudeQuota: () => {
      reads += 1
      return quota()
    },
    codexWho: () => Promise.resolve({}),
    codexUsage: () => Promise.reject(new Error('no Codex here')),
    ...more,
  }
  return { wiring, reads: () => reads }
}

async function usage(env: NodeJS.ProcessEnv, wiring: LoginWiring): Promise<Record<'claude' | 'codex', { name: string; windows: { window: string; percentUsed: number }[]; at?: number }[]>> {
  const out: string[] = []
  const code = await runCli(['usage'], { stdout: line => out.push(line), stderr: () => {}, env, wiring })
  assert.equal(code, 0)
  return JSON.parse(out[0]!)
}

test("the person's own Claude login is read now, its windows shortest first, a single model's week left out", () =>
  inDir(async env => {
    const { wiring } = computer(env)
    const said = await usage(env, wiring)
    assert.deepEqual(said.claude, [{ name: 'This computer', windows: [{ window: 'five_hour', percentUsed: 2 }, { window: 'seven_day', percentUsed: 12 }] }])
  }))

test('a good reading serves everyone for a while, so Claude is not asked again; then it is', () =>
  inDir(async env => {
    const { wiring, reads } = computer(env)
    await usage(env, wiring)
    await usage(env, wiring)
    assert.equal(reads(), 1)
    const later = { ...wiring, now: () => NOW + READING_KEPT_MS }
    await usage(env, later)
    assert.equal(reads(), 2)
  }))

test("OpenAgent's poller keeping its reading means the command does not ask at all", () =>
  inDir(async env => {
    keepClaudeReading(READING, claudeUsagePath(env), NOW - 60_000)
    const { wiring, reads } = computer(env)
    const said = await usage(env, wiring)
    assert.equal(reads(), 0)
    assert.equal(said.claude[0]!.windows.length, 2)
  }))

test('a failed reading is not kept, and says what the last run saw, as of then', () =>
  inDir(async env => {
    const path = accountsPath('claude', env)
    addAccount('Spare', 'sk-ant-oat01-secret', path)
    noteWindows('This computer', [{ window: 'seven_day', percentUsed: 30, resetsAt: NOW + HOUR }], NOW - HOUR, path)
    const { wiring, reads } = computer(env, {}, () => Promise.resolve({ available: false, reason: 'no-subscription' }))
    const said = await usage(env, wiring)
    assert.deepEqual(said.claude[0], { name: 'This computer', windows: [{ window: 'seven_day', percentUsed: 30, resetsAt: NOW + HOUR }], at: NOW - HOUR })
    await assert.rejects(readFile(claudeUsagePath(env)))
    await usage(env, wiring)
    assert.equal(reads(), 2)
  }))

test('a reading that throws, and a kept file that does not read, are the same as none', () =>
  inDir(async env => {
    const { wiring } = computer(env, {}, () => Promise.reject(new Error('claude is not installed')))
    assert.deepEqual((await usage(env, wiring)).claude, [{ name: 'This computer', windows: [] }])
    await writeFile(join(env['XDG_CONFIG_HOME']!, 'openagent-claude-usage.json'), 'not json').catch(() => {})
    assert.deepEqual((await usage(env, wiring)).claude, [{ name: 'This computer', windows: [] }])
  }))

test('nobody signed in to Claude: it is not asked', () =>
  inDir(async env => {
    const { wiring, reads } = computer(env, { env })
    await usage(env, wiring)
    assert.equal(reads(), 0)
  }))

test("an added Claude login says what its last run saw, a window gone past its reset is empty again, and its login is never said", () =>
  inDir(async env => {
    const path = accountsPath('claude', env)
    addAccount('Work', 'sk-ant-oat01-secret', path)
    noteWindows('Work', [{ window: 'five_hour', percentUsed: 80, resetsAt: NOW - HOUR }, { window: 'seven_day', percentUsed: 40, resetsAt: NOW + HOUR }], NOW - 2 * HOUR, path)
    const { wiring } = computer(env)
    const said = await usage(env, wiring)
    assert.deepEqual(said.claude[1], { name: 'Work', windows: [{ window: 'five_hour', percentUsed: 0, resetsAt: NOW - HOUR }, { window: 'seven_day', percentUsed: 40, resetsAt: NOW + HOUR }], at: NOW - 2 * HOUR })
    assert.doesNotMatch(JSON.stringify(said), /secret/)
  }))

test('every Codex login is read now, and one nobody is signed in to is not asked', () =>
  inDir(async env => {
    const path = accountsPath('codex', env)
    addAccount('Dani', 'codex-dani', path)
    const asked: string[] = []
    const own = loginWiring(env).codexOwnHome()
    const { wiring } = computer(env, {
      codexWho: home => Promise.resolve(home === own ? {} : { key: 'dani/ws' }),
      codexUsage: home => {
        asked.push(home)
        return Promise.resolve([{ window: 'thirty_day', percentUsed: 10, resetsAt: NOW + HOUR }])
      },
    })
    const said = await usage(env, wiring)
    assert.deepEqual(asked, [loginWiring(env).codexFolder({ name: 'Dani', login: 'codex-dani' })])
    assert.deepEqual(said.codex, [{ name: 'This computer', windows: [] }, { name: 'Dani', windows: [{ window: 'thirty_day', percentUsed: 10, resetsAt: NOW + HOUR }] }])
  }))
