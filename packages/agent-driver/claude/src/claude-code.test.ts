import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Readable, Writable } from 'node:stream'
import { existsSync, readFileSync } from 'node:fs'
import { ClaudeCodeDriver, StreamJsonParser, claudeCodeReady } from './claude-code.js'
import { runCliSession, type SpawnLike, type SpawnedProcess, type DriverEvent } from '@openagt/agent-driver'

test('StreamJsonParser surfaces assistant text + tool names, keeps the result', () => {
  const p = new StreamJsonParser()
  // The very first line announces the session id (#1322): surfaced immediately, not held for
  // `result`, so a turn that is stopped mid-flight keeps its `claude --resume` handle.
  assert.deepEqual(p.push(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' })), [
    { type: 'session', sessionId: 'sess-1' },
  ])
  const assistant = p.push(
    JSON.stringify({
      type: 'assistant',
      session_id: 'sess-1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Working' }, { type: 'tool_use', name: 'Write' }] },
    }),
  )
  assert.deepEqual(assistant, [
    { type: 'text', text: 'Working' },
    { type: 'action', label: 'Write' },
  ])
  assert.deepEqual(p.push(JSON.stringify({ type: 'result', subtype: 'success', result: 'All done', session_id: 'sess-1' })), [])
  assert.deepEqual(p.result(), { text: 'All done', sessionId: 'sess-1' })
})

test('StreamJsonParser says what each tool call did, and passes thinking with text on as thoughts', () => {
  const p = new StreamJsonParser()
  const content = [
    // A plain `-p` run sends thinking with its text empty: nothing to show.
    { type: 'thinking', thinking: '', signature: 'x' },
    { type: 'thinking', thinking: 'Checking 17*23 gives 391, so 19*21 is larger.\n\n', signature: 'x' },
    { type: 'tool_use', name: 'Bash', input: { command: 'git status\n  --short', description: 'Show status' } },
    { type: 'tool_use', name: 'Skill', input: { skill: 'tickets' } },
    { type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/app.ts', limit: 20 } },
    { type: 'tool_use', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'Summarize' } },
    { type: 'tool_use', name: 'TodoWrite', input: { todos: [] } },
    { type: 'tool_use', name: 'Bash', input: { command: 'x'.repeat(300) } },
  ]
  assert.deepEqual(p.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content } })), [
    { type: 'thought', text: 'Checking 17*23 gives 391, so 19*21 is larger.' },
    // A command of two lines: the one line, and the command as it was given.
    { type: 'action', label: 'Bash', detail: 'git status --short', whole: 'git status\n  --short', summary: 'Show status' },
    { type: 'action', label: 'Skill', detail: 'tickets' },
    { type: 'action', label: 'Read', detail: '/repo/src/app.ts' },
    { type: 'action', label: 'WebFetch', detail: 'https://example.com' },
    { type: 'action', label: 'TodoWrite' },
    { type: 'action', label: 'Bash', detail: 'x'.repeat(199) + '…', whole: 'x'.repeat(300) },
  ])
})

test('StreamJsonParser gives each tool call its id, and what the call gave back as an output for that id', () => {
  const p = new StreamJsonParser()
  const call = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'pnpm test' } }] } }
  assert.deepEqual(p.push(JSON.stringify(call)), [{ type: 'action', label: 'Bash', detail: 'pnpm test', id: 'toolu_1' }])
  const result = (blocks: unknown[]) => JSON.stringify({ type: 'user', message: { role: 'user', content: blocks } })
  // The text itself, or a list of blocks whose text ones hold it.
  assert.deepEqual(p.push(result([{ type: 'tool_result', tool_use_id: 'toolu_1', content: '12 passed\n' }])), [{ type: 'output', id: 'toolu_1', text: '12 passed' }])
  assert.deepEqual(
    p.push(result([{ type: 'tool_result', tool_use_id: 'toolu_2', content: [{ type: 'text', text: 'one' }, { type: 'image', source: {} }, { type: 'text', text: 'two' }] }])),
    [{ type: 'output', id: 'toolu_2', text: 'one\ntwo' }],
  )
  // A call that failed says so, even with nothing printed.
  assert.deepEqual(p.push(result([{ type: 'tool_result', tool_use_id: 'toolu_3', content: 'Exit code 1', is_error: true }])), [{ type: 'output', id: 'toolu_3', text: 'Exit code 1', failed: true }])
  assert.deepEqual(p.push(result([{ type: 'tool_result', tool_use_id: 'toolu_4', content: '', is_error: true }])), [{ type: 'output', id: 'toolu_4', text: '', failed: true }])
  // Nothing printed, or no call named: nothing to say. A user line that is not a result is none either.
  assert.deepEqual(p.push(result([{ type: 'tool_result', tool_use_id: 'toolu_5', content: '' }, { type: 'tool_result', content: 'lost' }, { type: 'text', text: 'hello' }])), [])
  // A long output is cut: its start and its end are kept.
  const [long] = p.push(result([{ type: 'tool_result', tool_use_id: 'toolu_6', content: 'a'.repeat(5000) + 'END' }]))
  assert.ok(long?.type === 'output' && long.text.startsWith('aaa') && long.text.endsWith('END') && long.text.includes('… 1003 characters cut …'))
})

