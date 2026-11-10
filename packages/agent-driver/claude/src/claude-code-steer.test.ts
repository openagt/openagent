import { strict as assert } from 'node:assert'
import { test } from 'node:test'
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
