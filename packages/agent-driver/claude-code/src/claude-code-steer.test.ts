import { strict as assert } from 'node:assert'
import { mock, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { StreamJsonParser } from './claude-code-stream.js'
import type { CliIo } from '@openagt/agent-driver'

// The lines Claude Code 2.1.318 writes around a message sent mid-turn, a Send now and a Stop, as
// read off real runs with `--replay-user-messages` (trimmed to the fields read).

/** A CliIo that keeps what was written. */
function recordingIo(): CliIo & { lines: Record<string, unknown>[] } {
  const io = {
    lines: [] as Record<string, unknown>[],
    write: (line: string) => void io.lines.push(JSON.parse(line) as Record<string, unknown>),
    end: () => {},
  }
  return io
}

const push = (parser: StreamJsonParser, line: Record<string, unknown>) => parser.push(JSON.stringify(line))

test('a message handed over mid-turn goes as a user line with its own uuid, and lands when the CLI repeats that uuid', () => {
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.talk(io)
  assert.equal(parser.steer({ id: 'm1', text: 'Also the README.', words: 'Also the README.\n\nCommit your work.' }), true)
  const sent = io.lines[0]!
  assert.equal(sent['type'], 'user')
  assert.deepEqual(sent['message'], { role: 'user', content: 'Also the README.\n\nCommit your work.' })
  const uuid = sent['uuid']
  assert.equal(typeof uuid, 'string')
  // The CLI repeats its own lines too: the prompt, a background task's note. Not the person's.
  assert.deepEqual(push(parser, { type: 'user', isReplay: true, uuid: 'other', message: { role: 'user', content: 'Do the task.' }, session_id: 's1' }).filter(e => e.type !== 'session'), [])
  assert.deepEqual(push(parser, { type: 'user', isReplay: true, uuid, message: { role: 'user', content: 'Also the README.\n\nCommit your work.' }, session_id: 's1' }), [{ type: 'steered', text: 'Also the README.', id: 'm1' }])
  // Said once.
  assert.deepEqual(push(parser, { type: 'user', isReplay: true, uuid, message: { role: 'user', content: 'x' }, session_id: 's1' }), [])
})

test('a message taken back goes as cancel_async_message with the uuid it was sent with', () => {
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.talk(io)
  parser.steer({ id: 'm1', text: 'Never mind.', words: 'Never mind.' })
  const uuid = io.lines[0]!['uuid']
  parser.withdraw('m1')
  assert.deepEqual((io.lines[1]!['request'] as Record<string, unknown>), { subtype: 'cancel_async_message', message_uuid: uuid })
  // Taken back, it never lands.
  assert.deepEqual(push(parser, { type: 'user', isReplay: true, uuid, message: { role: 'user', content: 'Never mind.' } }), [])
})

test('Send now puts what the agent waits on in the background, once a call has begun', () => {
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.talk(io)
  parser.steer({ id: 'm1', text: 'Now.', words: 'Now.' })
  // Before any call began, the request would do nothing: it waits for the next one.
  parser.hurry()
  assert.equal(io.lines.length, 1)
  push(parser, { type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'toolu_1', is_backgrounded: false, session_id: 's1' })
  assert.deepEqual(io.lines[1]!['request'], { subtype: 'background_tasks' })
  // Once in the background it is waited on no more: a Send now then waits for the next call.
  push(parser, { type: 'system', subtype: 'task_updated', task_id: 't1', patch: { is_backgrounded: true }, session_id: 's1' })
  parser.hurry()
  assert.equal(io.lines.length, 2)
  push(parser, { type: 'system', subtype: 'task_started', task_id: 't2', tool_use_id: 'toolu_2', is_backgrounded: false, session_id: 's1' })
  parser.hurry()
  assert.deepEqual(io.lines.slice(2).map(line => line['request']), [{ subtype: 'background_tasks' }, { subtype: 'background_tasks' }])
})

test('Send now with nothing waiting to be read asks nothing', () => {
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.talk(io)
  push(parser, { type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'toolu_1', is_backgrounded: false, session_id: 's1' })
  parser.hurry()
  assert.equal(io.lines.length, 0)
})

test('the person’s Stop interrupts the turn, which is then stopped, not failed; one that finished first stays finished', () => {
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.talk(io)
  assert.equal(parser.stop(), true)
  assert.deepEqual(io.lines[0]!['request'], { subtype: 'interrupt' })
  // A message after the stop is no longer taken.
  assert.equal(parser.steer({ id: 'm1', text: 'x', words: 'x' }), false)
  push(parser, { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's1' })
  assert.equal(parser.result().stopped, true)
  assert.equal(parser.answered, true)

  const done = new StreamJsonParser()
  done.talk(recordingIo())
  done.stop()
  push(done, { type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 's1' })
  assert.equal(done.result().stopped, undefined)
  // Over, it takes no stop.
  assert.equal(done.stop(), false)
})

test('a Stop while the agent waits on work in the background is a stop: the result it said while waiting is not the turn’s end', () => {
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.talk(io)
  push(parser, { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 't1' }], session_id: 's1' })
  push(parser, { type: 'result', subtype: 'success', is_error: false, result: 'I will wait for it.', session_id: 's1' })
  // Idle, the agent would not hear an interrupt: none is sent, and its process is ended at once.
  assert.equal(parser.stop(), 'idle')
  assert.deepEqual(io.lines, [])
  // The turn is the person's stop, not a failure.
  assert.equal(parser.result().stopped, true)
})

