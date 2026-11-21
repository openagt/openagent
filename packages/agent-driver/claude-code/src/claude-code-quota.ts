import { spawn as nodeSpawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { configFile, isPidAlive, writePrivate, type SpawnLike } from '@openagt/agent-driver'
import type { DriverQuota, DriverQuotaWindow } from '@openagt/hooks'
import { CLAUDE_ENV_LOGINS } from './claude-accounts.js'

/** How long we wait for the readout before calling it a timeout. */
const READ_TIMEOUT_MS = 20_000

/** How long one read holds off the other processes: a lock older than this was left by a read that hung or died, and is taken over. */
const LOCK_HELD_MS = READ_TIMEOUT_MS + 10_000

/** How often a process waiting for another's read looks whether it ended. */
const WAIT_STEP_MS = 250

/** How long a good reading answers whoever asks after it: asks this close together are the same moment. */
const SAME_MOMENT_MS = 30_000

/**
 * What Claude Code prints for `/usage` when the login has no subscription, such as an API key: the
 * session's cost, with no windows. Only this says so: any other answer without windows tells
 * nothing about the account.
 */
const COST_READOUT = /^Total cost:/m

/**
 * One `"<label>: <n>% used · resets <when>"` line.
 *
 * Anchored and strict on `% used` immediately after the colon, because the same
 * readout carries lines that are shaped just closely enough to match a lazier
 * pattern (`"Top skills: /dataviz 2%, /claude-api 1%"`, `"  70% of your usage
 * was at >150k context"`).
 */
const WINDOW_LINE = /^(.+?):\s+(\d+(?:\.\d+)?)% used(?:\s*·\s*(.+))?$/

/** Strips the `resets` verb, which is prose framing rather than part of the value. */
const RESETS_PREFIX = /^resets\s+/

function windowKind(label: string): DriverQuotaWindow['kind'] {
  if (/^current session$/i.test(label)) return 'session'
  if (/^current week \(all models\)$/i.test(label)) return 'week'
  if (/^current week \(.+\)$/i.test(label)) return 'week-model'
  return 'unknown'
}

/**
 * Parse Claude Code's `/usage` readout (#521).
 *
 * The agent prints prose, so this is a text parse and a reworded readout is a
 * real failure mode. It fails to `unrecognized` rather than to an empty reading:
 * a silent zero would read as "nothing used" and let a consumption limit run the
 * account dry.
 */
export function parseQuotaReadout(text: string): DriverQuota {
  const windows: DriverQuotaWindow[] = []
  for (const line of text.split('\n')) {
    const match = WINDOW_LINE.exec(line.trim())
    if (!match) continue
    const [, label, percent, resets] = match
    if (label === undefined || percent === undefined) continue
    const resetsAtText = resets?.replace(RESETS_PREFIX, '').trim()
    windows.push({
      label,
      kind: windowKind(label),
      percentUsed: Number(percent),
      ...(resetsAtText ? { resetsAtText } : {}),
    })
  }

  if (windows.length > 0) return { available: true, windows }
  return { available: false, reason: COST_READOUT.test(text) ? 'no-subscription' : 'unrecognized' }
}

/** Options for {@link readClaudeQuota}. */
export interface ReadClaudeQuotaOptions {
  /** CLI binary to spawn. Default `"claude"` (resolved on `PATH`). */
  bin?: string
  /** Working directory for the child. The read is account-wide, so this is incidental. */
  cwd?: string
  /** Environment for the child process. Default `process.env`. */
  env?: NodeJS.ProcessEnv
  /** `spawn` override for tests. Default `node:child_process.spawn`. */
  spawn?: SpawnLike
  /** Stop waiting: this caller is answered `timeout`, and the read goes on for whoever else asked, its timeout bounding it. */
  signal?: AbortSignal
  /** Override the timeout. Default {@link READ_TIMEOUT_MS}. */
  timeoutMs?: number
  /**
   * Where the read is shared with the other processes on this computer: the file a reading is kept
   * in for everyone, beside the lock that has one of them read at a time. The person's own
   * ({@link claudeUsagePath}) with the real CLI; none with a `spawn` of a test's own, unless given.
   */
  keptIn?: string
}

/** The reads this process is making, by the `spawn` they start and the login they read: whoever asks during one is answered by it. */
const readsNow = new WeakMap<SpawnLike, Map<string, Promise<DriverQuota>>>()

/**
 * Ask Claude Code where the account's subscription quota stands (#521).
 *
 * Runs the CLI's own `/usage` command in print mode. Costs nothing: verified on
 * 2.1.210 as `total_cost_usd: 0` across zero turns and zero tokens, because the
 * CLI answers it locally rather than by prompting a model. It reaches Anthropic
 * itself, with its own credentials, so the caller never reads or handles the
 * user's token.
 *
 * Never pass `--bare` here: it pins the CLI to API-key auth and never reads the
 * OAuth credentials, so the subscription quota this reads would vanish.
 *
 * Read once for everyone who asks at the same moment: each read starts the whole CLI, its MCP
 * servers with it, and Claude Code refuses `/usage` asked too often, for minutes, whoever asks.
 * Whoever asks in this process while a read of the same login goes on is answered by it; across
 * this computer's processes one reads at a time, and whoever waited for it is answered what it
 * read ({@link readOnComputer}).
 */
export function readClaudeQuota(opts: ReadClaudeQuotaOptions = {}): Promise<DriverQuota> {
  if (opts.signal?.aborted) return Promise.resolve({ available: false, reason: 'timeout' })
  const spawn = opts.spawn ?? (nodeSpawn as unknown as SpawnLike)
  const env = opts.env ?? process.env
  const reads = readsNow.get(spawn) ?? new Map<string, Promise<DriverQuota>>()
  readsNow.set(spawn, reads)
  const login = loginOf(opts.bin ?? 'claude', env)
  let read = reads.get(login)
  if (!read) {
    const keptIn = opts.keptIn ?? (opts.spawn ? undefined : claudeUsagePath(env))
    const once = (): Promise<DriverQuota> => spawnUsage(spawn, opts, env)
    read = (keptIn === undefined ? once() : readOnComputer(once, keptIn)).finally(() => reads.delete(login))
    reads.set(login, read)
  }
  return opts.signal ? untilAborted(read, opts.signal) : read
}

/** Which login a read reads, as two reads are told apart: the CLI, and what in its environment picks the login (one handed in, else its own folder's). */
function loginOf(bin: string, env: NodeJS.ProcessEnv): string {
  return JSON.stringify([bin, ...[...CLAUDE_ENV_LOGINS, 'CLAUDE_CONFIG_DIR', 'HOME'].map(name => env[name] ?? '')])
}

/** `read`'s answer, or `timeout` the moment `signal` aborts. */
function untilAborted(read: Promise<DriverQuota>, signal: AbortSignal): Promise<DriverQuota> {
  return new Promise<DriverQuota>(resolve => {
    const onAbort = (): void => resolve({ available: false, reason: 'timeout' })
    signal.addEventListener('abort', onAbort, { once: true })
    void read.then(quota => {
      signal.removeEventListener('abort', onAbort)
      resolve(quota)
    })
  })
}

/** One `claude -p /usage`, its answer read. */
function spawnUsage(spawn: SpawnLike, opts: ReadClaudeQuotaOptions, env: NodeJS.ProcessEnv): Promise<DriverQuota> {
  return new Promise<DriverQuota>(resolvePromise => {
    const child = spawn(opts.bin ?? 'claude', ['-p', '/usage', '--output-format', 'json'], { cwd: opts.cwd ?? process.cwd(), env })

    let settled = false
    // Raw bytes, decoded once at the end: a per-chunk `String(chunk)` corrupts a multibyte
    // UTF-8 codepoint split across two chunks (the readout's `·` is one), and a corrupted
    // readout parses as 'unrecognized' instead of the real quota.
    const chunks: Buffer[] = []
    const settle = (quota: DriverQuota) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(quota)
    }

    // Deliberately not unref'd: this timer is the only thing guaranteeing the
    // promise settles, and an unref'd one never fires once the loop goes idle,
    // leaving the caller awaiting forever. `settle` clears it either way.
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      settle({ available: false, reason: 'timeout' })
    }, opts.timeoutMs ?? READ_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    // ENOENT lands here rather than as a non-zero exit.
    child.on('error', () => settle({ available: false, reason: 'agent-not-found' }))
    child.on('close', code => {
      if (code !== 0) {
        settle({ available: false, reason: 'fetch-failed' })
        return
      }
      settle(parseQuotaResponse(Buffer.concat(chunks).toString('utf8')))
    })
  })
}

