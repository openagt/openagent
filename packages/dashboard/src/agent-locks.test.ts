import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { withAgentLock } from './agent-locks.js'

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

test('withAgentLock serializes holders of the same checkout, in arrival order', async () => {
  const order: string[] = []
  let releaseFirst = (): void => {}
  const first = withAgentLock('/tmp/a', async () => {
    order.push('first:start')
    await new Promise<void>(resolve => (releaseFirst = resolve))
    order.push('first:end')
  })
  const second = withAgentLock('/tmp/a', async () => {
    order.push('second')
  })
  await tick()
  // The second holder must not have started while the first is parked.
  assert.deepEqual(order, ['first:start'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(order, ['first:start', 'first:end', 'second'])
})

test('different checkouts never contend', async () => {
  const order: string[] = []
  let release = (): void => {}
  const held = withAgentLock('/tmp/a', async () => {
    await new Promise<void>(resolve => (release = resolve))
    order.push('a')
  })
  await withAgentLock('/tmp/b', async () => {
    order.push('b')
  })
  assert.deepEqual(order, ['b']) // b finished while a was still parked
  release()
  await held
})

test('a failed holder surfaces its own error and does not poison the next one (#refuse-loudly)', async () => {
  await assert.rejects(
    withAgentLock('/tmp/a', async () => {
      throw new Error('teardown broke')
    }),
    /teardown broke/,
  )
  assert.equal(await withAgentLock('/tmp/a', async () => 'ran'), 'ran')
})

test('the key is the resolved path, so spellings of one checkout contend', async () => {
  const order: string[] = []
  let release = (): void => {}
  const held = withAgentLock('/tmp/a/.', async () => {
    await new Promise<void>(resolve => (release = resolve))
    order.push('held')
  })
  const waiter = withAgentLock('/tmp/a', async () => {
    order.push('waiter')
  })
  await tick()
  assert.deepEqual(order, [])
  release()
  await Promise.all([held, waiter])
  assert.deepEqual(order, ['held', 'waiter'])
})