test('an agent the work in the background woke again hears the interrupt as any working agent does', () => {
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.talk(io)
  push(parser, { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 't1' }], session_id: 's1' })
  push(parser, { type: 'result', subtype: 'success', is_error: false, result: 'I will wait for it.', session_id: 's1' })
  push(parser, { type: 'assistant', message: { content: [{ type: 'text', text: 'It finished.' }] }, session_id: 's1' })
  assert.equal(parser.stop(), true)
  assert.deepEqual(io.lines[0]!['request'], { subtype: 'interrupt' })
})

test('a result while the agent waits on work in the background is not the turn’s end: a message still reaches it, and the result after the work is', () => {
  const parser = new StreamJsonParser()
  const io = recordingIo() as ReturnType<typeof recordingIo> & { ended?: boolean }
  io.end = () => void (io.ended = true)
  parser.talk(io)
  push(parser, { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 't1' }], session_id: 's1' })
  push(parser, { type: 'result', subtype: 'success', is_error: false, result: 'Waiting for it.', session_id: 's1' })
  assert.equal(io.ended, undefined, 'stdin stays open')
  assert.equal(parser.answered, false)
  assert.equal(parser.steer({ id: 'm1', text: 'Now.', words: 'Now.' }), true)
  push(parser, { type: 'system', subtype: 'background_tasks_changed', tasks: [], session_id: 's1' })
  push(parser, { type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 's1' })
  assert.equal(io.ended, true)
  assert.equal(parser.answered, true)
  assert.equal(parser.result().text, 'Done.')
})

/** The lines Claude Code 2.1.330 writes as the agent starts a command in the background and goes idle on it. */
function idleOnCommand(parser: StreamJsonParser, command: string, said: string): ReturnType<StreamJsonParser['push']> {
  push(parser, { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command, description: 'Run the tests', run_in_background: true } }] }, session_id: 's1' })
  push(parser, { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'b1', task_type: 'local_bash', description: 'Run the tests' }], session_id: 's1' })
  push(parser, { type: 'system', subtype: 'task_started', task_id: 'b1', tool_use_id: 'toolu_1', description: 'Run the tests', is_backgrounded: true, task_type: 'local_bash', session_id: 's1' })
  push(parser, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Command running in background with ID: b1.' }] }, session_id: 's1' })
  push(parser, { type: 'assistant', message: { id: 'msg_2', content: [{ type: 'text', text: said }] }, session_id: 's1' })
  return push(parser, { type: 'result', subtype: 'success', is_error: false, result: said, session_id: 's1' })
}

test('an agent idle on a command in the background says which command it waits on and since when, and that it woke', () => {
  const parser = new StreamJsonParser()
  parser.talk(recordingIo())
  const before = Date.now()
  const waiting = idleOnCommand(parser, 'pnpm test > /tmp/test.log 2>&1;\n  echo exit=$?', 'Waiting for the tests.')
  assert.deepEqual(waiting.map(e => (e.type === 'background' ? { ...e, tasks: e.tasks.map(({ since: _since, ...task }) => task) } : e)), [
    { type: 'background', tasks: [{ id: 'b1', description: 'Run the tests', command: 'pnpm test > /tmp/test.log 2>&1; echo exit=$?' }] },
  ])
  const since = Date.parse(waiting[0]!.type === 'background' ? waiting[0]!.tasks[0]!.since : '')
  assert.ok(since >= before && since <= Date.now(), 'since when the task began')
  // The command's end wakes the agent: before what it says, it waits no more.
  push(parser, { type: 'system', subtype: 'task_notification', task_id: 'b1', tool_use_id: 'toolu_1', status: 'completed', session_id: 's1' })
  push(parser, { type: 'system', subtype: 'background_tasks_changed', tasks: [], session_id: 's1' })
  const woke = push(parser, { type: 'assistant', message: { id: 'msg_3', content: [{ type: 'text', text: 'All pass.' }] }, session_id: 's1' })
  assert.deepEqual(woke.slice(0, 2), [{ type: 'background', tasks: [] }, { type: 'text', text: 'All pass.' }])
  assert.deepEqual(push(parser, { type: 'result', subtype: 'success', is_error: false, result: 'All pass.', session_id: 's1' }), [])
  assert.equal(parser.answered, true)
})

