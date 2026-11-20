import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Readable, Writable } from 'node:stream'
import { ClaudeCodeDriver } from './claude-code.js'
import { StreamJsonParser, askedQuestion } from './claude-code-stream.js'
import type { CliIo, DriverEvent, SpawnLike, SpawnedProcess } from '@openagt/agent-driver'

// The lines Claude Code 2.1.318 writes when its agent calls AskUserQuestion under
// `--permission-prompt-tool stdio`, as read off a real run (trimmed to the fields read).
const input = {
  questions: [
    {
      question: 'Which light background colour do you want for index.html?',
      header: 'Colour',
      options: [
        { label: 'Blue (Recommended)', description: 'A light blue background' },
        { label: 'Green', description: 'A light green background' },
      ],
      multiSelect: false,
    },
  ],
}
const said = { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'One thing first.' }] }, session_id: 's1' }
const call = { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'AskUserQuestion', input }] }, session_id: 's1' }
const request = { type: 'control_request', request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', display_name: 'AskUserQuestion', input, tool_use_id: 'toolu_1', requires_user_interaction: true } }
const cancelled = { type: 'control_cancel_request', request_id: 'req-1' }
const stopped = { type: 'control_response', response: { subtype: 'success', request_id: 'stop-req-1', response: { still_queued: [] } } }
const refused = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: "The user doesn't want to proceed with this tool use.", is_error: true, tool_use_id: 'toolu_1' }] }, session_id: 's1' }
const interrupted = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] }, session_id: 's1' }
const result = { type: 'result', subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_tools', session_id: 's1', total_cost_usd: 0.01, usage: { input_tokens: 2, output_tokens: 3 } }
const asked = [said, call, request, cancelled, stopped, refused, interrupted, result].map(line => JSON.stringify(line))

const question = {
  title: 'Which light background colour do you want for index.html?',
  header: 'Colour',
  options: [
    { id: 'opt:0', label: 'Blue', detail: 'A light blue background' },
    { id: 'opt:1', label: 'Green', detail: 'A light green background' },
  ],
  recommended: 'opt:0',
}

/** A CliIo that keeps what was written and whether it was closed. */
function recordingIo(): CliIo & { lines: Record<string, unknown>[]; ended: boolean } {
  const io = {
    lines: [] as Record<string, unknown>[],
    ended: false,
    write: (line: string) => void io.lines.push(JSON.parse(line) as Record<string, unknown>),
    end: () => void (io.ended = true),
  }
  return io
}

test('the agent’s AskUserQuestion is the turn’s question: the call is no step, and the turn is stopped on it', () => {
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.talk(io)
  const events = asked.flatMap(line => parser.push(line))
  // What the agent said before it asked is its message; the call and what came back are not steps.
  assert.deepEqual(
    events.filter(e => e.type !== 'session' && e.type !== 'tokens'),
    [{ type: 'text', text: 'One thing first.' }],
  )
  // Asked over stdin, the CLI is told to stop the turn, as Esc stops it; then, the turn over, stdin closes.
  assert.deepEqual(io.lines, [{ type: 'control_request', request_id: 'stop-req-1', request: { subtype: 'interrupt' } }])
  assert.equal(io.ended, true)
  assert.equal(parser.answered, true)
  assert.deepEqual(parser.result(), { text: 'One thing first.', sessionId: 's1', usage: { costUsd: 0.01, inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheCreationTokens: 0 }, question })
})

test('any other tool the CLI asks about is refused, as `claude -p` refuses what nobody can approve', () => {
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.talk(io)
  parser.push(JSON.stringify({ type: 'control_request', request_id: 'req-2', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } }))
  assert.deepEqual(io.lines, [{ type: 'control_response', response: { subtype: 'success', request_id: 'req-2', response: { behavior: 'deny', message: "Bash needs a person's approval, and nobody here can give it." } } }])
  assert.equal(parser.result().question, undefined)
})

test('a request of a kind this version does not know is answered as failed, so the CLI never waits on it', () => {
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.talk(io)
  parser.push(JSON.stringify({ type: 'control_request', request_id: 'req-4', request: { subtype: 'elicitation', message: 'Sign in?' } }))
  assert.deepEqual(io.lines, [{ type: 'control_response', response: { subtype: 'error', request_id: 'req-4', error: 'OpenAgent does not answer elicitation requests' } }])
})

