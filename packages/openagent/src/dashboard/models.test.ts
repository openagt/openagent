import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { AccountRotation, DriverModel } from '@openagt/agent-driver'
import { cachedModelsSource, firstAccount, modelDrivers } from './models.js'
import { accountsPath, addAccount, useFirst } from '@openagt/skill-account-rotation'

/** A driver that answers each ask with the next of `answers`, counting the asks. */
function driver(...answers: Array<DriverModel[] | Error>) {
  const counted = {
    asks: 0,
    listModels: async () => {
      const answer = answers[Math.min(counted.asks++, answers.length - 1)]!
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  return counted
}

test('each coding agent is asked once, and its answer is kept', async () => {
  const claude = driver([{ id: 'opus', name: 'Opus 5.5' }])
  const codex = driver([{ id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' }])
  const source = cachedModelsSource({ 'claude-code': claude, codex })
  const [first, second] = await Promise.all([source.read(), source.read()])
  assert.deepEqual(first, {
    'claude-code': { models: [{ id: 'opus', name: 'Opus 5.5' }] },
    codex: { models: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' }] },
  })
  assert.deepEqual(await source.read(), second)
  assert.equal(claude.asks, 1)
  assert.equal(codex.asks, 1)
})

test('an agent that could not say is named with its reason and asked again at the next read', async () => {
  const codex = driver(new Error('`codex` could not start: ENOENT'), [{ id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' }])
  const source = cachedModelsSource({ 'claude-code': driver([]), codex })
  assert.deepEqual((await source.read()).codex, { models: [], error: '`codex` could not start: ENOENT' })
  assert.deepEqual((await source.read()).codex, { models: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' }] })
  assert.equal(codex.asks, 2)
})

test('an agent whose CLI is not on this computer is marked missing, by the code its error carries', async () => {
  const codex = driver(Object.assign(new Error('`codex` could not start: spawn codex ENOENT'), { code: 'ENOENT' }))
  const source = cachedModelsSource({ 'claude-code': driver([]), codex })
  assert.deepEqual((await source.read()).codex, { models: [], error: '`codex` could not start: spawn codex ENOENT', missing: true })
})

test('an agent without a way to list its models says so', async () => {
  const source = cachedModelsSource({ 'claude-code': driver([]), codex: {} })
  assert.deepEqual((await source.read()).codex, { models: [], error: 'this agent cannot list its models' })
})

test('an agent is asked again once its runs take another account first: each account lists what it may use', async () => {
  const claude = driver([{ id: 'opus', name: 'Opus' }], [{ id: 'opus', name: 'Opus 5.5' }])
  let first = 'This computer'
  const source = cachedModelsSource({ 'claude-code': claude, codex: driver([]) }, name => (name === 'claude-code' ? first : ''))
  assert.deepEqual((await source.read())['claude-code'], { models: [{ id: 'opus', name: 'Opus' }] })
  assert.deepEqual((await source.read())['claude-code'], { models: [{ id: 'opus', name: 'Opus' }] })
  first = 'Suleiman'
  assert.deepEqual((await source.read())['claude-code'], { models: [{ id: 'opus', name: 'Opus 5.5' }] })
  assert.equal(claude.asks, 2)
})

test('the account each agent\'s runs take first is read from that agent\'s own list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'models-first-'))
  try {
    const env = { XDG_CONFIG_HOME: dir }
    const own = firstAccount('codex', env)
    addAccount('Dani', 'codex-dani', accountsPath('codex', env))
    useFirst('Dani', accountsPath('codex', env))
    assert.equal(firstAccount('codex', env), 'Dani ')
    assert.equal(firstAccount('claude-code', env), own, 'not the other agent\'s')
    addAccount('Rom', 'sk-ant-oat01-rom', accountsPath('claude', env), new Date(), 'rom-account-id')
    useFirst('Rom', accountsPath('claude', env))
    assert.equal(firstAccount('claude-code', env), 'Rom rom-account-id')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the daemon asks each agent on the account its runs take first, from that agent\'s own list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'models-drivers-'))
  try {
    const env = { XDG_CONFIG_HOME: dir }
    addAccount('Dani', 'x', accountsPath('claude', env))
    useFirst('Dani', accountsPath('claude', env))
    const firstOf = (driver: unknown) => (driver as { opts: { accounts: AccountRotation } }).opts.accounts.first(env)?.name
    const drivers = modelDrivers()
    assert.equal(firstOf(drivers['claude-code']), 'Dani')
    assert.equal(firstOf(drivers.codex), 'This computer')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an agent forgotten is asked again at the next read, the other is not: a new version can offer other models', async () => {
  const claude = driver([{ id: 'opus', name: 'Opus' }])
  const codex = driver([{ id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' }], [{ id: 'gpt-6-luna', name: 'GPT-6-Luna' }])
  const source = cachedModelsSource({ 'claude-code': claude, codex })
  await source.read()
  source.forget('codex')
  assert.deepEqual((await source.read()).codex, { models: [{ id: 'gpt-6-luna', name: 'GPT-6-Luna' }] })
  assert.deepEqual([claude.asks, codex.asks], [1, 2])
})