/** Unwrap the CLI's `--output-format json` envelope and parse the readout inside it. */
function parseQuotaResponse(stdout: string): DriverQuota {
  let envelope: unknown
  try {
    envelope = JSON.parse(stdout)
  } catch {
    return { available: false, reason: 'unrecognized' }
  }
  if (typeof envelope !== 'object' || envelope === null) return { available: false, reason: 'unrecognized' }
  const obj = envelope as Record<string, unknown>
  // The CLI's own failure arm, e.g. its usage fetch was refused upstream.
  if (obj['is_error'] === true) return { available: false, reason: 'fetch-failed' }
  const result = obj['result']
  if (typeof result !== 'string') return { available: false, reason: 'unrecognized' }
  return parseQuotaReadout(result)
}

/**
 * A read no other process on this computer makes at the same moment. It holds the lock beside
 * `keptIn` while it reads, and keeps what it read there ({@link keepClaudeReading}); whoever finds
 * the lock held waits for that read and is answered what it kept. A good reading answers whoever
 * asks within {@link SAME_MOMENT_MS} of it too; a failed one only whoever waited for it, so a
 * failure is never kept past the moment. A lock whose read died or hung is taken over, and where
 * no lock can be made (a folder this user cannot write) the read goes on alone.
 */
async function readOnComputer(read: () => Promise<DriverQuota>, keptIn: string): Promise<DriverQuota> {
  const asked = Date.now()
  const lock = `${keptIn}.lock`
  for (;;) {
    const answered = answerFor(keptIn, asked)
    if (answered) return answered
    const lockState = takeLock(lock)
    if (lockState === 'held') {
      await new Promise(resolve => setTimeout(resolve, WAIT_STEP_MS))
      continue
    }
    try {
      // A read that ended between the look above and the lock kept its answer.
      const ended = answerFor(keptIn, asked)
      if (ended) return ended
      const quota = await read()
      keepClaudeReading(quota, keptIn)
      return quota
    } finally {
      if (lockState === 'taken') rmSync(lock, { force: true })
    }
  }
}