// The two accounts below are what Claude Code 2 printed for a Write and an Edit, cut to the fields read.
test('StreamJsonParser says what an edit or a write did to its file: lines added and removed, and whether it made the file', () => {
  const p = new StreamJsonParser()
  const line = (blocks: unknown[], account?: unknown) => JSON.stringify({ type: 'user', message: { role: 'user', content: blocks }, ...(account === undefined ? {} : { tool_use_result: account }) })
  const said = (id: string, text = 'ok') => ({ type: 'tool_result', tool_use_id: id, content: text })
  // A file the call made: its content's lines, all added.
  assert.deepEqual(p.push(line([said('w1')], { type: 'create', filePath: '/ws/a.txt', content: 'one\ntwo\nthree', structuredPatch: [], originalFile: null })), [
    { type: 'output', id: 'w1', text: 'ok', changed: [{ path: '/ws/a.txt', added: 3, removed: 0, created: true }] },
  ])
  // A file the call changed: the patch's own lines, over all its hunks.
  const hunk = (lines: string[]) => ({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines })
  assert.deepEqual(p.push(line([said('e1')], { filePath: '/ws/a.txt', oldString: 'two', newString: 'TWO\ntwo and a half', structuredPatch: [hunk([' one', '-two', '+TWO', '+two and a half', ' three']), hunk(['-x', '+y'])] })), [
    { type: 'output', id: 'e1', text: 'ok', changed: [{ path: '/ws/a.txt', added: 3, removed: 2 }] },
  ])
  // A write over a file that was there is a change, not a new file.
  assert.deepEqual(p.push(line([said('w2')], { type: 'update', filePath: '/ws/a.txt', content: 'x', structuredPatch: [hunk(['-one', '+x'])] })), [
    { type: 'output', id: 'w2', text: 'ok', changed: [{ path: '/ws/a.txt', added: 1, removed: 1 }] },
  ])
  // An edit that printed nothing is still said, for what it changed.
  assert.deepEqual(p.push(line([said('e2', '')], { filePath: '/ws/b.txt', structuredPatch: [hunk(['+z'])] })), [{ type: 'output', id: 'e2', text: '', changed: [{ path: '/ws/b.txt', added: 1, removed: 0 }] }])
  // A call that failed changed nothing; an account that names no file, or holds no patch, says nothing of one.
  assert.deepEqual(p.push(line([{ ...said('e3', 'no match'), is_error: true }], { filePath: '/ws/a.txt', structuredPatch: [hunk(['+z'])] })), [{ type: 'output', id: 'e3', text: 'no match', failed: true }])
  assert.deepEqual(p.push(line([said('r1')], { type: 'text', file: { filePath: '/ws/a.txt' } })), [{ type: 'output', id: 'r1', text: 'ok' }])
  assert.deepEqual(p.push(line([said('b1')], { stdout: 'ok', stderr: '' })), [{ type: 'output', id: 'b1', text: 'ok' }])
  assert.deepEqual(p.push(line([said('x1')], { filePath: '/ws/a.txt' })), [{ type: 'output', id: 'x1', text: 'ok' }])
  assert.deepEqual(p.push(line([said('s1')], 'plain words')), [{ type: 'output', id: 's1', text: 'ok' }])
  // One account on a line of two results: no telling whose it is, so neither says it.
  assert.deepEqual(p.push(line([said('m1'), said('m2')], { type: 'create', filePath: '/ws/c.txt', content: 'c' })), [
    { type: 'output', id: 'm1', text: 'ok' },
    { type: 'output', id: 'm2', text: 'ok' },
  ])
})

