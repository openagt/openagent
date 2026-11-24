import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { firstAccountOf, modelsAskedOnce, modelsOf } from './models.js'
import { accountsPath, addAccount, useFirst } from './accounts/accounts.js'
import type { DriverModel, RunAgent } from '@openagt/hooks'

/** An agent's question that answers each ask with the next of `answers`, counting the asks. */
function asking(...answers: Array<DriverModel[] | Error>) {
  const counted = {
    asks: 0,
    ask: async () => {
      const answer = answers[Math.min(counted.asks++, answers.length - 1)]!
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  return counted
}

/** A coding agent whose models are `read`. */
function agent(read?: RunAgent['models']): RunAgent {
  return { id: 'codex', label: 'Codex', ready: async () => ({ problems: [], warnings: [] }), driver: () => ({}) as never, ...(read ? { models: read } : {}) }
}

test('an agent is asked once, and its answer is kept', async () => {
  const claude = asking([{ id: 'opus', name: 'Opus 5.5' }])
  const models = modelsAskedOnce(claude.ask)
  const [first, second] = await Promise.all([models.read(), models.read()])
  assert.deepEqual(first, [{ id: 'opus', name: 'Opus 5.5' }])
  assert.deepEqual(await models.read(), second)
  assert.equal(claude.asks, 1)
})

test('an agent that could not say is asked again at the next read', async () => {
  const codex = asking(new Error('`codex` could not start: ENOENT'), [{ id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' }])
  const models = modelsAskedOnce(codex.ask)
  await assert.rejects(models.read(), /could not start/)
  assert.deepEqual(await models.read(), [{ id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' }])
  assert.equal(codex.asks, 2)
})

test('an agent is asked again once its runs take another account first: each account lists what it may use', async () => {
  const claude = asking([{ id: 'opus', name: 'Opus' }], [{ id: 'opus', name: 'Opus 5.5' }])
  let first = 'This computer'
  const models = modelsAskedOnce(claude.ask, () => first)
  assert.deepEqual(await models.read(), [{ id: 'opus', name: 'Opus' }])
  assert.deepEqual(await models.read(), [{ id: 'opus', name: 'Opus' }])
  first = 'Suleiman'
  assert.deepEqual(await models.read(), [{ id: 'opus', name: 'Opus 5.5' }])
  assert.equal(claude.asks, 2)
})

test('a fresh read asks again: a new version can offer other models', async () => {
  const codex = asking([{ id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' }], [{ id: 'gpt-6-luna', name: 'GPT-6-Luna' }])
  const models = modelsAskedOnce(codex.ask)
  await models.read()
  assert.deepEqual(await models.read({ fresh: true }), [{ id: 'gpt-6-luna', name: 'GPT-6-Luna' }])
  assert.equal(codex.asks, 2)
})

test('what an agent says it offers names why it could not say, and marks a program that is missing by the code its error carries', async () => {
  assert.deepEqual(await modelsOf(agent(async () => [{ id: 'opus', name: 'Opus' }])), { models: [{ id: 'opus', name: 'Opus' }] })
  assert.deepEqual(await modelsOf(agent(async () => Promise.reject(new Error('it said no')))), { models: [], error: 'it said no' })
  const missing = Object.assign(new Error('`codex` could not start: spawn codex ENOENT'), { code: 'ENOENT' })
  assert.deepEqual(await modelsOf(agent(async () => Promise.reject(missing))), { models: [], error: missing.message, missing: true })
  const unrunnable = Object.assign(new Error('`claude` could not start: spawn claude EACCES'), { code: 'EACCES' })
  assert.deepEqual(await modelsOf(agent(async () => Promise.reject(unrunnable))), { models: [], error: unrunnable.message, missing: true })
  assert.deepEqual(await modelsOf(agent()), { models: [], error: 'this agent cannot list its models' })
})

test("the account a list's runs take first is read from that list", () => {
  const dir = mkdtempSync(join(tmpdir(), 'models-first-'))
  try {
    const env = { XDG_CONFIG_HOME: dir }
    const own = firstAccountOf('claude', env)
    addAccount('Dani', 'codex-dani', accountsPath('codex', env))
    useFirst('Dani', accountsPath('codex', env))
    assert.equal(firstAccountOf('codex', env), 'Dani ')
    assert.equal(firstAccountOf('claude', env), own, "not the other list's")
    addAccount('Rom', 'sk-ant-oat01-rom', accountsPath('claude', env), new Date(), 'rom-account-id')
    useFirst('Rom', accountsPath('claude', env))
    assert.equal(firstAccountOf('claude', env), 'Rom rom-account-id')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