/** What answers an ask made at `asked`: a good reading kept within the same moment, or the failure of a read it waited for. */
function answerFor(keptIn: string, asked: number): DriverQuota | undefined {
  const { good, failed } = readKept(keptIn)
  if (good && good.at >= asked - SAME_MOMENT_MS) return good.quota
  if (failed && failed.at > asked) return failed.quota
  return undefined
}

/** Take the read's lock: `taken`; `held` by a read going on now; `none` where no lock can be made, and the read goes on without. */
function takeLock(lock: string): 'taken' | 'held' | 'none' {
  for (let tries = 0; tries < 2; tries++) {
    try {
      mkdirSync(dirname(lock), { recursive: true })
      writeFileSync(lock, `${process.pid}\n`, { flag: 'wx', mode: 0o600 })
      return 'taken'
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return 'none'
    }
    if (lockHeld(lock)) return 'held'
    // Left by a read that died or hung: taken over.
    try {
      rmSync(lock, { force: true })
    } catch {
      return 'none'
    }
  }
  return 'held'
}

/** Whether a read holds `lock` now: its process alive, and the lock no older than {@link LOCK_HELD_MS}. */
function lockHeld(lock: string): boolean {
  try {
    if (Date.now() - statSync(lock).mtimeMs > LOCK_HELD_MS) return false
    const pid = Number.parseInt(readFileSync(lock, 'utf8'), 10)
    // No pid yet: the lock is being taken this instant.
    return Number.isNaN(pid) || isPidAlive(pid)
  } catch {
    // Gone since it was found: nobody holds it.
    return false
  }
}

/** The reading of the person's own login kept for everyone on this computer: `$XDG_CONFIG_HOME/openagent-claude-usage.json`, else dotted under the home. */
export function claudeUsagePath(env: NodeJS.ProcessEnv = process.env): string {
  return configFile('openagent-claude-usage.json', env)
}

/** One read as it is kept: when it ended, and what it said. */
interface KeptRead {
  at: number
  quota: DriverQuota
}

/** What is kept: the last good reading, and the last read beside it when that one failed. */
interface Kept {
  good?: KeptRead & { quota: { available: true } }
  failed?: KeptRead
}

/** What is kept at `path`; nothing of a file that is not there or does not read. */
function readKept(path: string): Kept {
  try {
    const kept = JSON.parse(readFileSync(path, 'utf8')) as { good?: Partial<KeptRead>; failed?: Partial<KeptRead> }
    const read = (entry: Partial<KeptRead> | undefined): KeptRead | undefined =>
      typeof entry?.at === 'number' && typeof entry.quota === 'object' && entry.quota !== null && typeof entry.quota.available === 'boolean' ? { at: entry.at, quota: entry.quota } : undefined
    const good = read(kept.good)
    const failed = read(kept.failed)
    return {
      ...(good?.quota.available && Array.isArray(good.quota.windows) ? { good: { at: good.at, quota: good.quota } } : {}),
      ...(failed && !failed.quota.available ? { failed } : {}),
    }
  } catch {
    return {}
  }
}

/**
 * Keep a read at `path` for everyone on this computer: a good reading as the one that serves them,
 * a failed one beside the last good one, for whoever waited for that read alone. Written whole,
 * then moved over the old one; a file that cannot be written changes nothing, and the next one who
 * asks only asks again.
 */
export function keepClaudeReading(quota: DriverQuota, path: string, at: number = Date.now()): void {
  const good = quota.available ? { at, quota } : readKept(path).good
  const kept: Kept = { ...(good ? { good } : {}), ...(quota.available ? {} : { failed: { at, quota } }) }
  try {
    writePrivate(path, `${JSON.stringify(kept)}\n`)
  } catch {
    // Read again next time.
  }
}

/** The good reading kept at `path` while it is younger than `forMs` at `now`; none when there is none, it is older, or it says a time to come. */
export function keptClaudeReading(path: string, now: number, forMs: number): DriverQuota | undefined {
  const good = readKept(path).good
  return good && now >= good.at && now - good.at < forMs ? good.quota : undefined
}
