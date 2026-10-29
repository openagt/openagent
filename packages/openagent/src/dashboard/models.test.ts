import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DriverModel } from '@openagt/agent-driver'
import { cachedModelsSource } from './models.js'

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