// The `Agent` tool's input, as Claude Code's own schema defines it: `description` is the short
// name of the task, `prompt` the task, `subagent_type` the kind of agent, `model` an override.
test('StreamJsonParser says the subagent an Agent call starts, beside the call\'s own row, and ends it on the result', () => {
  const p = new StreamJsonParser()
  const assistant = (blocks: unknown[]) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: blocks } })
  const result = (blocks: unknown[]) => JSON.stringify({ type: 'user', message: { role: 'user', content: blocks } })
  const input = { description: 'Map landing page and dashboard serving', subagent_type: 'Explore', model: 'sonnet', prompt: 'Read how the pages are served.' }
  assert.deepEqual(p.push(assistant([{ type: 'tool_use', id: 'toolu_a', name: 'Agent', input }])), [
    // The row a reader shows today, unchanged...
    { type: 'action', label: 'Agent', detail: 'Map landing page and dashboard serving', id: 'toolu_a' },
    // ...and the subagent beside it, on the call's own id.
    { type: 'subagent', id: 'toolu_a', status: 'working', name: 'Map landing page and dashboard serving', role: 'Explore', model: 'sonnet', prompt: 'Read how the pages are served.' },
  ])
  // Said whole again under the same id: a reader replaces the row rather than appending a second one.
  assert.deepEqual(p.push(result([{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'Mapped it' }])), [
    { type: 'output', id: 'toolu_a', text: 'Mapped it' },
    { type: 'subagent', id: 'toolu_a', status: 'ended', name: 'Map landing page and dashboard serving', role: 'Explore', model: 'sonnet', prompt: 'Read how the pages are served.' },
  ])
  // No `model` means the subagent runs on the parent's, which the CLI does not repeat: absent, not
  // guessed. `Task` is the same tool in a Claude Code from before it was renamed.
  assert.deepEqual(p.push(assistant([{ type: 'tool_use', id: 'toolu_b', name: 'Task', input: { description: 'Check the tests', subagent_type: 'general-purpose' } }])), [
    { type: 'action', label: 'Task', detail: 'Check the tests', id: 'toolu_b' },
    { type: 'subagent', id: 'toolu_b', status: 'working', name: 'Check the tests', role: 'general-purpose' },
  ])
  // A result that is an error failed the subagent, not just the call.
  assert.deepEqual(p.push(result([{ type: 'tool_result', tool_use_id: 'toolu_b', content: 'No such agent type', is_error: true }])), [
    { type: 'output', id: 'toolu_b', text: 'No such agent type', failed: true },
    { type: 'subagent', id: 'toolu_b', status: 'failed', name: 'Check the tests', role: 'general-purpose' },
  ])
  // Any other tool's call is no subagent, and its result ends none.
  assert.deepEqual(p.push(assistant([{ type: 'tool_use', id: 'toolu_c', name: 'Bash', input: { command: 'ls' } }])), [{ type: 'action', label: 'Bash', detail: 'ls', id: 'toolu_c' }])
  assert.deepEqual(p.push(result([{ type: 'tool_result', tool_use_id: 'toolu_c', content: 'ok' }])), [{ type: 'output', id: 'toolu_c', text: 'ok' }])
  // A long task is cut the way an output is, and a call with no id is left as the plain row it was.
  const [, started] = p.push(assistant([{ type: 'tool_use', id: 'toolu_d', name: 'Agent', input: { description: 'Long one', prompt: 'p'.repeat(5000) } }]))
  assert.ok(started?.type === 'subagent' && started.prompt?.includes('… 1000 characters cut …') && started.role === undefined)
  assert.deepEqual(p.push(assistant([{ type: 'tool_use', name: 'Agent', input: { description: 'Nameless call' } }])), [{ type: 'action', label: 'Agent', detail: 'Nameless call' }])
})

test('StreamJsonParser passes the message being written as the text so far, each text block from empty', () => {
  const p = new StreamJsonParser()
  const piece = (event: object): string => JSON.stringify({ type: 'stream_event', event })
  const text = (t: string): object => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })
  assert.deepEqual(p.push(piece({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })), [])
  assert.deepEqual(p.push(piece(text('Rivers car'))), [{ type: 'partial', text: 'Rivers car' }])
  assert.deepEqual(p.push(piece(text('ve valleys.'))), [{ type: 'partial', text: 'Rivers carve valleys.' }])
  // Thinking and tool input come in pieces too; they are said once whole, not as they come.
  assert.deepEqual(p.push(piece({ type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'hm' } })), [])
  assert.deepEqual(p.push(piece({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a' } })), [])
  assert.deepEqual(p.push(piece({ type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } })), [])
  assert.deepEqual(p.push(piece(text('Next'))), [{ type: 'partial', text: 'Next' }])
})

test('ClaudeCodeDriver asks for thinking text, then sends the prompt, both as stream-json input', async () => {
  let written = ''
  const spawn: SpawnLike = () => {
    const child = {
      stdout: Readable.from([JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' }) + '\n']),
      stderr: Readable.from([]),
      stdin: new Writable({ write: (c, _e, cb) => { written += String(c); cb() } }),
      pid: 1,
      kill: () => true,
      on(event: string, cb: (...a: unknown[]) => void) {
        if (event === 'close') setTimeout(() => cb(0, null), 5)
        return child
      },
    }
    return child as unknown as SpawnedProcess
  }
  const session = await new ClaudeCodeDriver({ spawn }).start({ cwd: process.cwd() })
  await session.prompt('Fix the bug')
  const [control, message] = written.trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual(control.request, { subtype: 'set_max_thinking_tokens', max_thinking_tokens: null, thinking_display: 'summarized' })
  assert.deepEqual(message, { type: 'user', message: { role: 'user', content: 'Fix the bug' } })

  // A sentence added after the prompt goes to the agent with it, and the start event names it apart.
  written = ''
  const events: DriverEvent[] = []
  const told = await new ClaudeCodeDriver({ spawn }).start({ cwd: process.cwd(), onEvent: e => events.push(e) })
  await told.prompt('Fix the bug', { added: 'Commit your work.' })
  assert.deepEqual(JSON.parse(written.trim().split('\n')[1]!).message, { role: 'user', content: 'Fix the bug\n\nCommit your work.' })
  assert.deepEqual(events.find(e => e.type === 'start'), { type: 'start', prompt: 'Fix the bug', added: 'Commit your work.' })

  // A text attached to the prompt goes between the two, and the start event names it apart too.
  written = ''
  const handed: DriverEvent[] = []
  const given = await new ClaudeCodeDriver({ spawn }).start({ cwd: process.cwd(), onEvent: e => handed.push(e) })
  await given.prompt('/answer-comments', { attached: 'Found:\n[1]', added: 'Commit your work.' })
  assert.deepEqual(JSON.parse(written.trim().split('\n')[1]!).message, { role: 'user', content: '/answer-comments\n\nFound:\n[1]\n\nCommit your work.' })
  assert.deepEqual(handed.find(e => e.type === 'start'), { type: 'start', prompt: '/answer-comments', attached: 'Found:\n[1]', added: 'Commit your work.' })
})

test('StreamJsonParser pulls token + cost usage off the result line (#322)', () => {
  const p = new StreamJsonParser()
  p.push(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'done',
      session_id: 's',
      total_cost_usd: 0.1234,
      usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 },
    }),
  )
  assert.deepEqual(p.result(), {
    text: 'done',
    sessionId: 's',
    usage: { costUsd: 0.1234, inputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheCreationTokens: 50 },
  })
})

