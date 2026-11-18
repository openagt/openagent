import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { fakeHost } from './testing.js'

// The fake host a module's tests drive: what it was asked, the runs it lists, and their streams.

test('a run started streams the events emitted, before it is read and after, and its stream ends when the run does', async () => {
  const host = fakeHost()
  const { id } = await host.start({ project: 'p1', prompt: 'fix the login', options: {} })
  host.emit(id, { type: 'text', text: 'one' })
  const read: string[] = []
  const reading = (async () => {
    for await (const event of host.events(id, new AbortController().signal)) read.push(event.type === 'text' ? event.text : event.type)
  })()
  await new Promise(resolve => setImmediate(resolve))
  host.emit(id, { type: 'text', text: 'two' })
  host.end(id, 'done')
  await reading
  assert.deepEqual(read, ['one', 'two'])
  const [run] = await host.list('p1')
  assert.equal(run?.status, 'done')
  assert.ok(run?.endedAt, 'an ended run says when')
})

test('runs are listed newest first, one project at a time when asked; a stop ends a run, a resume starts it working again', async () => {
  const host = fakeHost({ id: 'here', label: 'This computer' })
  const a = await host.start({ project: 'p1', prompt: 'a', options: {} })
  const b = await host.start({ project: 'p2', prompt: 'b', options: {} })
  await host.start({ prompt: 'c', options: {} })
  assert.deepEqual((await host.list()).map(run => run.prompt), ['c', 'b', 'a'])
  assert.deepEqual((await host.list('p1')).map(run => run.id), [a.id])
  await host.steer(a.id, 'the docs too')
  await host.stop(a.id)
  assert.equal((await host.list('p1'))[0]?.status, 'stopped')
  await host.resume(a.id, { text: 'go on' })
  const [again] = await host.list('p1')
  assert.equal(again?.status, 'working')
  assert.equal(again?.endedAt, undefined, 'a run working again has not ended')
  assert.deepEqual(host.requests.map(request => request.prompt), ['a', 'b', 'c'])
  assert.deepEqual(host.steered, [{ id: a.id, text: 'the docs too' }])
  assert.deepEqual(host.stopped, [{ id: a.id, force: false }])
  assert.deepEqual(host.resumed, [{ id: a.id, input: { text: 'go on' } }])
  const stop = new AbortController()
  const reading = (async () => {
    const read: unknown[] = []
    for await (const event of host.events(b.id, stop.signal)) read.push(event)
    return read
  })()
  stop.abort()
  assert.deepEqual(await reading, [], 'a stream ends when its signal aborts')
  await assert.rejects(host.steer('run-9', 'x'), /No run run-9 here/)
})
