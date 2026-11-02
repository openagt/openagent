import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { EventStream } from '../event-stream.js'
import { forwardStream } from './stream-forward.js'

const tick = () => new Promise(r => setImmediate(r))

test('forwardStream replays a stream\'s buffered history then follows live (#426)', async () => {
  const stream = new EventStream<{ n: number }>()
  stream.push({ n: 1 })
  stream.push({ n: 2 }) // buffered before any consumer, like a viewer joining mid-run

  const got: number[] = []
  const stop = forwardStream(stream, e => got.push(e.n))
  await tick()
  assert.deepEqual(got, [1, 2]) // replayed history

  stream.push({ n: 3 }) // arrives live
  await tick()
  assert.deepEqual(got, [1, 2, 3])
  stop()
})

test('forwardStream stops on the returned stop fn: no events after it', async () => {
  const stream = new EventStream<{ n: number }>()
  const got: number[] = []
  const stop = forwardStream(stream, e => got.push(e.n))
  stream.push({ n: 1 })
  await tick()
  stop()
  stream.push({ n: 2 }) // after stop → must not be forwarded
  await tick()
  assert.deepEqual(got, [1])
})

test('forwardStream on an undefined source is a no-op with an idempotent stop', () => {
  const stop = forwardStream<{ n: number }>(undefined, () => assert.fail('should not send'))
  stop()
  stop() // idempotent
})
