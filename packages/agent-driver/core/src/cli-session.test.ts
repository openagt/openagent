import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { PassThrough, Readable, Writable } from 'node:stream'
import { AgentExitError, runCliSession, type AgentCliParser, type CliIo, type SpawnLike, type SpawnedProcess } from './cli-session.js'
import type { DriverEvent } from './types.js'

test('runCliSession streams the parser events and resolves the final turn', async () => {
  const events: DriverEvent[] = []
  const parser: AgentCliParser = {
    push: line => (line === 'hi' ? [{ type: 'text', text: 'hi' }] : []),
    result: () => ({ text: 'done', sessionId: 's1' }),
  }
  const stdout = Readable.from(['hi\n'])
  const spawn: SpawnLike = () => {
    const proc: SpawnedProcess = {
      stdout,
      stderr: Readable.from([]),
      stdin: new Writable({ write: (_c, _e, cb) => cb() }),
      on(event, listener) {
        if (event === 'close') stdout.on('end', () => (listener as (c: number | null) => void)(0))
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
  const turn = await runCliSession({
    bin: 'agent',
    args: [],
    cwd: '/ws',
    env: {},
    prompt: 'go',
    spawn,
    emit: e => events.push(e),
    signals: [],
    driver: 'agent',
    parser,
  })
  assert.deepEqual(turn, { text: 'done', sessionId: 's1' })
  assert.equal(events[0]!.type, 'start')
  assert.ok(events.some(e => e.type === 'text'))
  assert.equal(events.at(-1)!.type, 'result')
})

test('an stdin write error fails the turn cleanly, not as an uncaught exception (#943)', async () => {
  // stdin that errors asynchronously, the shape a pipe takes when the CLI exited before reading.
  const stdin = new Writable({ write: (_c, _e, cb) => cb(new Error('EPIPE: broken pipe')) })
  let fireClose: (code: number | null) => void = () => {}
  const spawn: SpawnLike = () => {
    const proc: SpawnedProcess = {
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      stdin,
      on(event, listener) {
        if (event === 'close') fireClose = listener as (c: number | null) => void
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
  const promise = runCliSession({
    bin: 'agent',
    args: [],
    cwd: '/ws',
    env: {},
    prompt: 'go',
    spawn,
    emit: () => {},
    signals: [],
    driver: 'agent',
    parser: { push: () => [], result: () => ({ text: '' }) },
  })
  // Let the stream's async 'error' emission land; with no listener it is an uncaught exception.
  await new Promise(resolvePromise => setImmediate(resolvePromise))
  fireClose(1) // the crashed CLI reports its non-zero exit
  await assert.rejects(promise, /exited/)
})

test('a real CLI that exits before reading stdin does not crash the process (#943)', async () => {
  // A prompt larger than the pipe buffer, so the write is still pending when the child dies
  // and the kernel answers with a real EPIPE.
  const turn = await runCliSession({
    bin: process.execPath,
    args: ['-e', 'process.exit(0)'],
    cwd: process.cwd(),
    env: process.env,
    prompt: 'x'.repeat(1024 * 1024),
    spawn: spawn as unknown as SpawnLike,
    emit: () => {},
    signals: [],
    driver: 'agent',
    parser: { push: () => [], result: () => ({ text: 'ok' }) },
  })
  assert.equal(turn.text, 'ok')
  // Give the late EPIPE its window inside this test, so an unswallowed one fails here, not elsewhere.
  await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
})

test('runCliSession emits no telemetry when the process closes after an abort', async () => {
  const events: DriverEvent[] = []
  const controller = new AbortController()
  // A process whose `close` fires only when the test triggers it, so we can order
  // the abort strictly before the (killed) process's late exit.
  let fireClose: (code: number | null) => void = () => {}
  const spawn: SpawnLike = () => {
    const proc: SpawnedProcess = {
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      stdin: new Writable({ write: (_c, _e, cb) => cb() }),
      on(event, listener) {
        if (event === 'close') fireClose = listener as (c: number | null) => void
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
  const promise = runCliSession({
    bin: 'agent',
    args: [],
    cwd: '/ws',
    env: {},
    prompt: 'go',
    spawn,
    emit: e => events.push(e),
    signals: [controller.signal],
    driver: 'agent',
    parser: { push: () => [], result: () => ({ text: '' }) },
  })
  controller.abort()
  fireClose(null) // the killed process reports its exit after the abort already rejected
  await assert.rejects(promise, /aborted/)
  assert.ok(!events.some(e => e.type === 'error'), 'no error event after abort')
  assert.ok(!events.some(e => e.type === 'result'), 'no result event after abort')
})

test('a non-zero exit sends the reason as an error event, and fails the turn with the same reason kept apart', async () => {
  const stdout = Readable.from([])
  const proc: SpawnedProcess = {
    stdout,
    stderr: Readable.from([]),
    stdin: new Writable({ write: (_c, _e, cb) => cb() }),
    on(event, listener) {
      if (event === 'close') stdout.on('end', () => (listener as (c: number | null) => void)(1))
      return proc
    },
    kill: () => undefined,
  }
  const events: DriverEvent[] = []
  const promise = runCliSession({
    bin: 'agent',
    args: [],
    cwd: '/ws',
    env: {},
    prompt: 'go',
    spawn: () => proc,
    emit: event => events.push(event),
    signals: [],
    driver: 'agent',
    parser: { push: () => [], result: () => ({ text: '' }), failure: () => "You've hit your usage limit." },
  })
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof AgentExitError)
    assert.equal(err.message, "agent exited (1): You've hit your usage limit.")
    assert.equal(err.exit, 'agent exited (1)')
    assert.equal(err.reason, "You've hit your usage limit.")
    return true
  })
  assert.deepEqual(events.at(-1), { type: 'error', message: "You've hit your usage limit." })
})

test('a parser that converses writes to the CLI as it reads, and stdin stays open until it ends it', async () => {
  const stdout = new PassThrough()
  const written: string[] = []
  let ended = false
  const stdin = new Writable({
    write: (chunk, _e, cb) => (written.push(String(chunk)), cb()),
    final: cb => ((ended = true), stdout.end(), cb()),
  })
  const proc: SpawnedProcess = {
    stdout,
    stderr: Readable.from([]),
    stdin,
    on(event, listener) {
      if (event === 'close') stdout.on('end', () => setImmediate(() => (listener as (c: number | null) => void)(0)))
      return proc
    },
    kill: () => undefined,
  }
  let io: CliIo | undefined
  const parser: AgentCliParser = {
    converse: given => ((io = given), given.write('hello')),
    push: line => {
      if (line === 'ready') io!.write('go')
      if (line === 'done') io!.end()
      return []
    },
    result: () => ({ text: 'answered' }),
  }
  const promise = runCliSession({ bin: 'agent', args: [], cwd: '/ws', env: {}, prompt: 'the prompt', spawn: () => proc, emit: () => {}, signals: [], driver: 'agent', parser })
  stdout.write('ready\n')
  await new Promise(resolve => setImmediate(resolve))
  // Neither the prompt written whole nor stdin closed: the parser speaks for itself.
  assert.deepEqual(written, ['hello\n', 'go\n'])
  assert.equal(ended, false)
  stdout.write('done\n')
  assert.deepEqual(await promise, { text: 'answered' })
  assert.equal(ended, true)
})

test('a turn the parser says failed fails, even when the process exits 0', async () => {
  const run = (failure: string) => {
    const stdout = Readable.from([])
    const proc: SpawnedProcess = {
      stdout,
      stderr: Readable.from([]),
      stdin: new Writable({ write: (_c, _e, cb) => cb() }),
      on(event, listener) {
        if (event === 'close') stdout.on('end', () => (listener as (c: number | null) => void)(0))
        return proc
      },
      kill: () => undefined,
    }
    return runCliSession({ bin: 'agent', args: [], cwd: '/ws', env: {}, prompt: 'go', spawn: () => proc, emit: () => {}, signals: [], driver: 'agent', parser: { push: () => [], result: () => ({ text: 'half an answer' }), failure: () => failure } })
  }
  await assert.rejects(run('The model is not supported.'), (err: unknown) => {
    assert.ok(err instanceof AgentExitError)
    // "failed", not "exited (0)": the process ended fine, the turn did not.
    assert.equal(err.message, 'agent failed: The model is not supported.')
    assert.equal(err.exit, 'agent failed')
    return true
  })
  // Failed without a reason: its output stopped before the turn ended. The partial text is no reason.
  await assert.rejects(run(''), /agent failed: the turn did not finish/)
})

/** A process whose output and end the test drives: `say` writes a line of output, `exit` closes it. */
function drivenProcess() {
  const stdout = new PassThrough()
  let fireClose: (code: number | null) => void = () => {}
  const killed: string[] = []
  const spawn: SpawnLike = () => {
    const proc: SpawnedProcess = {
      stdout,
      stderr: Readable.from([]),
      stdin: new Writable({ write: (_c, _e, cb) => cb() }),
      on(event, listener) {
        if (event === 'close') fireClose = listener as (c: number | null) => void
        return proc
      },
      kill: signal => {
        killed.push(String(signal))
      },
    }
    return proc
  }
  return {
    spawn,
    killed,
    say: (line: string) => stdout.write(line + '\n'),
    exit: (code: number | null) => {
      stdout.end()
      setImmediate(() => fireClose(code))
    },
  }
}

const tick = (ms = 20) => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

test('a stop the agent can be asked for ends the turn as stopped, not failed, and kills nothing', async () => {
  const agent = drivenProcess()
  let asked = 0
  const parser: AgentCliParser = {
    push: () => [],
    result: () => ({ text: '', ...(asked > 0 ? { stopped: true as const } : {}) }),
    stop: () => {
      asked++
      return true
    },
  }
  const stop = new AbortController()
  const turn = runCliSession({ bin: 'agent', args: [], cwd: '/ws', env: {}, prompt: 'go', spawn: agent.spawn, emit: () => {}, signals: [], driver: 'agent', parser, stop: stop.signal })
  stop.abort()
  assert.equal(asked, 1, 'the agent is asked to stop')
  // The CLI says its stopped turn failed, and exits so.
  agent.exit(1)
  assert.deepEqual(await turn, { text: '', stopped: true })
  assert.deepEqual(agent.killed, [], 'nothing was killed')
})

test('a stop the agent cannot be asked for ends its process instead', async () => {
  const agent = drivenProcess()
  const stop = new AbortController()
  const turn = runCliSession({ bin: 'agent', args: [], cwd: '/ws', env: {}, prompt: 'go', spawn: agent.spawn, emit: () => {}, signals: [], driver: 'agent', parser: { push: () => [], result: () => ({ text: '' }), stop: () => false }, stop: stop.signal })
  stop.abort()
  await assert.rejects(turn, /aborted/)
  assert.deepEqual(agent.killed, ['SIGTERM'])
})

test('the inbox is read while the turn runs: a message goes to the agent at once, one for later and one it never read are held, one taken back is not', async () => {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { appendInbox } = await import('./inbox.js')
  const inbox = join(await mkdtemp(join(tmpdir(), 'inbox-read-')), 'inbox.jsonl')
  const agent = drivenProcess()
  const steered: { id: string; text: string; words: string }[] = []
  const withdrawn: string[] = []
  let hurried = 0
  const parser: AgentCliParser = {
    // The agent reads a message when the CLI repeats its id.
    push: line => (line.startsWith('read ') ? [{ type: 'steered', text: 'Now.', id: line.slice(5) }] : []),
    result: () => ({ text: 'done' }),
    steer: message => {
      steered.push(message)
      return true
    },
    withdraw: id => withdrawn.push(id),
    hurry: () => hurried++,
  }
  const events: DriverEvent[] = []
  const turn = runCliSession({
    bin: 'agent',
    args: [],
    cwd: '/ws',
    env: {},
    prompt: 'go',
    spawn: agent.spawn,
    emit: e => events.push(e),
    signals: [],
    driver: 'agent',
    parser,
    inbox,
    steered: async line => `${line.text}\n\nCommit your work.`,
  })
  await appendInbox(inbox, { kind: 'message', text: 'Now.', id: 'a' })
  await appendInbox(inbox, { kind: 'message', text: 'After.', id: 'b', later: true })
  await appendInbox(inbox, { kind: 'message', text: 'Never mind.', id: 'c' })
  await appendInbox(inbox, { kind: 'message', text: 'Unread.', id: 'd' })
  await appendInbox(inbox, { kind: 'cancel', id: 'c' })
  await appendInbox(inbox, { kind: 'now' })
  await tick(400)
  assert.deepEqual(steered.map(m => m.id), ['a', 'c', 'd'], 'every message not for later went to the agent')
  assert.deepEqual(steered[0], { id: 'a', text: 'Now.', words: 'Now.\n\nCommit your work.' })
  assert.deepEqual(withdrawn, ['c'])
  assert.equal(hurried, 1)
  agent.say('read a')
  await tick()
  agent.exit(0)
  const done = await turn
  assert.deepEqual(done.held?.map(line => (line.kind === 'message' ? line.id : line.kind)), ['b', 'd'], 'what the agent never read is held, in order')
  assert.ok(events.some(e => e.type === 'steered' && e.id === 'a'), 'the landing is said')
})
