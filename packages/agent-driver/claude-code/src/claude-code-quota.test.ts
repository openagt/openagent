import { strict as assert } from 'node:assert'
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Readable, Writable } from 'node:stream'
import { keepClaudeReading, keptClaudeReading, parseQuotaReadout, readClaudeQuota } from './claude-code-quota.js'
import type { SpawnLike, SpawnedProcess } from '@openagt/agent-driver'
import { isTransientQuotaReason } from '@openagt/hooks'

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

/** A `claude` whose `/usage` answers `stdout` once {@link end} is called, and how often it was started. */
function heldSpawn(stdout: string): { spawn: SpawnLike; started: () => number; end: () => void } {
  let started = 0
  const held: Readable[] = []
  const spawn: SpawnLike = () => {
    started += 1
    const out = new Readable({ read: () => undefined })
    held.push(out)
    const proc: SpawnedProcess = {
      stdout: out,
      stderr: Readable.from([]),
      stdin: new Writable({ write: (_c, _e, cb) => cb() }),
      on(event, listener) {
        if (event === 'close') out.on('end', () => (listener as (c: number | null) => void)(0))
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
  const end = (): void => {
    for (const out of held.splice(0)) {
      out.push(stdout)
      out.push(null)
    }
  }
  return { spawn, started: () => started, end }
}

/** `spawn`, counting how often it was started. */
function counting(spawn: SpawnLike): { spawn: SpawnLike; started: () => number } {
  let started = 0
  return {
    spawn: (...args) => {
      started += 1
      return spawn(...args)
    },
    started: () => started,
  }
}

const READOUT = JSON.stringify({ result: REAL_READOUT })
const REFUSED = JSON.stringify({ type: 'result', is_error: true, result: 'usage fetch failed' })
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function inDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'claude-usage-'))
  try {
    await body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('whoever asks while a read of the same login goes on is answered by it: one `claude` for everyone at that moment', async () => {
  const claude = heldSpawn(READOUT)
  const env = { HOME: '/home/ada' }
  const asks = [readClaudeQuota({ spawn: claude.spawn, env }), readClaudeQuota({ spawn: claude.spawn, env }), readClaudeQuota({ spawn: claude.spawn, env, cwd: '/a/project' })]
  claude.end()
  const [first, ...rest] = await Promise.all(asks)
  assert.equal(claude.started(), 1)
  assert.ok(first?.available)
  for (const quota of rest) assert.deepEqual(quota, first)
  // That read is over: the next ask is a read of its own.
  const next = readClaudeQuota({ spawn: claude.spawn, env })
  claude.end()
  await next
  assert.equal(claude.started(), 2)
})

test('a read of another login is a read of its own', async () => {
  const claude = heldSpawn(READOUT)
  const asks = [readClaudeQuota({ spawn: claude.spawn, env: { HOME: '/home/ada' } }), readClaudeQuota({ spawn: claude.spawn, env: { HOME: '/home/ada', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-other' } })]
  claude.end()
  await Promise.all(asks)
  assert.equal(claude.started(), 2)
})

test('an ask that stops waiting is answered `timeout`, and the read goes on for whoever else asked', async () => {
  const claude = heldSpawn(READOUT)
  const stop = new AbortController()
  const leaving = readClaudeQuota({ spawn: claude.spawn, signal: stop.signal })
  const staying = readClaudeQuota({ spawn: claude.spawn })
  stop.abort()
  assert.deepEqual(await leaving, { available: false, reason: 'timeout' })
  claude.end()
  assert.ok((await staying).available)
  assert.equal(claude.started(), 1)
})

test("across this computer's processes one reads at a time: who finds another's read going on waits, and is answered what it kept", () =>
  inDir(async dir => {
    const keptIn = join(dir, 'usage.json')
    const claude = counting(fakeSpawn(READOUT))
    // Another process of this computer is reading: its lock, its process alive (this one).
    writeFileSync(`${keptIn}.lock`, `${process.pid}\n`)
    const waiting = readClaudeQuota({ spawn: claude.spawn, keptIn })
    await sleep(400)
    const theirs = parseQuotaReadout(REAL_READOUT.replace('2% used', '7% used'))
    keepClaudeReading(theirs, keptIn)
    rmSync(`${keptIn}.lock`)
    assert.deepEqual(await waiting, theirs)
    assert.equal(claude.started(), 0)
  }))

test('a good reading is kept for everyone, readable by this user only, and answers whoever asks in the same moment', () =>
  inDir(async dir => {
    const keptIn = join(dir, 'usage.json')
    const claude = counting(fakeSpawn(READOUT))
    assert.ok((await readClaudeQuota({ spawn: claude.spawn, keptIn })).available)
    assert.equal((await stat(keptIn)).mode & 0o777, 0o600)
    assert.equal(existsSync(`${keptIn}.lock`), false, 'the lock goes with the read')
    assert.ok((await readClaudeQuota({ spawn: claude.spawn, keptIn })).available)
    assert.equal(claude.started(), 1, 'the reading of a moment ago answered')
    assert.ok(keptClaudeReading(keptIn, Date.now(), 60_000)?.available)
  }))

test('a failed read answers only whoever waited for it: who asks after it reads again, and the good reading before it stays kept', () =>
  inDir(async dir => {
    const keptIn = join(dir, 'usage.json')
    // A good reading of a minute ago: past the moment, still kept.
    keepClaudeReading(parseQuotaReadout(REAL_READOUT), keptIn, Date.now() - 60_000)
    const claude = counting(fakeSpawn(REFUSED))
    assert.deepEqual(await readClaudeQuota({ spawn: claude.spawn, keptIn }), { available: false, reason: 'fetch-failed' })
    assert.deepEqual(await readClaudeQuota({ spawn: claude.spawn, keptIn }), { available: false, reason: 'fetch-failed' })
    assert.equal(claude.started(), 2)
    assert.ok(keptClaudeReading(keptIn, Date.now(), 5 * 60_000)?.available, 'the good reading of a minute ago')

    writeFileSync(`${keptIn}.lock`, `${process.pid}\n`)
    const waiting = readClaudeQuota({ spawn: claude.spawn, keptIn })
    await sleep(400)
    keepClaudeReading({ available: false, reason: 'timeout' }, keptIn)
    rmSync(`${keptIn}.lock`)
    assert.deepEqual(await waiting, { available: false, reason: 'timeout' }, 'the failure of the read it waited for')
    assert.equal(claude.started(), 2)
  }))

test("a lock left by a read whose process is gone, or held past a read's time, is taken over", () =>
  inDir(async dir => {
    const claude = counting(fakeSpawn(READOUT))
    const gone = join(dir, 'gone.json')
    // No process has this pid: past the most Linux ever gives out (2^22).
    writeFileSync(`${gone}.lock`, `${2 ** 22 + 1}\n`)
    assert.ok((await readClaudeQuota({ spawn: claude.spawn, keptIn: gone })).available)
    const hung = join(dir, 'hung.json')
    writeFileSync(`${hung}.lock`, `${process.pid}\n`)
    const longAgo = new Date(Date.now() - 60 * 60_000)
    utimesSync(`${hung}.lock`, longAgo, longAgo)
    assert.ok((await readClaudeQuota({ spawn: claude.spawn, keptIn: hung })).available)
    assert.equal(claude.started(), 2)
    assert.equal(existsSync(`${gone}.lock`) || existsSync(`${hung}.lock`), false)
  }))

test("the real CLI's reads are shared through the person's own file", () =>
  inDir(async dir => {
    const bin = join(dir, 'claude')
    writeFileSync(bin, `#!/bin/sh\necho started >> "${dir}/started"\nprintf '%s' '${READOUT.replaceAll("'", "'\\''")}'\n`, { mode: 0o755 })
    const env = { PATH: process.env['PATH'], XDG_CONFIG_HOME: join(dir, 'config') }
    assert.ok((await readClaudeQuota({ bin, env })).available)
    assert.ok(keptClaudeReading(join(dir, 'config', 'openagent-claude-usage.json'), Date.now(), 60_000)?.available)
    assert.ok((await readClaudeQuota({ bin, env })).available)
    assert.equal((await stat(join(dir, 'started'))).size, 'started\n'.length, 'started once')
  }))