test('how full the conversation is comes from the last model call, not from the turn\'s total', () => {
  const p = new StreamJsonParser()
  const call = (input: number, cacheRead: number, output: number) =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: input, cache_read_input_tokens: cacheRead, output_tokens: output } } })
  // Two calls of one turn, over one growing conversation: the second is how full it is now.
  p.push(call(100, 20_000, 500))
  p.push(call(100, 40_000, 300))
  p.push(JSON.stringify({ type: 'result', subtype: 'success', result: 'done', session_id: 's', usage: { input_tokens: 200, output_tokens: 800, cache_read_input_tokens: 60_000, cache_creation_input_tokens: 0 } }))
  // The turn's own totals are what it cost; 40_400 is what the window holds, not 61_000.
  assert.equal(p.result().usage?.contextTokens, 40_400)
  assert.equal(p.result().usage?.cacheReadTokens, 60_000)
})

test('StreamJsonParser leaves usage off when the result line reports none (#322)', () => {
  const p = new StreamJsonParser()
  p.push(JSON.stringify({ type: 'result', subtype: 'success', result: 'done', session_id: 's' }))
  assert.deepEqual(p.result(), { text: 'done', sessionId: 's' })
})

test('StreamJsonParser omits costUsd (never 0) when tokens report but no price (#540)', () => {
  const p = new StreamJsonParser()
  p.push(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'done',
      session_id: 's',
      usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 },
    }),
  )
  const { usage } = p.result()
  // Tokens surface; costUsd is absent (unknown), not 0 (which the budget gate reads as free).
  assert.equal(usage?.costUsd, undefined)
  assert.equal(Object.prototype.hasOwnProperty.call(usage, 'costUsd'), false)
  assert.deepEqual(usage, { inputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheCreationTokens: 50 })
})

test('StreamJsonParser announces the session id once, re-announcing only a change (#1322)', () => {
  const p = new StreamJsonParser()
  assert.deepEqual(p.push(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'a' })), [{ type: 'session', sessionId: 'a' }])
  // Every subsequent line repeats the id; repeating the announcement would be noise.
  assert.deepEqual(p.push(JSON.stringify({ type: 'system', subtype: 'other', session_id: 'a' })), [])
  assert.deepEqual(p.push(JSON.stringify({ type: 'system', subtype: 'other', session_id: 'b' })), [{ type: 'session', sessionId: 'b' }])
})

test('StreamJsonParser announces the model the CLI says the turn runs on, off its first line', () => {
  const p = new StreamJsonParser()
  assert.deepEqual(p.push(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'a', model: 'claude-opus-5-5' })), [
    { type: 'session', sessionId: 'a' },
    { type: 'model', model: 'claude-opus-5-5' },
  ])
  // Only the init line says it; another line naming a model is not the turn's.
  assert.deepEqual(p.push(JSON.stringify({ type: 'system', subtype: 'other', session_id: 'a', model: 'x' })), [])
})

