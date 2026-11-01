import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Readable, Writable } from 'node:stream'
import { parseQuotaReadout, readClaudeQuota } from './claude-code-quota.js'
import { isTransientQuotaReason, type SpawnLike, type SpawnedProcess } from '@openagt/agent-driver'

/**
 * A real 2.1.210 readout, verbatim, including the trailing behaviour breakdown
 * whose lines are shaped just closely enough to fool a lazier parser.
 */
const REAL_READOUT = [
  'You are currently using your subscription to power your Claude Code usage',
  '',
  'Current session: 2% used · resets Jul 15 at 7pm (Asia/Jerusalem)',
  'Current week (all models): 24% used · resets Jul 18 at 7am (Asia/Jerusalem)',
  'Current week (Fable): 15% used · resets Jul 18 at 7am (Asia/Jerusalem)',
  '',
  "What's contributing to your limits usage?",
  'Approximate, based on local sessions on this machine — does not include other devices or claude.ai.',
  '',
  'Last 24h · 2090 requests · 166 sessions',
  '  70% of your usage was at >150k context',
  '  29% of your usage came from subagent-heavy sessions',
  '  Top skills: /dataviz 2%, /claude-api 1%',
  '  Top subagents: Explore 1%',
].join('\n')

const COST_READOUT = `Total cost:            $0.0000
Total duration (API):  0s
Total duration (wall): 0s
Total code changes:    0 lines added, 0 lines removed
Usage:                 0 input, 0 output, 0 cache read, 0 cache write`

test('parseQuotaReadout reads each window off a real readout (#521)', () => {
  const quota = parseQuotaReadout(REAL_READOUT)
  assert.equal(quota.available, true)
  assert.ok(quota.available)
  assert.deepEqual(quota.windows, [
    { label: 'Current session', kind: 'session', percentUsed: 2, resetsAtText: 'Jul 15 at 7pm (Asia/Jerusalem)' },
    { label: 'Current week (all models)', kind: 'week', percentUsed: 24, resetsAtText: 'Jul 18 at 7am (Asia/Jerusalem)' },
    { label: 'Current week (Fable)', kind: 'week-model', percentUsed: 15, resetsAtText: 'Jul 18 at 7am (Asia/Jerusalem)' },
  ])
})

test('parseQuotaReadout ignores the behaviour lines that only look like windows (#521)', () => {
  const quota = parseQuotaReadout(REAL_READOUT)
  assert.ok(quota.available)
  // '70% of your usage...' and 'Top skills: /dataviz 2%' must not become windows.
  assert.equal(quota.windows.length, 3)
  assert.ok(quota.windows.every(w => w.label.startsWith('Current ')))
})

test('parseQuotaReadout keeps reading an account that is burning overage (#521)', () => {
  // The header differs mid-overage, but the account still has a quota to report.
  const quota = parseQuotaReadout(
    [
      'You are currently using your overages to power your Claude Code usage. We will automatically switch you back to your subscription rate limits when they reset',
      '',
      'Current session: 80% used · resets in 2h 53m',
    ].join('\n'),
  )
  assert.ok(quota.available)
  assert.deepEqual(quota.windows, [
    { label: 'Current session', kind: 'session', percentUsed: 80, resetsAtText: 'in 2h 53m' },
  ])
})

test('parseQuotaReadout takes a fractional percentage', () => {
  const quota = parseQuotaReadout('Current session: 0.5% used · resets in 1h')
  assert.ok(quota.available)
  assert.equal(quota.windows[0]?.percentUsed, 0.5)
})

test('parseQuotaReadout handles a window with no reset phrase', () => {
  const quota = parseQuotaReadout('Current session: 12% used')
  assert.ok(quota.available)
  assert.deepEqual(quota.windows, [{ label: 'Current session', kind: 'session', percentUsed: 12 }])
})

test('parseQuotaReadout separates a reworded readout from an account with no quota (#521)', () => {
  // Header present, windows unreadable: our parser is behind the CLI.
  assert.deepEqual(parseQuotaReadout('You are currently using your subscription to power your Claude Code usage\n\nSession: nearly full'), {
    available: false,
    reason: 'unrecognized',
  })
  // What `/usage` really answers for an API key, measured on 2.1.316.
  assert.deepEqual(parseQuotaReadout(COST_READOUT), { available: false, reason: 'no-subscription' })
  // Anything else says nothing about the account: one odd answer must not read as "no subscription".
  assert.deepEqual(parseQuotaReadout('Some other answer entirely'), { available: false, reason: 'unrecognized' })
  assert.deepEqual(parseQuotaReadout(''), { available: false, reason: 'unrecognized' })
})