test('a question in a shape this version cannot read is refused with a word to ask in the reply, and said as a notice', () => {
  const parser = new StreamJsonParser()
  const io = recordingIo()
  parser.talk(io)
  const events = parser.push(JSON.stringify({ type: 'control_request', request_id: 'req-3', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { prompt: 'Which?' } } }))
  assert.equal(events[0]?.type, 'notice')
  assert.deepEqual((io.lines[0]!['response'] as Record<string, unknown>)['response'], { behavior: 'deny', message: 'This question could not be shown. Ask it in your reply instead.' })
  assert.equal(parser.result().question, undefined)
})

test('a question is read off AskUserQuestion’s input: the first one asked, its description the detail, many answers when it says so', () => {
  assert.deepEqual(askedQuestion(input), question)
  const multi = askedQuestion({ questions: [{ question: 'Which pages?', header: 'Pages', options: [{ label: 'Home' }, { label: '' }, { label: 'About' }], multiSelect: true }, { question: 'Second?', options: [{ label: 'x' }] }] })
  assert.deepEqual(multi, { title: 'Which pages?', header: 'Pages', options: [{ id: 'opt:0', label: 'Home' }, { id: 'opt:2', label: 'About' }], multi: true })
  assert.equal(askedQuestion({ questions: [] }), undefined)
  assert.equal(askedQuestion({ questions: [{ question: '', options: [{ label: 'x' }] }] }), undefined)
  assert.equal(askedQuestion({ questions: [{ question: 'Which?', options: [] }] }), undefined)
  assert.equal(askedQuestion(null), undefined)
})

/** A `claude` that writes `lines`, keeps what it is sent, and exits with `code` once it has written them. */
function fakeClaude(lines: string[], code: number, sent: string[], args: string[][] = []): SpawnLike {
  return (_bin, given) => {
    args.push([...given])
    const stdout = Readable.from([lines.map(l => l + '\n').join('')])
    const stdin = new Writable({ write: (chunk, _e, cb) => (sent.push(...String(chunk).trim().split('\n')), cb()) })
    const proc: SpawnedProcess = {
      stdout,
      stderr: Readable.from([]),
      stdin,
      on(event, listener) {
        if (event === 'close') stdout.on('end', () => setTimeout(() => (listener as (c: number | null) => void)(code), 5))
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
}

test('a turn stopped on the agent’s question is over, not failed, though the CLI exits 1; the question is said once', async () => {
  const sent: string[] = []
  const args: string[][] = []
  const events: DriverEvent[] = []
  const session = await new ClaudeCodeDriver({ spawn: fakeClaude(asked, 1, sent, args) }).start({ cwd: '/ws', onEvent: e => events.push(e) })
  const turn = await session.prompt('Make the background light; ask me the colour first.')
  assert.deepEqual(turn.question, question)
  assert.equal(turn.text, 'One thing first.')
  assert.deepEqual(events.filter(e => e.type === 'question'), [{ type: 'question', question }])
  assert.ok(!events.some(e => e.type === 'error'))
  // Asked over stdin, so the agent has its own question tool; plan mode, which no run has, stays out.
  const given = args[0]!
  assert.deepEqual(given.slice(given.indexOf('--permission-prompt-tool'), given.indexOf('--permission-prompt-tool') + 2), ['--permission-prompt-tool', 'stdio'])
  assert.deepEqual(given.slice(given.indexOf('--disallowedTools'), given.indexOf('--disallowedTools') + 3), ['--disallowedTools', 'EnterPlanMode', 'ExitPlanMode'])
  // The prompt first, then the stop.
  assert.deepEqual(sent.map(line => (JSON.parse(line) as { type: string }).type), ['control_request', 'user', 'control_request'])
})

test('a turn with nothing to do in its folder has no tools, so nothing to ask with either', async () => {
  const args: string[][] = []
  const session = await new ClaudeCodeDriver({ spawn: fakeClaude([JSON.stringify({ type: 'result', subtype: 'success', result: 'A name' })], 0, [], args) }).start({ cwd: '/ws', noTools: true })
  await session.prompt('Name this')
  assert.ok(!args[0]!.includes('--permission-prompt-tool'))
})

test('a turn that failed for its own reasons still fails: only the agent’s question stops one cleanly', async () => {
  const lines = [said, { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's1' }].map(line => JSON.stringify(line))
  const session = await new ClaudeCodeDriver({ spawn: fakeClaude(lines, 1, []) }).start({ cwd: '/ws' })
  await assert.rejects(session.prompt('go'), /exited \(1\)/)
})