test('a logged session\'s card names the model Claude Code ran, not the alias it was given; the diary has no line for it', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'claude-model-card-'))
  try {
    const spawn: SpawnLike = fakeSpawn([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-5-5' }),
      JSON.stringify({ type: 'result', result: 'ok', session_id: 's1' }),
    ])
    const session = await new ClaudeCodeDriver({ spawn }).start({ cwd: dir, model: 'opus', log: { dir, card: { id: 'r1', model: 'opus' } } })
    await session.prompt('go')
    await session.log!.settled()
    assert.equal(JSON.parse(await readFile(join(dir, 'r1.json'), 'utf8')).model, 'claude-opus-5-5')
    const kinds = (await readFile(join(dir, 'r1.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line).kind)
    assert.ok(!kinds.includes('model'), kinds.join(' '))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('StreamJsonParser ignores non-JSON noise and falls back to assistant text', () => {
  const p = new StreamJsonParser()
  assert.deepEqual(p.push('some banner line'), [])
  // `null` is valid JSON, so it survives the parse and used to throw on the first field read —
  // inside a readline handler, which takes the daemon and every live agent with it.
  assert.deepEqual(p.push('null'), [])
  p.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } }))
  assert.deepEqual(p.result(), { text: 'partial' })
})

// A fake process that streams the given stream-json lines then closes.
function fakeSpawn(lines: string[], code = 0, stderr = ''): SpawnLike {
  return () => {
    const stdout = Readable.from([lines.map(l => l + '\n').join('')])
    const stderrStream = Readable.from(stderr ? [stderr] : [])
    const stdin = new Writable({ write: (_c, _e, cb) => cb() })
    const proc: SpawnedProcess = {
      stdout,
      stderr: stderrStream,
      stdin,
      on(event, listener) {
        if (event === 'close') stdout.on('end', () => (listener as (c: number | null) => void)(code))
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
}

test('runCliSession with the Claude parser drives a fake process and returns the final turn', async () => {
  const events: DriverEvent[] = []
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's9' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', result: 'built it', session_id: 's9' }),
  ]
  const turn = await runCliSession({
    bin: 'claude',
    args: ['-p'],
    cwd: '/ws',
    env: {},
    prompt: 'build',
    spawn: fakeSpawn(lines),
    emit: e => events.push(e),
    signals: [],
    parser: new StreamJsonParser(),
    driver: 'claude-code',
  })
  assert.deepEqual(turn, { text: 'built it', sessionId: 's9' })
  assert.equal(events[0]!.type, 'start')
  assert.ok(events.some(e => e.type === 'action' && e.label === 'Bash'))
  assert.equal(events.at(-1)!.type, 'result')
})

test('runCliSession with the Claude parser rejects on a non-zero exit with no result text', async () => {
  await assert.rejects(
    () =>
      runCliSession({
        bin: 'claude',
        args: [],
        cwd: '/ws',
        env: {},
        prompt: 'x',
        spawn: fakeSpawn([], 1, 'boom'),
        emit: () => {},
        signals: [],
        parser: new StreamJsonParser(),
        driver: 'claude-code',
      }),
    /boom/,
  )
})

test('runCliSession with the Claude parser rejects on a non-zero exit even when the agent streamed text', async () => {
  const events: DriverEvent[] = []
  const lines = [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'started building' }] } })]
  await assert.rejects(
    () =>
      runCliSession({
        bin: 'claude',
        args: [],
        cwd: '/ws',
        env: {},
        prompt: 'x',
        spawn: fakeSpawn(lines, 1),
        emit: e => events.push(e),
        signals: [],
        parser: new StreamJsonParser(),
        driver: 'claude-code',
      }),
    /exited \(1\): started building/,
  )
  assert.equal(events.at(-1)!.type, 'error')
  assert.ok(!events.some(e => e.type === 'result'))
})

