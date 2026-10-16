import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { PassThrough, Readable } from 'node:stream'
import { CodexDriver, codexReady, defaultCodexHome, parseCodexModels, parseCodexUsage } from './codex.js'
import { AgentExitError, type SpawnLike, type SpawnedProcess, type Driver, type DriverEvent } from '@openagt/agent-driver'

type Message = { method: string; params: Record<string, unknown> }
const note = (method: string, params: Record<string, unknown>): Message => ({ method, params })
const item = (started: boolean, fields: Record<string, unknown>) => note(started ? 'item/started' : 'item/completed', { item: fields, threadId: 'thread-1', turnId: 'turn-1' })
const delta = (itemId: string, text: string) => note('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId, delta: text })
const usage = (turnId: string, inputTokens: number, cachedInputTokens: number, outputTokens: number) =>
  note('thread/tokenUsage/updated', { threadId: 'thread-1', turnId, tokenUsage: { last: { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens: 0, totalTokens: inputTokens + outputTokens } } })
const completed = (status: string, error: Record<string, unknown> | null = null) => note('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status, error } })

/** A real codex-cli 0.144.4 turn, shortened: "Create a file hello.txt containing hi, using a shell command". */
const REAL_TURN: Message[] = [
  note('turn/started', { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'inProgress' } }),
  item(true, { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'go' }] }),
  item(true, { type: 'agentMessage', id: 'msg_1', text: '', phase: 'commentary' }),
  delta('msg_1', 'I’ll'),
  delta('msg_1', ' create'),
  delta('msg_1', ' it.'),
  item(false, { type: 'agentMessage', id: 'msg_1', text: 'I’ll create it.', phase: 'commentary' }),
  item(true, { type: 'commandExecution', id: 'exec-1', command: `/bin/zsh -lc "printf 'hi' > hello.txt"`, status: 'inProgress' }),
  item(false, { type: 'commandExecution', id: 'exec-1', command: `/bin/zsh -lc "printf 'hi' > hello.txt"`, status: 'completed', exitCode: 0 }),
  usage('turn-1', 13536, 9984, 127),
  item(false, { type: 'reasoning', id: 'rs_1', summary: ['**Checking the file**'], content: [] }),
  item(true, { type: 'fileChange', id: 'fc_1', changes: [{ path: '/tmp/cx/hello.txt', kind: 'add' }], status: 'inProgress' }),
  item(true, { type: 'agentMessage', id: 'msg_2', text: '', phase: 'final_answer' }),
  delta('msg_2', 'Created'),
  delta('msg_2', ' hello.txt'),
  item(false, { type: 'agentMessage', id: 'msg_2', text: 'Created hello.txt', phase: 'final_answer' }),
  usage('turn-1', 13686, 13056, 25),
  completed('completed'),
]

/** How a {@link fakeAppServer} behaves. */
interface FakeServer {
  /** What it sends once the turn has started. Default {@link REAL_TURN}. */
  turn?: Message[]
  /** What it sends right after answering `thread/resume`. */
  afterResume?: Message[]
  /** The method it refuses, with the message. */
  refuse?: { method: string; message: string }
  /** Exit on its own with this code once the turn has started, before the turn ends. */
  exitEarly?: number
  stderr?: string
  /** Raw lines it writes before anything else. */
  noise?: string[]
}

/** What a {@link fakeAppServer} was asked: the arguments, the environment, and every message it read. */
interface Seen {
  args: readonly string[]
  env: NodeJS.ProcessEnv
  messages: Record<string, unknown>[]
}

