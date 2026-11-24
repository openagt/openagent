import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { ProjectRef } from './project.js'
import { fakeHost } from './testing.js'

const P1: ProjectRef = { id: 'p1', name: 'shop', dir: '/work/shop' }
const P2: ProjectRef = { id: 'p2', name: 'blog', dir: '/work/blog' }

// The fake host a module's tests drive: what it was asked, the runs it lists, and their streams.

test('a run started streams the events emitted, before it is read and after, and its stream ends when the run does', async () => {
  const host = fakeHost()
  const { id } = await host.start({ project: P1, prompt: 'fix the login', options: {} })
  host.emit(id, { kind: 'log', message: 'one' })
  const read: string[] = []
  const reading = (async () => {
    for await (const event of host.events({ id, project: P1 }, new AbortController().signal)) read.push(event.kind === 'log' ? event.message : event.kind)
  })()
  await new Promise(resolve => setImmediate(resolve))
  host.emit(id, { kind: 'log', message: 'two' })
  host.end(id, 'done')
  await reading
  assert.deepEqual(read, ['one', 'two'])
  const [run] = await host.list(P1)
  assert.equal(run?.status, 'done')
  assert.ok(run?.endedAt, 'an ended run says when')
})

test('runs are listed newest first, one project at a time; a line reaches a working run, a stop ends it, and a line to an ended run resumes it', async () => {
  const host = fakeHost({ id: 'here', label: 'This computer' })
  const a = await host.start({ project: P1, prompt: 'a', options: {} })
  const b = await host.start({ project: P2, prompt: 'b', options: {} })
  const c = await host.start({ prompt: 'c', options: {} })
  const d = await host.start({ project: P1, prompt: 'd', options: {} })
  assert.deepEqual((await host.list(P1)).map(run => run.prompt), ['d', 'a'])
  assert.deepEqual((await host.list()).map(run => run.id), [c.id], 'with no project: the sessions with none')
  const run = { id: a.id, project: P1 }
  await host.steer(run, { kind: 'message', text: 'the docs too' })
  await host.stop(run)
  assert.equal((await host.list(P1))[1]?.status, 'stopped')
  await host.steer(run, { kind: 'message', text: 'go on' })
  const again = (await host.list(P1))[1]
  assert.equal(again?.status, 'working')
  assert.equal(again?.endedAt, undefined, 'a run working again has not ended')
  await host.resume({ id: d.id, project: P1 }, { answer: 'Left' })
  assert.deepEqual(host.requests.map(request => request.prompt), ['a', 'b', 'c', 'd'])
  assert.deepEqual(host.steered, [{ id: a.id, line: { kind: 'message', text: 'the docs too' } }])
  assert.deepEqual(host.stopped, [{ id: a.id, force: false }])
  assert.deepEqual(host.resumed, [{ id: a.id, input: { text: 'go on' } }, { id: d.id, input: { answer: 'Left' } }])
  const stop = new AbortController()
  const reading = (async () => {
    const read: unknown[] = []
    for await (const event of host.events({ id: b.id, project: P2 }, stop.signal)) read.push(event)
    return read
  })()
  stop.abort()
  assert.deepEqual(await reading, [], 'a stream ends when its signal aborts')
  await assert.rejects(host.steer({ id: 'run-9' }, { kind: 'now' }), /No run run-9 here/)
})

test('a run the host started is found, with what a test placed of its work once it is placed; a run it never started is not', async () => {
  const host = fakeHost()
  const { id } = await host.start({ project: P1, prompt: 'fix the login', options: {} })
  assert.deepEqual(await host.find({ id, project: P1 }), { changedNothing: false })
  host.place(id, { checkout: '/work/shop/.branches/agent-1', record: { status: 'running', branch: 'agent-fix-login' }, changedNothing: false })
  assert.deepEqual(await host.find({ id, project: P1 }), { checkout: '/work/shop/.branches/agent-1', record: { status: 'running', branch: 'agent-fix-login' }, changedNothing: false })
  assert.equal(await host.find({ id: 'run-9', project: P1 }), undefined)
})