test('ClaudeCodeDriver builds correct CLI args (permission mode, system, model)', async () => {
  let captured: string[] = []
  const spawn: SpawnLike = (_cmd, args) => {
    captured = [...args]
    return fakeSpawn([JSON.stringify({ type: 'result', result: 'ok' })])(_cmd, args, { cwd: '/ws', env: {} })
  }
  const driver = new ClaudeCodeDriver({ spawn })
  const session = await driver.start({ cwd: '/ws', system: 'You are a Vike expert', model: 'claude-haiku-4-5-20251001' })
  await session.prompt('go')
  assert.deepEqual(captured.slice(0, 7), ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'])
  assert.ok(captured.includes('--permission-mode'))
  assert.ok(captured.includes('acceptEdits'))
  assert.ok(captured.includes('--append-system-prompt'))
  assert.ok(captured.includes('You are a Vike expert'))
  assert.ok(captured.includes('--model'))
  assert.ok(captured.includes('claude-haiku-4-5-20251001'))
})

test('ClaudeCodeDriver tells the CLI how hard to think when the caller asked, and says nothing when it did not', async () => {
  const run = async (effort?: string): Promise<string[]> => {
    let captured: string[] = []
    const spawn: SpawnLike = (_cmd, args) => {
      captured = [...args]
      return fakeSpawn([JSON.stringify({ type: 'result', result: 'ok' })])(_cmd, args, { cwd: '/ws', env: {} })
    }
    const session = await new ClaudeCodeDriver({ spawn }).start({ cwd: '/ws', ...(effort !== undefined ? { effort } : {}) })
    await session.prompt('go')
    return captured
  }
  const asked = await run('high')
  assert.deepEqual(asked.slice(asked.indexOf('--effort'), asked.indexOf('--effort') + 2), ['--effort', 'high'])
  assert.ok(!(await run()).includes('--effort'), 'the CLI thinks as it does by default')
})

test('a session with nothing to do in its folder is started with no tools and no MCP servers', async () => {
  const run = async (noTools?: boolean): Promise<string[]> => {
    let captured: string[] = []
    const spawn: SpawnLike = (_cmd, args) => {
      captured = [...args]
      return fakeSpawn([JSON.stringify({ type: 'result', result: 'ok' })])(_cmd, args, { cwd: '/ws', env: {} })
    }
    const driver = new ClaudeCodeDriver({ spawn, mcpServers: { memory: { command: 'memory-server' } } })
    const session = await driver.start({ cwd: '/ws', ...(noTools !== undefined ? { noTools } : {}) })
    await session.prompt('go')
    return captured
  }
  // The tools and the servers behind them are most of what such a turn sends, and a model with no
  // tool cannot go looking for the files the words it is naming happen to mention.
  const bare = await run(true)
  assert.deepEqual(bare.slice(bare.indexOf('--tools'), bare.indexOf('--tools') + 2), ['--tools', ''])
  assert.ok(bare.includes('--strict-mcp-config'))
  assert.ok(!bare.includes('--mcp-config'), 'no servers either, so none are written')
  // Every other session is started as it always was.
  const usual = await run()
  assert.ok(!usual.includes('--tools'))
  assert.ok(!usual.includes('--strict-mcp-config'))
  assert.ok(usual.includes('--mcp-config'))
})

test('ClaudeCodeDriver omits --mcp-config when no mcpServers are configured', async () => {
  let captured: string[] = []
  const spawn: SpawnLike = (_cmd, args) => {
    captured = [...args]
    return fakeSpawn([JSON.stringify({ type: 'result', result: 'ok' })])(_cmd, args, { cwd: '/ws', env: {} })
  }
  const session = await new ClaudeCodeDriver({ spawn }).start({ cwd: '/ws' })
  await session.prompt('go')
  assert.ok(!captured.includes('--mcp-config'))
})

test('ClaudeCodeDriver writes an --mcp-config file for mcpServers and cleans it up on dispose', async () => {
  let captured: string[] = []
  const spawn: SpawnLike = (_cmd, args) => {
    captured = [...args]
    return fakeSpawn([JSON.stringify({ type: 'result', result: 'ok' })])(_cmd, args, { cwd: '/ws', env: {} })
  }
  const mcpServers = { 'chrome-devtools': { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] } }
  const session = await new ClaudeCodeDriver({ spawn, mcpServers }).start({ cwd: '/ws' })
  await session.prompt('go')
  const idx = captured.indexOf('--mcp-config')
  assert.ok(idx >= 0)
  const configPath = captured[idx + 1]!
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { mcpServers })
  // The path is stable across prompts in the same session (written once).
  const first = [...captured]
  await session.prompt('again')
  assert.equal(captured[captured.indexOf('--mcp-config') + 1], first[first.indexOf('--mcp-config') + 1])
  await session.dispose()
  assert.ok(!existsSync(configPath))
})

test('ClaudeCodeSession resumes the same session for a chat turn (#714)', async () => {
  let captured: string[] = []
  const spawn: SpawnLike = (_cmd, args) => {
    captured = [...args]
    // The turn reports its session id, which the session retains for a later --resume.
    return fakeSpawn([JSON.stringify({ type: 'result', result: 'ok', session_id: 'sess-1' })])(_cmd, args, { cwd: '/ws', env: {} })
  }
  const session = await new ClaudeCodeDriver({ spawn }).start({ cwd: '/ws', system: 'You are a Vike expert' })
  // A normal turn: fresh, appends the system prompt, no --resume yet.
  await session.prompt('go')
  assert.ok(!captured.includes('--resume'))
  assert.ok(captured.includes('--append-system-prompt'))
  // A chat message resumes the captured session and skips the redundant system append.
  await session.prompt('also add dark mode', { resume: true })
  assert.equal(captured[captured.indexOf('--resume') + 1], 'sess-1')
  assert.ok(!captured.includes('--append-system-prompt'))
})

test('ClaudeCodeSession seeds a given session id so the opening prompt resumes it (#720)', async () => {
  let captured: string[] = []
  const spawn: SpawnLike = (_cmd, args) => {
    captured = [...args]
    return fakeSpawn([JSON.stringify({ type: 'result', result: 'ok', session_id: 'sess-42' })])(_cmd, args, { cwd: '/ws', env: {} })
  }
  // A finished agent's session id is threaded in at start; the very first `resume` prompt continues it.
  const session = await new ClaudeCodeDriver({ spawn }).start({ cwd: '/ws', system: 'framing', resumeSessionId: 'sess-42' })
  await session.prompt('keep going', { resume: true })
  assert.equal(captured[captured.indexOf('--resume') + 1], 'sess-42')
  assert.ok(!captured.includes('--append-system-prompt')) // the resumed transcript already carries its framing
})