/** A fake `codex app-server`: answers the requests it reads on stdin, and exits once stdin closes. */
function fakeAppServer(server: FakeServer = {}, seen?: (s: Seen) => void): SpawnLike {
  return (_command, args, spawnOpts) => {
    const record: Seen = { args, env: spawnOpts.env, messages: [] }
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let closer: ((code: number | null) => void) | undefined
    let exited = false
    const exit = (code: number) => {
      if (exited) return
      exited = true
      stdout.end()
      stdout.on('end', () => setImmediate(() => (seen?.(record), closer?.(code))))
      stdout.resume()
    }
    const send = (msg: unknown) => stdout.write(JSON.stringify(msg) + '\n')
    for (const line of server.noise ?? []) stdout.write(line + '\n')
    createInterface({ input: stdin }).on('line', line => {
      const msg = JSON.parse(line) as { id?: number; method?: string; params?: Record<string, unknown> }
      record.messages.push(msg)
      if (msg.id === undefined || msg.method === undefined) return
      if (server.refuse?.method === msg.method) return send({ id: msg.id, error: { code: -32600, message: server.refuse.message } })
      if (msg.method === 'initialize') return send({ id: msg.id, result: { userAgent: 'fake' } })
      if (msg.method === 'thread/start' || msg.method === 'thread/resume') {
        const threadId = msg.method === 'thread/resume' ? msg.params?.['threadId'] : 'thread-1'
        send({ id: msg.id, result: { thread: { id: threadId }, model: 'gpt-5.6-terra' } })
        if (msg.method === 'thread/resume') for (const m of server.afterResume ?? []) send(m)
        return
      }
      if (msg.method === 'turn/start') {
        send({ id: msg.id, result: { turn: { id: 'turn-1', items: [], status: 'inProgress' } } })
        for (const m of server.turn ?? REAL_TURN) send(m)
        if (server.exitEarly !== undefined) exit(server.exitEarly)
      }
    })
    stdin.on('finish', () => exit(0))
    const proc: SpawnedProcess = {
      stdout,
      stderr: Readable.from(server.stderr ? [server.stderr] : []),
      stdin,
      on(event, listener) {
        if (event === 'close') closer = listener as (code: number | null) => void
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
}

/** The requests (and the one notification) a fake server read, as `method` → `params`. */
function requests(seen: Seen): { method: unknown; params: unknown }[] {
  return seen.messages.map(m => ({ method: m['method'], params: m['params'] }))
}

/** Runs one turn on a Codex driver with `opts` against a fake server, and answers what the server saw. */
async function spawnedWith(opts: ConstructorParameters<typeof CodexDriver>[0], start: { cwd?: string; system?: string; model?: string; effort?: string; noTools?: boolean } = {}): Promise<Seen> {
  let seen: Seen | undefined
  const session = await new CodexDriver({ spawn: fakeAppServer({}, s => (seen = s)), ...opts }).start({ cwd: '/ws', ...start })
  await session.prompt('go')
  return seen!
}

test('a text attached to a prompt and a sentence added after it reach Codex as one message, the attached text between the two; the start event names each apart', async () => {
  const events: DriverEvent[] = []
  let seen: Seen | undefined
  const session = await new CodexDriver({ spawn: fakeAppServer({}, s => (seen = s)) }).start({ cwd: '/ws', onEvent: e => events.push(e) })
  await session.prompt('/answer-comments', { attached: 'Found:\n[1]', added: 'Commit your work.' })
  const turn = seen!.messages.find(m => m['method'] === 'turn/start')!['params'] as { input: { text: string }[] }
  assert.equal(turn.input[0]!.text, '/answer-comments\n\nFound:\n[1]\n\nCommit your work.')
  assert.deepEqual(events.find(e => e.type === 'start'), { type: 'start', prompt: '/answer-comments', attached: 'Found:\n[1]', added: 'Commit your work.' })
})

test('a Codex turn streams its messages word by word, what each tool call did, and its thoughts', async () => {
  const events: DriverEvent[] = []
  const session = await new CodexDriver({ spawn: fakeAppServer() }).start({ cwd: '/ws', onEvent: e => events.push(e) })
  const turn = await session.prompt('go')
  // Codex narrates as it goes; the last message is its answer, not the first.
  assert.equal(turn.text, 'Created hello.txt')
  assert.equal(turn.sessionId, 'thread-1')
  assert.deepEqual(events.filter(e => e.type !== 'result'), [
    { type: 'start', prompt: 'go' },
    // Announced before anything else the turn streams: a turn stopped midway still leaves it.
    { type: 'session', sessionId: 'thread-1' },
    { type: 'model', model: 'gpt-5.6-terra' },
    // Each piece carries the message so far, not the newest piece alone.
    { type: 'partial', text: 'I’ll' },
    { type: 'partial', text: 'I’ll create' },
    { type: 'partial', text: 'I’ll create it.' },
    { type: 'text', text: 'I’ll create it.' },
    { type: 'action', label: 'commandExecution', detail: "printf 'hi' > hello.txt", id: 'exec-1' },
    { type: 'thought', text: '**Checking the file**' },
    { type: 'action', label: 'fileChange', detail: '/tmp/cx/hello.txt', id: 'fc_1' },
    // A new message starts from nothing.
    { type: 'partial', text: 'Created' },
    { type: 'partial', text: 'Created hello.txt' },
    { type: 'text', text: 'Created hello.txt' },
  ])
  assert.ok(events.at(-1)?.type === 'result')
})

test('a Codex turn reports its tokens, summed over its model calls, but never a price (#540)', async () => {
  const session = await new CodexDriver({ spawn: fakeAppServer() }).start({ cwd: '/ws' })
  const { usage } = await session.prompt('go')
  assert.deepEqual(usage, {
    inputTokens: 3552 + 630, // each call's input minus its cached part
    outputTokens: 127 + 25,
    cacheReadTokens: 9984 + 13056,
    cacheCreationTokens: 0,
    // How full the conversation is, though, is the LAST call alone: its whole prompt and answer.
    // Summing the calls (27_328) would say the window holds twice what it does.
    contextTokens: 13_686 + 25,
  })
  // The tokens are real and reported; `costUsd: 0` would read as free, so it is absent.
  assert.equal('costUsd' in usage!, false)
})

test('a resumed Codex conversation counts only its new turn\'s tokens', async () => {
  // On resume, Codex first repeats the reading of the conversation's last turn.
  const session = await new CodexDriver({ spawn: fakeAppServer({ afterResume: [usage('old-turn', 99999, 0, 999)] }) }).start({ cwd: '/ws', resumeSessionId: 'thread-0' })
  const { usage: counted } = await session.prompt('go on', { resume: true })
  assert.equal(counted?.outputTokens, 127 + 25)
})

test('parseCodexUsage splits the cached tokens out of the inclusive input total (#540)', () => {
  // Verbatim from codex-cli 0.144.4. `inputTokens` is the whole input, cached
  // included: repeating one prompt held it at 12218 while cached rose to 12032.
  const usage = parseCodexUsage({ inputTokens: 12218, cachedInputTokens: 12032, outputTokens: 6, reasoningOutputTokens: 0 })
  assert.deepEqual(usage, {
    inputTokens: 186,
    outputTokens: 6,
    cacheReadTokens: 12032,
    cacheCreationTokens: 0,
  })
})

test('parseCodexUsage does not double-count reasoning tokens (#540)', () => {
  // reasoningOutputTokens is a subset of outputTokens, as cachedInputTokens
  // is of inputTokens — adding it would inflate the count.
  const usage = parseCodexUsage({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 500, reasoningOutputTokens: 400 })
  assert.equal(usage?.outputTokens, 500)
})

test('parseCodexUsage survives a missing or malformed payload (#540)', () => {
  assert.equal(parseCodexUsage(undefined), undefined)
  assert.equal(parseCodexUsage('nonsense'), undefined)
  // Absent fields read as 0 rather than NaN, and a nonsense cache count can never
  // push the uncached input negative.
  assert.deepEqual(parseCodexUsage({}), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })
  assert.deepEqual(parseCodexUsage({ inputTokens: 10, cachedInputTokens: 999 }), {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 10,
    cacheCreationTokens: 0,
  })
})

test('a Codex turn ignores noise that is not a message (#539)', async () => {
  // `null` is valid JSON, so it survives the parse and used to throw on the first field read —
  // inside a readline handler, which takes the daemon and every live agent with it.
  const session = await new CodexDriver({ spawn: fakeAppServer({ noise: ['WARNING: banner', '', 'null', '42', JSON.stringify({ method: 'warning' })] }) }).start({ cwd: '/ws' })
  assert.equal((await session.prompt('go')).text, 'Created hello.txt')
})

test('a Codex turn asks the app server for a sandboxed conversation in the workspace, never asking approval', async () => {
  const seen = await spawnedWith({}, { cwd: '/ws' })
  // Only the app server: no bypass of the sandbox, and no prompt as an argument.
  assert.deepEqual([...seen.args], ['app-server'])
  assert.deepEqual(requests(seen), [
    { method: 'initialize', params: { clientInfo: { name: 'agent-driver', version: '1' } } },
    { method: 'initialized', params: undefined },
    { method: 'thread/start', params: { cwd: '/ws', approvalPolicy: 'never', sandbox: 'workspace-write' } },
    { method: 'turn/start', params: { threadId: 'thread-1', input: [{ type: 'text', text: 'go', text_elements: [] }] } },
  ])
})

test('a session with nothing to do in its folder is started without what it would do it with', async () => {
  const bare = await spawnedWith({}, { cwd: '/ws', noTools: true })
  const off = [...bare.args].filter(arg => arg.startsWith('features.')).map(arg => arg.replace(/^features\.|=false$/g, ''))
  // Codex has no one switch for it: its shell, its exec and the rest ride on feature flags, which
  // go off one by one. A name Codex no longer knows is ignored by it rather than refused, so the
  // list ageing costs the saving and never the run.
  assert.ok(off.includes('shell_tool') && off.includes('unified_exec'), 'the tools it would run things with')
  assert.ok(off.includes('apps') && off.includes('plugins') && off.includes('browser_use'), 'and what it would reach out with')
  assert.equal(off.length, 13)
  assert.equal([...bare.args].filter(arg => arg === '-c').length, off.length, 'each one its own override')
  // Every other session is started as it always was.
  const usual = await spawnedWith({}, { cwd: '/ws' })
  assert.ok(![...usual.args].some(arg => arg.startsWith('features.')), 'nothing turned off for a session with work to do')
})

test('CodexDriver tells Codex how hard to think when the caller asked, and says nothing when it did not', async () => {
  const asked = await spawnedWith({}, { cwd: '/ws', effort: 'xhigh' })
  assert.deepEqual([...asked.args], ['app-server', '-c', 'model_reasoning_effort="xhigh"'])
  const plain = await spawnedWith({}, { cwd: '/ws' })
  assert.ok(![...plain.args].some(arg => arg.includes('model_reasoning_effort')), 'Codex thinks as it does by default')
})

test('CodexDriver makes the git dir writable, so a plain checkout can commit (#1747)', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codex-git-')))
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    const seen = await spawnedWith({}, { cwd: dir })
    // `workspace-write` keeps a root `.git/` read-only; without this the commit fails on `.git/index.lock`.
    assert.deepEqual([...seen.args], ['app-server', '-c', `sandbox_workspace_write.writable_roots=["${join(dir, '.git')}"]`])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CodexDriver widens no read-only sandbox, even in a repository (#1747)', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codex-git-')))
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    const seen = await spawnedWith({ sandbox: 'read-only' }, { cwd: dir })
    assert.deepEqual([...seen.args], ['app-server'])
    assert.equal(requests(seen)[2]!.params && (requests(seen)[2]!.params as Record<string, unknown>)['sandbox'], 'read-only')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CodexDriver gives the framing as Codex\'s developer instructions, the prompt alone as the input', async () => {
  let seen: Seen | undefined
  const session = await new CodexDriver({ spawn: fakeAppServer({}, s => (seen = s)) }).start({ cwd: '/ws', system: 'You are careful.' })
  await session.prompt('do the thing', { system: 'Also: be brief.' })
  const [, , thread, turn] = requests(seen!)
  assert.equal((thread!.params as Record<string, unknown>)['developerInstructions'], 'You are careful.\n\nAlso: be brief.')
  assert.deepEqual((turn!.params as Record<string, unknown>)['input'], [{ type: 'text', text: 'do the thing', text_elements: [] }])
})

test('CodexDriver continues its conversation on a resume prompt, and only then', async () => {
  const seen: Seen[] = []
  const driver = new CodexDriver({ spawn: fakeAppServer({}, s => seen.push(s)) })
  const session = await driver.start({ cwd: '/ws', system: 'FRAMING', model: 'gpt-5.5' })
  await session.prompt('build it', { resume: true })
  await session.prompt('and the tests?', { resume: true })
  await session.prompt('something new')
  const thread = (s: Seen) => requests(s)[2]!
  assert.deepEqual(thread(seen[0]!), { method: 'thread/start', params: { cwd: '/ws', approvalPolicy: 'never', sandbox: 'workspace-write', model: 'gpt-5.5', developerInstructions: 'FRAMING' } }, 'no turn yet: nothing to resume, a fresh conversation')
  // The resumed conversation already carries its framing.
  assert.deepEqual(thread(seen[1]!), { method: 'thread/resume', params: { cwd: '/ws', approvalPolicy: 'never', sandbox: 'workspace-write', model: 'gpt-5.5', threadId: 'thread-1' } })
  assert.equal(thread(seen[2]!).method, 'thread/start', 'a prompt that does not ask to resume starts fresh')
})

test('CodexDriver resumes the conversation a session was started for, under the sandbox given', async () => {
  let seen: Seen | undefined
  const driver = new CodexDriver({ sandbox: 'danger-full-access', spawn: fakeAppServer({}, s => (seen = s)) })
  const session = await driver.start({ cwd: '/ws', resumeSessionId: 'thread-0' })
  const turn = await session.prompt('go on', { resume: true })
  assert.deepEqual(requests(seen!)[2], { method: 'thread/resume', params: { cwd: '/ws', approvalPolicy: 'never', sandbox: 'danger-full-access', threadId: 'thread-0' } })
  assert.equal(turn.sessionId, 'thread-0')
})

test('CodexDriver cannot report a quota, so it says so by omission (#539)', () => {
  // The seam is optional precisely for this: no readQuota means no consumption
  // limits for Codex, rather than a made-up number.
  const driver: Driver = new CodexDriver()
  assert.equal(driver.readQuota, undefined)
})

test('a request the Codex app server makes of its own is answered with a refusal, and the turn goes on', async () => {
  let seen: Seen | undefined
  const approval = { id: 'req-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'exec-1' } }
  const session = await new CodexDriver({ spawn: fakeAppServer({ turn: [approval as unknown as Message, ...REAL_TURN] }, s => (seen = s)) }).start({ cwd: '/ws' })
  assert.equal((await session.prompt('go')).text, 'Created hello.txt')
  assert.deepEqual(seen!.messages.find(m => m['id'] === 'req-1'), { id: 'req-1', error: { code: -32601, message: 'agent-driver answers no requests' } })
})

// A real refusal from codex-cli 0.144.4 on a ChatGPT login: the API's error body, wrapped as JSON.
const REFUSED = JSON.stringify({ type: 'error', status: 400, error: { type: 'invalid_request_error', message: "The 'gpt-5' model is not supported when using Codex with a ChatGPT account." } })

test('a Codex turn that failed fails with Codex\'s reason, though the app server exits cleanly', async () => {
  const events: DriverEvent[] = []
  const failed = [note('turn/started', { turn: { id: 'turn-1' } }), completed('failed', { message: REFUSED, codexErrorInfo: 'other', additionalDetails: null })]
  const session = await new CodexDriver({ spawn: fakeAppServer({ turn: failed }) }).start({ cwd: '/ws', onEvent: e => events.push(e) })
  await assert.rejects(() => session.prompt('go'), (err: Error) => {
    // The sentence inside the API's refusal, and "failed", not "exited (0)".
    assert.equal(err.message, "codex failed: The 'gpt-5' model is not supported when using Codex with a ChatGPT account.")
    // The parts apart, for a caller that already showed the reason from the error event.
    assert.ok(err instanceof AgentExitError)
    assert.equal(err.exit, 'codex failed')
    assert.equal(err.reason, "The 'gpt-5' model is not supported when using Codex with a ChatGPT account.")
    return true
  })
  assert.deepEqual(events.at(-1), { type: 'error', message: "The 'gpt-5' model is not supported when using Codex with a ChatGPT account." })
  // A message that is not the API's JSON is the reason as it is; a turn ended with no error says how it ended.
  const plain = await new CodexDriver({ spawn: fakeAppServer({ turn: [completed('failed', { message: 'unexpected status 404 Not Found' })] }) }).start({ cwd: '/ws' })
  await assert.rejects(() => plain.prompt('go'), /codex failed: unexpected status 404 Not Found/)
  const interrupted = await new CodexDriver({ spawn: fakeAppServer({ turn: [completed('interrupted')] }) }).start({ cwd: '/ws' })
  await assert.rejects(() => interrupted.prompt('go'), /codex failed: Codex's turn ended interrupted/)
})

test('a request Codex refuses fails the turn with its reason: a conversation it cannot resume', async () => {
  const session = await new CodexDriver({ spawn: fakeAppServer({ refuse: { method: 'thread/resume', message: 'no rollout found for thread id thread-0' } }) }).start({ cwd: '/ws', resumeSessionId: 'thread-0' })
  await assert.rejects(() => session.prompt('go on', { resume: true }), /codex failed: no rollout found for thread id thread-0/)
})

test('a Codex app server that exits before its turn ends fails the turn', async () => {
  const unfinished = [note('turn/started', { turn: { id: 'turn-1' } }), item(false, { type: 'agentMessage', id: 'msg_1', text: 'Half' })]
  // A crash: what it wrote on stderr is the reason.
  const crashed = await new CodexDriver({ spawn: fakeAppServer({ turn: unfinished, exitEarly: 1, stderr: 'thread panicked' }) }).start({ cwd: '/ws' })
  await assert.rejects(() => crashed.prompt('go'), /codex exited \(1\): thread panicked/)
  // A clean exit with the turn unfinished is no answer either.
  const quiet = await new CodexDriver({ spawn: fakeAppServer({ turn: unfinished, exitEarly: 0 }) }).start({ cwd: '/ws' })
  await assert.rejects(() => quiet.prompt('go'), /codex failed: the turn did not finish/)
})

test('a Codex turn that fails keeps its session id on the log: a later resume continues the same thread', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-log-'))
  try {
    const driver = new CodexDriver({ spawn: fakeAppServer({ turn: REAL_TURN.slice(0, 4), exitEarly: 1 }) })
    const session = await driver.start({ cwd: dir, log: { dir, card: { id: 'r1' } } })
    await assert.rejects(session.prompt('build it'), /exited \(1\)/)
    await session.log!.settled()
    assert.equal(session.log!.card.caller?.['sessionId'], 'thread-1')
    assert.equal(session.log!.card.model, 'gpt-5.6-terra')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CodexDriver given no setup parts runs Codex as it is, in the person\'s own home', async () => {
  const { args, env } = await spawnedWith({ env: { PATH: '/bin' } })
  assert.ok(!args.some(arg => arg.startsWith('features.')))
  assert.equal(env['CODEX_HOME'], undefined)
})

test('CodexDriver turns memory and connectors off with Codex\'s own feature switches, each alone', async () => {
  const both = await spawnedWith({ env: {}, personal: { memory: false, connectors: false, skills: true } })
  assert.deepEqual(both.args.filter((_, i, all) => all[i - 1] === '-c' && all[i]!.startsWith('features.')), ['features.memories=false', 'features.apps=false', 'features.plugins=false'])
  assert.equal(both.env['CODEX_HOME'], undefined, 'skills on: the person\'s own home')
  const memoryOn = await spawnedWith({ env: {}, personal: { memory: true, connectors: false, skills: true } })
  assert.ok(!memoryOn.args.includes('features.memories=false'))
  assert.ok(memoryOn.args.includes('features.plugins=false'))
  const connectorsOn = await spawnedWith({ env: {}, personal: { memory: false, connectors: true, skills: true } })
  assert.ok(connectorsOn.args.includes('features.memories=false'))
  assert.ok(!connectorsOn.args.includes('features.apps=false') && !connectorsOn.args.includes('features.plugins=false'))
})

test('CodexDriver with skills off runs from a kept home that holds only a link to the person\'s login', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-home-'))
  try {
    const personal = join(dir, 'personal')
    const home = join(dir, 'state', 'codex-home')
    await mkdir(personal)
    await writeFile(join(personal, 'auth.json'), '{}')
    const skillsOff = { env: { CODEX_HOME: personal }, codexHome: home, personal: { memory: true, connectors: true, skills: false } }
    const first = await spawnedWith(skillsOff)
    assert.equal(first.env['CODEX_HOME'], home)
    assert.ok((await lstat(join(home, 'auth.json'))).isSymbolicLink())
    assert.equal(await readlink(join(home, 'auth.json')), join(personal, 'auth.json'))
    // What Codex saved there (its conversations) stays; a link pointing elsewhere is put back.
    await writeFile(join(home, 'session.jsonl'), 'kept')
    await rm(join(home, 'auth.json'))
    await symlink(join(dir, 'elsewhere.json'), join(home, 'auth.json'))
    await spawnedWith(skillsOff)
    assert.equal(await readlink(join(home, 'auth.json')), join(personal, 'auth.json'))
    assert.equal(await readFile(join(home, 'session.jsonl'), 'utf8'), 'kept')
    // A login Codex saved over the link, newer than the person's, reaches the person's file first.
    await rm(join(home, 'auth.json'))
    await writeFile(join(home, 'auth.json'), 'refreshed')
    await utimes(join(personal, 'auth.json'), new Date(0), new Date(0))
    await spawnedWith(skillsOff)
    assert.equal(await readFile(join(personal, 'auth.json'), 'utf8'), 'refreshed')
    assert.equal(await readlink(join(home, 'auth.json')), join(personal, 'auth.json'))
    // An older one does not overwrite it.
    await rm(join(home, 'auth.json'))
    await writeFile(join(home, 'auth.json'), 'stale')
    await utimes(join(home, 'auth.json'), new Date(0), new Date(0))
    await spawnedWith(skillsOff)
    assert.equal(await readFile(join(personal, 'auth.json'), 'utf8'), 'refreshed')
    // Two sessions starting at once over a saved login both start, and the person's login survives whole.
    await rm(join(home, 'auth.json'))
    await writeFile(join(home, 'auth.json'), 'refreshed again')
    await Promise.all([spawnedWith(skillsOff), spawnedWith(skillsOff)])
    assert.equal(await readFile(join(personal, 'auth.json'), 'utf8'), 'refreshed again')
    assert.equal(await readlink(join(home, 'auth.json')), join(personal, 'auth.json'))
    // Two sessions starting at once both start: with no link yet, and with a link pointing elsewhere.
    await rm(join(home, 'auth.json'))
    await Promise.all([spawnedWith(skillsOff), spawnedWith(skillsOff)])
    await rm(join(home, 'auth.json'))
    await symlink(join(dir, 'elsewhere.json'), join(home, 'auth.json'))
    await Promise.all([spawnedWith(skillsOff), spawnedWith(skillsOff)])
    assert.equal(await readlink(join(home, 'auth.json')), join(personal, 'auth.json'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a Codex home that is the person\'s own is left as it is', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-home-'))
  try {
    await writeFile(join(dir, 'auth.json'), '{}')
    await symlink(dir, `${dir}-alias`)
    const { env } = await spawnedWith({ env: { CODEX_HOME: dir }, codexHome: `${dir}-alias`, personal: { memory: true, connectors: true, skills: false } })
    assert.equal(env['CODEX_HOME'], `${dir}-alias`)
    assert.ok((await lstat(join(dir, 'auth.json'))).isFile())
  } finally {
    await rm(`${dir}-alias`, { force: true })
    await rm(dir, { recursive: true, force: true })
  }
})

test('the kept Codex home is under the state directory', () => {
  assert.equal(defaultCodexHome({ XDG_STATE_HOME: '/state' }), '/state/agent-driver/codex-home')
  assert.equal(defaultCodexHome({ HOME: '/home/me' }), '/home/me/.local/state/agent-driver/codex-home')
})

test('codexReady asks codex, and warns about ~/.agents/skills only when skills are off and it holds some', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agents-skills-'))
  try {
    const probed: string[] = []
    const probe = (bin: string, args: readonly string[]) => (probed.push(bin), Promise.resolve({ ok: true, output: args[0] === '--version' ? '0.144.4' : 'Logged in using ChatGPT' }))
    const base = { probe, isRoot: () => false, agentsSkills: dir }
    assert.deepEqual(await codexReady({ ...base, personal: { memory: false, connectors: false, skills: false } }), { problems: [], warnings: [] }, 'an empty folder')
    await mkdir(join(dir, 'my-skill'))
    const off = await codexReady({ ...base, personal: { memory: false, connectors: false, skills: false } })
    assert.deepEqual(off.problems, [])
    assert.equal(off.warnings.length, 1)
    assert.match(off.warnings[0]!, /no switch/)
    assert.ok(off.warnings[0]!.includes(dir))
    assert.deepEqual((await codexReady({ ...base, personal: { memory: false, connectors: false, skills: true } })).warnings, [], 'skills on: nothing to warn about')
    const memoryOn = await codexReady({ ...base, personal: { memory: true, connectors: false, skills: false } })
    assert.equal(memoryOn.warnings.length, 2)
    assert.match(memoryOn.warnings[1]!, /`memory` on does nothing for Codex while `skills` is off/)
    assert.equal((await codexReady({ ...base, personal: { memory: true, connectors: false, skills: true } })).warnings.length, 0)
    assert.deepEqual((await codexReady(base)).warnings, [], 'no setup given: Codex as it is')
    assert.ok(probed.every(bin => bin === 'codex'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('codexReady reads "Not logged in" as no, also off stderr, and a missing codex points at its install', async () => {
  const out = await codexReady({ isRoot: () => false, probe: (_bin, args) => Promise.resolve(args[0] === '--version' ? { ok: true, output: '0.144.4' } : { ok: false, output: 'Not logged in' }) })
  assert.match(out.problems[0]!, /codex login/)
  const missing = await codexReady({ isRoot: () => false, probe: () => Promise.resolve({ ok: false, output: '' }) })
  assert.match(missing.problems[0]!, /`codex` not found.*openai\.com\/codex/)
})

/** `codex debug models` on codex-cli 0.144, cut to the fields read. */
const CATALOG = JSON.stringify({
  models: [
    { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', priority: 3 },
    { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', priority: 12 },
    { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', visibility: 'list', priority: 7, context_window: 272_000, max_context_window: 872_000, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }] },
    { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list', priority: 8 },
  ],
})

test('parseCodexModels keeps the models Codex lists, in its own order', () => {
  assert.deepEqual(parseCodexModels(CATALOG), {
    models: [
      // Codex says both of these itself: what the model may think at, and how much it holds.
      { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', efforts: ['low', 'medium', 'high'], contextWindow: 272_000 },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna' },
      { id: 'gpt-5.5', name: 'GPT-5.5' },
    ],
  })
  assert.ok('error' in parseCodexModels('Reading config...'))
})

/** A fake process that prints the given lines then closes: a one-shot command, not the app server. */
function fakeSpawn(lines: string[], onSpawn?: (args: readonly string[]) => void, code = 0): SpawnLike {
  return (_command, args) => {
    const stdout = Readable.from([lines.map(l => l + '\n').join('')])
    const proc: SpawnedProcess = {
      stdout,
      stderr: Readable.from([]),
      stdin: new PassThrough(),
      on(event, listener) {
        if (event === 'close') stdout.on('end', () => (onSpawn?.(args), (listener as (c: number | null) => void)(code)))
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
}

test('CodexDriver.listModels asks `codex debug models`, and says why when Codex fails', async () => {
  let asked: readonly string[] = []
  const models = await new CodexDriver({ spawn: fakeSpawn([CATALOG], args => (asked = args)) }).listModels()
  assert.deepEqual(asked, ['debug', 'models'])
  assert.equal(models.length, 3)
  await assert.rejects(new CodexDriver({ spawn: fakeSpawn([], undefined, 1) }).listModels(), /`codex debug models` failed \(code 1\)/)
})

test('a Codex change to files that finished says each file it changed: lines added and removed, and the files it made', async () => {
  const events: DriverEvent[] = []
  const change = (id: string, changes: unknown[], status = 'completed') => item(false, { type: 'fileChange', id, changes, status })
  // Its headers are no lines of the file; a removed `-- note` and an added `++i;` are.
  const patch = '--- a/x.txt\n+++ b/x.txt\n@@ -1,4 +1,5 @@\n one\n-two\n--- note\n+TWO\n+two and a half\n+++i;\n three\n'
  const turn = [
    // A changed file's diff is a patch; an added file's is its content, or a patch; a deleted file's the same.
    change('fc_1', [
      { path: '/ws/x.txt', kind: { type: 'update', move_path: null }, diff: patch },
      { path: '/ws/new.txt', kind: { type: 'add' }, diff: 'one\ntwo\nthree\n' },
      { path: '/ws/new2.txt', kind: 'add', diff: '@@ -0,0 +1,2 @@\n+a\n+b\n' },
      { path: '/ws/gone.txt', kind: { type: 'delete' }, diff: 'bye\nbye\n' },
      // An added file whose own content holds a line like a hunk's is content all the same.
      { path: '/ws/new.diff', kind: 'add', diff: 'notes\n@@ -1 +1 @@\n+x\n' },
      { path: '/ws/gone2.txt', kind: 'delete', diff: '@@ -1 +0,0 @@\n-bye\n' },
      // No diff given: the file is named, with no size. No path: nothing to name.
      { path: '/ws/bare.txt', kind: 'update' },
      { kind: 'add', diff: 'x' },
      'not a change',
    ]),
    // A change that did not go through changed nothing; neither does one still going on.
    change('fc_2', [{ path: '/ws/no.txt', kind: 'add', diff: 'x\n' }], 'failed'),
    change('fc_3', [{ path: '/ws/no.txt', kind: 'add', diff: 'x\n' }], 'declined'),
    item(true, { type: 'fileChange', id: 'fc_4', changes: [{ path: '/ws/later.txt', kind: 'add', diff: 'x\n' }], status: 'inProgress' }),
    item(false, { type: 'agentMessage', id: 'msg_1', text: 'Done', phase: 'final_answer' }),
    completed('completed'),
  ]
  const session = await new CodexDriver({ spawn: fakeAppServer({ turn }) }).start({ cwd: '/ws', onEvent: e => events.push(e) })
  await session.prompt('go')
  assert.deepEqual(events.filter(e => e.type === 'output'), [
    {
      type: 'output',
      id: 'fc_1',
      text: '',
      changed: [
        { path: '/ws/x.txt', added: 3, removed: 2 },
        { path: '/ws/new.txt', added: 3, removed: 0, created: true },
        { path: '/ws/new2.txt', added: 2, removed: 0, created: true },
        { path: '/ws/gone.txt', added: 0, removed: 2 },
        { path: '/ws/new.diff', added: 3, removed: 0, created: true },
        { path: '/ws/gone2.txt', added: 0, removed: 1 },
        { path: '/ws/bare.txt', added: 0, removed: 0 },
      ],
    },
  ])
  await session.dispose()
})

/** A collab call item, with the field names and spellings of the app-server protocol (codex-cli 0.144.4). */
const collab = (done: boolean, fields: Record<string, unknown>) =>
  item(!done, { type: 'collabAgentToolCall', senderThreadId: 'thread-1', status: done ? 'completed' : 'inProgress', ...fields })

/** The events of one turn, the conversation itself left out. */
async function toolEvents(turn: Message[]): Promise<DriverEvent[]> {
  const events: DriverEvent[] = []
  const session = await new CodexDriver({ spawn: fakeAppServer({ turn: [...turn, item(false, { type: 'agentMessage', id: 'msg_1', text: 'Done', phase: 'final_answer' }), completed('completed')] }) }).start({ cwd: '/ws', onEvent: e => events.push(e) })
  await session.prompt('go')
  return events.filter(e => e.type === 'action' || e.type === 'output' || e.type === 'subagent')
}

test('a Codex collab call says a subagent for each agent it names, and a finished one no longer leaves its row live', async () => {
  const two = {
    id: 'collab-1',
    tool: 'spawnAgent',
    receiverThreadIds: ['agent-1', 'agent-2'],
    prompt: 'Review the patch and report back.',
    model: 'gpt-5.6-terra',
    reasoningEffort: 'high',
    // One call can concern several agents: the name and the role are per agent, here.
    agentsStates: [
      { agentNickname: 'reviewer', agentRole: 'reviewer', agentThreadId: 'agent-1' },
      { agentNickname: 'scout', agentRole: 'explorer', agentThreadId: 'agent-2' },
    ],
  }
  const waiting = { id: 'collab-2', tool: 'wait', agentsStates: [{ agentNickname: 'reviewer', agentRole: 'reviewer', agentThreadId: 'agent-1' }] }
  const said = { type: 'subagent', status: 'working', model: 'gpt-5.6-terra', prompt: 'Review the patch and report back.' }
  assert.deepEqual(await toolEvents([collab(false, two), collab(true, two), collab(false, waiting), collab(true, waiting)]), [
    // The call's own row, which the agent's reader shows today: now with something beside the label.
    { type: 'action', label: 'collabAgentToolCall', detail: 'spawnAgent reviewer, scout', id: 'collab-1' },
    // One subagent per agent, keyed by the call and the agent's own thread: the item's id alone
    // could not tell two agents of one call apart.
    { ...said, id: 'collab-1:agent-1', name: 'reviewer', role: 'reviewer' },
    { ...said, id: 'collab-1:agent-2', name: 'scout', role: 'explorer' },
    // The spawn itself is over — and the agents it started are not: their rows stay live.
    { type: 'output', id: 'collab-1', text: '' },
    { ...said, id: 'collab-1:agent-1', name: 'reviewer', role: 'reviewer' },
    { ...said, id: 'collab-1:agent-2', name: 'scout', role: 'explorer' },
    // A `wait` says nothing of a model or a prompt of its own, and absent is absent.
    { type: 'action', label: 'collabAgentToolCall', detail: 'wait reviewer', id: 'collab-2' },
    { type: 'subagent', id: 'collab-2:agent-1', status: 'working', name: 'reviewer', role: 'reviewer' },
    // `wait` comes back when the agent has answered: that row is over.
    { type: 'output', id: 'collab-2', text: '' },
    { type: 'subagent', id: 'collab-2:agent-1', status: 'ended', name: 'reviewer', role: 'reviewer' },
  ])
})

test('a Codex collab call that did not go through reads as failed, and a malformed one degrades quietly', async () => {
  const refused = { id: 'collab-3', tool: 'spawnAgent', status: 'declined', agentsStates: [{ agentNickname: 'reviewer', agentRole: 'reviewer', agentThreadId: 'agent-1' }] }
  // Nonsense in every field, and the core protocol's own name for the item (what `codex exec
  // --json` calls it): neither throws, and what the item does say is still said.
  const nonsense = { id: 'collab-4', tool: 'spawnAgent', agentsStates: 'nonsense', prompt: 42, model: null }
  const older = { id: 'collab-5', type: 'collab_tool_call', tool: 'spawnAgent', agentsStates: [{ agentNickname: 'reviewer' }], status: 'completed' }
  assert.deepEqual(await toolEvents([collab(true, refused), collab(true, nonsense), collab(true, older)]), [
    // `declined` and `failed` are both "did not go through", as they are for a file change.
    { type: 'output', id: 'collab-3', text: '', failed: true },
    { type: 'subagent', id: 'collab-3:agent-1', status: 'failed', name: 'reviewer', role: 'reviewer' },
    // No agent to be read: one row for the call itself, with no name and no role invented for it.
    { type: 'output', id: 'collab-4', text: '' },
    { type: 'subagent', id: 'collab-4', status: 'working' },
    { type: 'output', id: 'collab-5', text: '' },
    { type: 'subagent', id: 'collab-5:reviewer', status: 'working', name: 'reviewer' },
  ])
})

test('a Codex command that finished says what it printed and its exit code, for the id of its call', async () => {
  const events: DriverEvent[] = []
  const command = (id: string, done: Record<string, unknown> | undefined) => item(done === undefined, { type: 'commandExecution', id, command: '/bin/zsh -lc "pnpm test\n  --run"', ...done })
  const turn = [
    command('exec-1', undefined),
    command('exec-1', { status: 'completed', aggregatedOutput: '12 passed\n', exitCode: 0 }),
    command('exec-2', undefined),
    command('exec-2', { status: 'failed', aggregatedOutput: '', exitCode: 1 }),
    // Nothing printed and no failure: nothing to say.
    command('exec-3', { status: 'completed', aggregatedOutput: '', exitCode: 0 }),
    // A tool that is no command and changed no file reports no output.
    item(false, { type: 'mcpToolCall', id: 'mcp_1', server: 's', tool: 't', status: 'completed' }),
    item(false, { type: 'agentMessage', id: 'msg_1', text: 'Done', phase: 'final_answer' }),
    completed('completed'),
  ]
  const session = await new CodexDriver({ spawn: fakeAppServer({ turn }) }).start({ cwd: '/ws', onEvent: e => events.push(e) })
  await session.prompt('go')
  assert.deepEqual(events.filter(e => e.type === 'action' || e.type === 'output'), [
    // A command of two lines: the one line, and the command as it was given.
    { type: 'action', label: 'commandExecution', detail: 'pnpm test --run', whole: 'pnpm test\n  --run', id: 'exec-1' },
    { type: 'output', id: 'exec-1', text: '12 passed', exitCode: 0 },
    { type: 'action', label: 'commandExecution', detail: 'pnpm test --run', whole: 'pnpm test\n  --run', id: 'exec-2' },
    { type: 'output', id: 'exec-2', text: '', failed: true, exitCode: 1 },
  ])
})