test('parseQuotaReadout never reports an empty reading as zero use (#521)', () => {
  const quota = parseQuotaReadout('')
  // A silent 0% would read as "nothing used" and let a limit run the account dry.
  assert.equal(quota.available, false)
})

test('isTransientQuotaReason splits this-attempt failures from setup failures', () => {
  assert.equal(isTransientQuotaReason('fetch-failed'), true)
  assert.equal(isTransientQuotaReason('timeout'), true)
  // One answer we could not read, not a statement about the install (#960).
  assert.equal(isTransientQuotaReason('unrecognized'), true)
  assert.equal(isTransientQuotaReason('no-subscription'), false)
  assert.equal(isTransientQuotaReason('agent-not-found'), false)
})

/** A fake process that emits `stdout` then closes with `code`. */
function fakeSpawn(stdout: string, code = 0, onSpawn?: (args: readonly string[]) => void): SpawnLike {
  return (_command, args) => {
    onSpawn?.(args)
    const out = Readable.from([stdout])
    const proc: SpawnedProcess = {
      stdout: out,
      stderr: Readable.from([]),
      stdin: new Writable({ write: (_c, _e, cb) => cb() }),
      on(event, listener) {
        if (event === 'close') out.on('end', () => (listener as (c: number | null) => void)(code))
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
}

test('readClaudeQuota unwraps the CLI json envelope (#521)', async () => {
  const quota = await readClaudeQuota({
    spawn: fakeSpawn(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: REAL_READOUT })),
  })
  assert.ok(quota.available)
  assert.equal(quota.windows.length, 3)
})

test('readClaudeQuota asks the CLI for its own usage readout, not a model turn (#521)', async () => {
  let seen: readonly string[] = []
  await readClaudeQuota({ spawn: fakeSpawn(JSON.stringify({ result: REAL_READOUT }), 0, args => (seen = args)) })
  assert.deepEqual([...seen], ['-p', '/usage', '--output-format', 'json'])
  // --bare would pin the CLI to API-key auth and hide the subscription quota.
  assert.ok(!seen.includes('--bare'))
})

test("readClaudeQuota reports the CLI's own error arm as transient (#521)", async () => {
  const quota = await readClaudeQuota({
    spawn: fakeSpawn(JSON.stringify({ type: 'result', is_error: true, result: 'usage fetch failed' })),
  })
  assert.deepEqual(quota, { available: false, reason: 'fetch-failed' })
})

test('readClaudeQuota treats a non-zero exit as a transient fetch failure (#521)', async () => {
  const quota = await readClaudeQuota({ spawn: fakeSpawn('', 1) })
  assert.deepEqual(quota, { available: false, reason: 'fetch-failed' })
})

test('readClaudeQuota reports unparseable output rather than guessing (#521)', async () => {
  const quota = await readClaudeQuota({ spawn: fakeSpawn('not json at all') })
  assert.deepEqual(quota, { available: false, reason: 'unrecognized' })
})

test('readClaudeQuota reports a missing binary distinctly (#521)', async () => {
  const spawn: SpawnLike = () => {
    const proc: SpawnedProcess = {
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      stdin: new Writable({ write: (_c, _e, cb) => cb() }),
      on(event, listener) {
        // ENOENT surfaces as an 'error' event, never as a non-zero exit.
        if (event === 'error') queueMicrotask(() => (listener as (e: Error) => void)(new Error('ENOENT')))
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
  assert.deepEqual(await readClaudeQuota({ spawn }), { available: false, reason: 'agent-not-found' })
})

test('readClaudeQuota gives up on a hung agent (#521)', async () => {
  const spawn: SpawnLike = () => {
    const proc: SpawnedProcess = {
      // Never ends, never closes.
      stdout: new Readable({ read: () => undefined }),
      stderr: Readable.from([]),
      stdin: new Writable({ write: (_c, _e, cb) => cb() }),
      on: () => proc,
      kill: () => undefined,
    }
    return proc
  }
  assert.deepEqual(await readClaudeQuota({ spawn, timeoutMs: 5 }), { available: false, reason: 'timeout' })
})