test('ClaudeCodeSession retries without --resume when the conversation is gone (#778)', async () => {
  const calls: string[][] = []
  const spawn: SpawnLike = (_cmd, args, options) => {
    calls.push([...args])
    // First attempt: the CLI refuses the id it was asked to resume. Second: a normal turn.
    return calls.length === 1
      ? fakeSpawn([], 1, 'No conversation found with session ID: sess-42')(_cmd, args, options)
      : fakeSpawn([JSON.stringify({ type: 'result', result: 'ok', session_id: 'sess-99' })])(_cmd, args, options)
  }
  const events: DriverEvent[] = []
  const session = await new ClaudeCodeDriver({ spawn }).start({ cwd: '/ws', system: 'framing', resumeSessionId: 'sess-42', onEvent: e => events.push(e) })

  const turn = await session.prompt('keep going', { resume: true })
  assert.equal(turn.text, 'ok') // the message lands rather than failing the session
  assert.equal(calls.length, 2)
  assert.equal(calls[0]?.[calls[0].indexOf('--resume') + 1], 'sess-42')
  // The retry is a fresh conversation, so it carries the system framing the resume skipped.
  assert.ok(!calls[1]?.includes('--resume'))
  assert.ok(calls[1]?.includes('--append-system-prompt'))
  assert.ok(events.some(e => e.type === 'notice' && /no longer available/.test(e.message)))

  // The dead id is dropped, so the next chat turn chains off the new conversation.
  await session.prompt('and again', { resume: true })
  assert.equal(calls[2]?.[calls[2].indexOf('--resume') + 1], 'sess-99')
})

test('ClaudeCodeSession does not retry a turn that failed for any other reason (#778)', async () => {
  const calls: string[][] = []
  const spawn: SpawnLike = (_cmd, args, options) => {
    calls.push([...args])
    return fakeSpawn([], 1, 'boom')(_cmd, args, options)
  }
  const session = await new ClaudeCodeDriver({ spawn }).start({ cwd: '/ws', system: 'framing', resumeSessionId: 'sess-42' })
  await assert.rejects(session.prompt('keep going', { resume: true }), /boom/)
  assert.equal(calls.length, 1)
})

test('ClaudeCodeSession runs a fresh turn when resume is asked with no prior session (#714)', async () => {
  let captured: string[] = []
  const spawn: SpawnLike = (_cmd, args) => {
    captured = [...args]
    return fakeSpawn([JSON.stringify({ type: 'result', result: 'ok' })])(_cmd, args, { cwd: '/ws', env: {} })
  }
  const session = await new ClaudeCodeDriver({ spawn }).start({ cwd: '/ws', system: 'framing' })
  await session.prompt('hi', { resume: true })
  assert.ok(!captured.includes('--resume'))
  assert.ok(captured.includes('--append-system-prompt'))
})

test('StreamJsonParser surfaces the rate-limit telemetry the agent emits per turn (#517)', () => {
  const p = new StreamJsonParser()
  // Real payload shape, captured from `claude -p --output-format stream-json`.
  const events = p.push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        resetsAt: 1784079000,
        rateLimitType: 'five_hour',
        overageStatus: 'rejected',
        isUsingOverage: false,
      },
      session_id: 'sess-1',
    }),
  )
  assert.deepEqual(events, [
    // The first sighting of the id announces it (#1322)…
    { type: 'session', sessionId: 'sess-1' },
    // …and the telemetry converts, seconds in, millis out.
    { type: 'rate-limit', limit: { status: 'allowed', window: 'five_hour', resetsAt: 1784079000_000 } },
  ])
  // Telemetry must not disturb the turn itself.
  assert.deepEqual(p.result(), { text: '', sessionId: 'sess-1' })
})

test('StreamJsonParser passes through rate-limit values it has never seen (#517)', () => {
  const p = new StreamJsonParser()
  // We have only ever observed status=allowed / window=five_hour. An unknown
  // value is the signal we are capturing for, so it must not be dropped.
  const events = p.push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed_warning', resetsAt: 1784079000, rateLimitType: 'seven_day_opus' },
    }),
  )
  assert.deepEqual(events, [
    { type: 'rate-limit', limit: { status: 'allowed_warning', window: 'seven_day_opus', resetsAt: 1784079000_000 } },
  ])
})