test('work in the background that outlasts the wait is stopped, and the turn ends on the answer the agent gave', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const parser = new StreamJsonParser(60_000)
    const io = recordingIo() as ReturnType<typeof recordingIo> & { ended?: boolean }
    io.end = () => void (io.ended = true)
    parser.talk(io)
    idleOnCommand(parser, 'node dist/bin.js', 'It runs at http://127.0.0.1:4317.')
    // A message wakes it within the wait: the wait starts again from its next result.
    mock.timers.tick(50_000)
    push(parser, { type: 'assistant', message: { id: 'msg_3', content: [{ type: 'text', text: 'Still up.' }] }, session_id: 's1' })
    push(parser, { type: 'result', subtype: 'success', is_error: false, result: 'Still up at http://127.0.0.1:4317.', session_id: 's1' })
    mock.timers.tick(59_999)
    assert.deepEqual(io.lines, [], 'nothing stopped within the wait')
    assert.equal(parser.answered, false)
    mock.timers.tick(1)
    assert.deepEqual(io.lines, [{ type: 'control_request', request_id: 'stop-b1', request: { subtype: 'stop_task', task_id: 'b1' } }])
    assert.equal(io.ended, true, 'stdin closed: the CLI exits once its work is stopped')
    assert.equal(parser.answered, true)
    assert.deepEqual(parser.result(), { text: 'Still up at http://127.0.0.1:4317.', sessionId: 's1' })
    // The person is told, with the CLI's next line.
    const told = push(parser, { type: 'system', subtype: 'task_updated', task_id: 'b1', patch: { status: 'killed' }, session_id: 's1' })
    assert.deepEqual(told, [{ type: 'notice', message: "`node dist/bin.js` still ran 1 minute after the agent's last message, so it was stopped and the turn ended there." }])
  } finally {
    mock.timers.reset()
  }
})

test('a Stop while the agent waits on work in the background leaves nothing to stop after the wait', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const parser = new StreamJsonParser(60_000)
    const io = recordingIo()
    parser.talk(io)
    idleOnCommand(parser, 'node dist/bin.js', 'It runs.')
    assert.equal(parser.stop(), 'idle')
    mock.timers.tick(60_000)
    assert.deepEqual(io.lines, [])
    assert.equal(parser.result().stopped, true)
  } finally {
    mock.timers.reset()
  }
})

test('the wait holds the process until it ends the turn: with nothing else alive, the turn still ends', () => {
  // A process with nothing but the parser in it, idle on its work in the background: an unref'd
  // timer would let it exit with the turn never ended, as a test's fake CLI on CI did.
  const script = `
    import { StreamJsonParser } from ${JSON.stringify(new URL('./claude-code-stream.js', import.meta.url).href)}
    const parser = new StreamJsonParser(50)
    parser.talk({ write: () => {}, end: () => console.log('ended') })
    const push = line => parser.push(JSON.stringify({ ...line, session_id: 's1' }))
    push({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'b1', task_type: 'local_bash' }] })
    push({ type: 'result', subtype: 'success', is_error: false, result: 'It runs.' })
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), 'ended')
})

test("a task's ■ goes as stop_task with its id; a subagent is said again with the task it runs as, and its end on the ■ is a stop", () => {
  // As Claude Code 2.1.332 said them: a backgrounded subagent's task, a command's, the ■ on each.
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.talk(io)
  push(parser, { type: 'assistant', message: { id: 'msg1', content: [{ type: 'tool_use', id: 'toolu_a', name: 'Agent', input: { description: 'Run sleep 80 and report output', subagent_type: 'general-purpose', prompt: 'Sleep.' } }] }, session_id: 's1' })
  const named = push(parser, { type: 'system', subtype: 'task_started', task_id: 'aac4ad94a317d341f', tool_use_id: 'toolu_a', is_backgrounded: true, task_type: 'local_agent', session_id: 's1' })
  assert.deepEqual(named.map(e => (e.type === 'subagent' ? [e.id, e.status, e.task] : e.type)), [['toolu_a', 'working', 'aac4ad94a317d341f']])
  // A command's task names no subagent: nothing is said again.
  assert.deepEqual(push(parser, { type: 'system', subtype: 'task_started', task_id: 'b6pgvzpj0', tool_use_id: 'toolu_b', is_backgrounded: true, task_type: 'local_bash', session_id: 's1' }), [])
  parser.stopTask('aac4ad94a317d341f')
  parser.stopTask('b6pgvzpj0')
  assert.deepEqual(io.lines.map(line => line['request']), [{ subtype: 'stop_task', task_id: 'aac4ad94a317d341f' }, { subtype: 'stop_task', task_id: 'b6pgvzpj0' }])
  const ended = push(parser, { type: 'system', subtype: 'task_notification', task_id: 'aac4ad94a317d341f', tool_use_id: 'toolu_a', status: 'stopped', session_id: 's1' })
  assert.deepEqual(ended.flatMap(e => (e.type === 'subagent' ? [e.status] : [])), ['stopped'])
})

test("a task's ■ after the turn is over asks nothing", () => {
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.stopTask('t1')
  parser.talk(io)
  push(parser, { type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 's1' })
  parser.stopTask('t1')
  assert.deepEqual(io.lines, [])
})
