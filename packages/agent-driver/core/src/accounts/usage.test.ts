import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { AgentLogins } from '@openagt/hooks'
import { accountsPath, addAccount, noteWindows } from './accounts.js'
import { runCli } from './cli.js'
import { testLogins } from './test-logins.js'
import { loginWiring } from './wiring.js'

// How full each account is: what its agent reads now (`RunAgent.accounts`, tested in each adapter),
// else what its last run saw.

const NOW = 1_800_000_000_000
const HOUR = 3_600_000

async function inDir(body: (env: NodeJS.ProcessEnv) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'account-rotation-usage-'))
  try {
    await body({ HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_STATE_HOME: join(dir, 'state') })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

type Said = Record<string, { name: string; windows: { window: string; percentUsed: number; resetsAt?: number }[]; at?: number }[]>

async function usage(env: NodeJS.ProcessEnv, ...logins: AgentLogins[]): Promise<Said> {
  const out: string[] = []
  const code = await runCli(['usage'], { stdout: line => out.push(line), stderr: () => {}, env, wiring: { ...loginWiring(env), now: () => NOW, logins: () => Promise.resolve(logins) } })
  assert.equal(code, 0)
  return JSON.parse(out[0]!) as Said
}

test("each list's accounts in the order runs try them, as their agent reads them now: shortest window first, one no person reads left out", () =>
  inDir(async env => {
    addAccount('Dani', 'codex-dani', accountsPath('codex', env))
    const asked: string[] = []
    const codex = testLogins('codex', {
      usage: account => {
        asked.push(account.name)
        return Promise.resolve(account.login === undefined ? undefined : [{ window: 'seven_day', percentUsed: 12 }, { window: 'seven_day_opus', percentUsed: 90 }, { window: 'five_hour', percentUsed: 2 }])
      },
    })
    const said = await usage(env, testLogins('claude'), codex)
    assert.deepEqual(Object.keys(said), ['claude', 'codex'])
    assert.deepEqual(asked, ['This computer', 'Dani'])
    assert.deepEqual(said['codex'], [
      { name: 'This computer', windows: [] },
      { name: 'Dani', windows: [{ window: 'five_hour', percentUsed: 2 }, { window: 'seven_day', percentUsed: 12 }] },
    ])
  }))

test("an account its agent cannot read now says what its last run saw, as of then, a window gone past its reset empty again; its login is never said", () =>
  inDir(async env => {
    const path = accountsPath('claude', env)
    addAccount('Work', 'sk-ant-oat01-secret', path)
    noteWindows('Work', [{ window: 'five_hour', percentUsed: 80, resetsAt: NOW - HOUR }, { window: 'seven_day', percentUsed: 40, resetsAt: NOW + HOUR }], NOW - 2 * HOUR, path)
    const said = await usage(env, testLogins('claude'))
    assert.deepEqual(said['claude']![1], { name: 'Work', windows: [{ window: 'five_hour', percentUsed: 0, resetsAt: NOW - HOUR }, { window: 'seven_day', percentUsed: 40, resetsAt: NOW + HOUR }], at: NOW - 2 * HOUR })
    assert.doesNotMatch(JSON.stringify(said), /secret/)
  }))

test('a reading that throws is the same as none: what the last run saw, or nothing', () =>
  inDir(async env => {
    const path = accountsPath('claude', env)
    noteWindows('This computer', [{ window: 'seven_day', percentUsed: 30, resetsAt: NOW + HOUR }], NOW - HOUR, path)
    const said = await usage(env, testLogins('claude', { usage: () => Promise.reject(new Error('claude is not installed')) }), testLogins('codex', { usage: () => Promise.reject(new Error('no Codex here')) }))
    assert.deepEqual(said['claude'], [{ name: 'This computer', windows: [{ window: 'seven_day', percentUsed: 30, resetsAt: NOW + HOUR }], at: NOW - HOUR }])
    assert.deepEqual(said['codex'], [{ name: 'This computer', windows: [] }])
  }))