test('StreamJsonParser stays silent on a malformed rate_limit_event (#517)', () => {
  const p = new StreamJsonParser()
  // Reporting a bogus reset time is worse than reporting nothing.
  assert.deepEqual(p.push(JSON.stringify({ type: 'rate_limit_event' })), [])
  assert.deepEqual(p.push(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: null })), [])
  assert.deepEqual(
    p.push(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour' } })),
    [],
  )
  assert.deepEqual(
    p.push(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', resetsAt: 'soon' } })),
    [],
  )
})

test('a session that keeps a log names its diary in the agent environment; one without does not', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'claude-diary-env-'))
  try {
    const seen: NodeJS.ProcessEnv[] = []
    const spawn: SpawnLike = (cmd, args, opts) => {
      seen.push(opts.env)
      return fakeSpawn([JSON.stringify({ type: 'result', result: 'ok' })])(cmd, args, opts)
    }
    const driver = new ClaudeCodeDriver({ spawn, env: { KEEP: '1' } })
    const logged = await driver.start({ cwd: dir, log: { dir, card: { id: 'r1' } } })
    await logged.prompt('go')
    await logged.log!.settled()
    await (await driver.start({ cwd: dir })).prompt('go')
    assert.deepEqual(seen[0], { KEEP: '1', AGENT_DIARY: join(dir, 'r1.jsonl') })
    assert.deepEqual(seen[1], { KEEP: '1' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/** Runs one turn on a Claude Code driver with `opts`, and answers the arguments and the environment Claude Code was spawned with. */
async function spawnedWith(opts: ConstructorParameters<typeof ClaudeCodeDriver>[0]): Promise<{ args: string[]; env: NodeJS.ProcessEnv }> {
  let seen: { args: string[]; env: NodeJS.ProcessEnv } | undefined
  const spawn: SpawnLike = (cmd, args, spawnOpts) => ((seen = { args: [...args], env: spawnOpts.env ?? {} }), fakeSpawn([JSON.stringify({ type: 'result', result: 'ok' })])(cmd, args, spawnOpts))
  const session = await new ClaudeCodeDriver({ ...opts, spawn }).start({ cwd: '/ws' })
  await session.prompt('go')
  return seen!
}

test('ClaudeCodeDriver turns each part of the person\'s setup that is off into Claude Code\'s own switch, and only those', async () => {
  const none = await spawnedWith({ env: {} })
  assert.equal(none.env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'], undefined, 'no setup given: Claude Code as it is')
  assert.ok(!none.args.includes('--setting-sources'))
  const off = await spawnedWith({ env: { KEEP: 'yes' }, extraArgs: ['--x'], personal: { memory: false, connectors: false, skills: false } })
  assert.equal(off.env['KEEP'], 'yes', 'the caller\'s environment kept')
  assert.equal(off.env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'], '1')
  assert.equal(off.env['ENABLE_CLAUDEAI_MCP_SERVERS'], 'false')
  assert.deepEqual(off.args.slice(-3), ['--setting-sources', 'project,local', '--x'], 'the caller\'s own extra args kept')
  const memory = await spawnedWith({ env: {}, personal: { memory: true, connectors: false, skills: false } })
  assert.equal(memory.env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'], undefined)
  assert.equal(memory.env['ENABLE_CLAUDEAI_MCP_SERVERS'], 'false')
  const connectors = await spawnedWith({ env: {}, personal: { memory: false, connectors: true, skills: false } })
  assert.equal(connectors.env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'], '1')
  assert.equal(connectors.env['ENABLE_CLAUDEAI_MCP_SERVERS'], undefined)
  const skills = await spawnedWith({ env: {}, personal: { memory: false, connectors: false, skills: true } })
  assert.ok(!skills.args.includes('--setting-sources'))
})

test('claudeCodeReady asks claude: its JSON login flag, the login command, the install page', async () => {
  const answer = (auth: string) => (_bin: string, args: readonly string[]) => Promise.resolve({ ok: true, output: args[0] === '--version' ? '2.1.283' : auth })
  assert.deepEqual(await claudeCodeReady({ isRoot: () => false, probe: answer('{"loggedIn": true}') }), { problems: [], warnings: [] })
  assert.match((await claudeCodeReady({ isRoot: () => false, probe: answer('{"loggedIn": false}') })).problems[0]!, /claude auth login/)
  const missing = await claudeCodeReady({ isRoot: () => false, probe: () => Promise.resolve({ ok: false, output: '' }) })
  assert.match(missing.problems[0]!, /`claude` not found.*claude\.com\/claude-code/)
})

test('ClaudeCodeDriver reads the quota with the personal setup\'s environment switches', async () => {
  let env: NodeJS.ProcessEnv = {}
  const spawn: SpawnLike = (cmd, args, spawnOpts) => ((env = spawnOpts.env ?? {}), fakeSpawn(['{}'])(cmd, args, spawnOpts))
  await new ClaudeCodeDriver({ spawn, env: {}, personal: { memory: false, connectors: false, skills: false } }).readQuota()
  assert.equal(env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'], '1')
  assert.equal(env['ENABLE_CLAUDEAI_MCP_SERVERS'], 'false')
})
