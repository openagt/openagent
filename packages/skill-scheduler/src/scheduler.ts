import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DriverQuota } from '@openagt/agent-driver'
import { readClaudeQuota } from '@openagt/agent-driver-claude'
import { accountFolder, personalCodexHome, readCodexUsage } from '@openagt/agent-driver-codex'
import { gitHostEnv, isPidAlive, lockHolder, readyToRun, resumeDetached, runIdFrom, spawnResume, spawnRun, sweep, withdrawMarker, writeMarker } from '@openagt/agent-runner'
import { findRun } from '@openagt/skill-logs'
import { nodeGitRunner, originUrl, pullProjectData, remoteHostOf, type GitRunner } from '@openagt/agent-data'
import { CHECK_TIMEOUT_MS, GLANCE_MS, NOW_CHECK_TIMEOUT_MS, QUOTA_KEPT_MS, SCHEDULER_LOG, TICK_MS } from './names.js'
import { inFlight, lastRuns, lastStart, type LastRun } from './records.js'
import { readSchedule, type Schedule, type ScheduledCommand, type Unlisted } from './schedule.js'
import { isSwitchedOn, listed, namesGivenUp, readState, stateDir, updateState, withoutListed, withoutName, withoutPid, type ListedCommand, type State, type TickRecord } from './state.js'
import { atStartOf } from './start-point.js'
import { glance, startNow, tick, type StartedNow, type TickDeps } from './tick.js'
import { runCheck } from './check.js'
import { accountsPath, readAccounts } from '@openagt/skill-account-rotation'

/**
 * `git`, its fetches going as the account runs use at the git host (`gitHostEnv`), never the
 * person's own login: with no account to go as, a fetch is refused, and the start point is this
 * clone's own copy, as offline. A remote that is a folder on this disk is fetched as it is.
 */
export function fetchingAsRunsAccount(repo: string, git: GitRunner, asAccount: (env: Record<string, string>) => GitRunner = nodeGitRunner): GitRunner {
  return async (args, cwd) => {
    if (args[0] !== 'fetch') return git(args, cwd)
    // A remote that is a folder on this disk asks no login.
    const url = await originUrl(cwd, git)
    if (!url || remoteHostOf(url) === undefined) return git(args, cwd)
    const account = await gitHostEnv(repo)
    if (!account.ok) throw new Error(account.error)
    if (!account.env['GIT_CONFIG_COUNT']) throw new Error('no account of OpenAgent\'s to fetch as')
    return asAccount(account.env)(args, cwd)
  }
}

/**
 * The tool's process side (#1774): a tick wired to the real project, and the scheduler's own small
 * process that ticks every minute between `start` and `stop`. A due command is a run of
 * `agent-runner`, spawned in its own process. State in files throughout; the process holds nothing
 * a restart would lose.
 */

/** This package's executable, for the scheduler's own process: the bin beside `dist/`. */
const BIN = fileURLToPath(new URL('../bin/scheduler', import.meta.url))

/**
 * Claude's quota for a project's ticks: a reading this process made less than {@link QUOTA_KEPT_MS}
 * ago is used again, so a run waited for starts seconds sooner. A reading that could not be made
 * is not kept: the next asks again.
 */
export function keepQuota(read: () => Promise<DriverQuota>, now: () => number = Date.now): () => Promise<DriverQuota> {
  let kept: { at: number; quota: DriverQuota } | undefined
  return async () => {
    if (kept && now() - kept.at < QUOTA_KEPT_MS) return kept.quota
    const quota = await read()
    kept = quota.available ? { at: now(), quota } : undefined
    return quota
  }
}

const quotaKeepers = new Map<string, () => Promise<DriverQuota>>()

/** This process's keeper of Claude's quota for the project. */
function keptQuota(repo: string): () => Promise<DriverQuota> {
  let keeper = quotaKeepers.get(repo)
  if (!keeper) quotaKeepers.set(repo, (keeper = keepQuota(() => readClaudeQuota({ cwd: repo }))))
  return keeper
}

/** What a tick of the real project is run with, where whoever runs it says: its git (node's, else), where its lines go (nowhere, else), and whether the scheduler was told to stop. */
interface Wiring {
  git?: GitRunner
  log?: (line: string) => void
  stopped?: () => boolean
}

/** A tick's hands on the real project: its records, its checks, which may run `checkMs` each, the coding agent, and a run of `agent-runner` per start. */
function projectDeps(repo: string, state: State, schedule: Schedule, checkMs: number, wiring: Wiring): TickDeps {
  const git = wiring.git ?? nodeGitRunner()
  const log = wiring.log ?? (() => {})
  const now = (): Date => new Date()
  const host = hostname()
  return {
    state,
    schedule,
    host,
    now,
    pull: () => pullProjectData(repo, { git, log }),
    sweep: () => sweep(repo, { host, isAlive: isPidAlive, now, git, log, resume: resumeDetached(repo) }),
    atStart: atStartOf(repo, fetchingAsRunsAccount(repo, git)),
    // As the account runs work as at the git host: never the person's own `gh`. With none, nothing is asked.
    check: async (shell, lastRun, switchedOn) => {
      const account = await gitHostEnv(repo)
      if (!account.ok) return { ok: false, stdout: '', stderr: account.error }
      return runCheck(repo, shell, checkMs, lastRun, switchedOn, account.env)
    },
    stillOn: async command => isSwitchedOn(await readState(repo), command),
    lastStart: command => lastStart(repo, command, schedule, host),
    inFlight: command => inFlight(repo, command, schedule, host),
    findRun: id => findRun(repo, id),
    busy: async id => (await lockHolder(repo, id, isPidAlive)) !== undefined,
    ready: agent => readyToRun(repo, agent),
    quota: keptQuota(repo),
    // All of the person's accounts on the agent.
    accounts: async agent => readAccounts(accountsPath(agent === 'codex' ? 'codex' : 'claude')),
    // The person's own Codex login from their own home; an added one from its folder, where its login is.
    codexUsage: account => readCodexUsage({ home: account.login === undefined ? personalCodexHome() : accountFolder(account) }),
    mint: () => runIdFrom(now().toISOString()),
    writeMarker: card => writeMarker(repo, card),
    withdrawMarker: id => withdrawMarker(repo, id),
    spawn: run => spawnRun(repo, run),
    resume: run => spawnResume(repo, run),
    ...(wiring.stopped ? { stopped: wiring.stopped } : {}),
    log,
  }
}

/**
 * Start one run of a scheduled command now, for a person who asked ({@link startNow}). It needs no
 * scheduler running: the run is started from here. Its check has less time than a tick gives one:
 * whoever asked waits for the answer.
 */
export async function runNow(repo: string, command: ScheduledCommand, wiring: Omit<Wiring, 'stopped'> = {}): Promise<StartedNow> {
  return startNow(projectDeps(repo, await readState(repo), await readSchedule(repo), NOW_CHECK_TIMEOUT_MS, wiring), command)
}

/** One tick of the real project, and the state written with what it decided. */
export async function tickProject(repo: string, wiring: Wiring = {}): Promise<TickRecord> {
  const schedule = await readSchedule(repo)
  const read = await readState(repo)
  // What an automation kept on this machine was given goes when it goes, and when a skill has its
  // name too: a switch left under the name would start the skill's command unasked.
  const givenUp = namesGivenUp(read.lastTick, schedule)
  const state = givenUp.length ? await updateState(repo, s => givenUp.reduce(withoutName, s), wiring.git) : read
  const decided = await tick(projectDeps(repo, state, schedule, CHECK_TIMEOUT_MS, wiring))
  let record = decided
  // A tick cut short by a stop records nothing: `stop` already took this scheduler off the state,
  // and a write now would put the state file back after a clean-up removed it.
  if (!wiring.stopped?.()) {
    // A command whose file went while the tick ran, removed by its person, is not on the record: what lists the record's commands would show it for another minute.
    // An automation kept on this machine that went so is given up here: off the record, the next tick would not know it had been listed.
    const there = new Set((await readSchedule(repo)).commands.map(c => c.name))
    const gone = decided.schedule.filter(c => !there.has(c.command))
    const written = await updateState(repo, s => gone.reduce<State>((state, c) => withoutListed(c.onThisMachine ? withoutName(state, c.command) : state, c.command), { ...s, lastTick: decided }), wiring.git)
    // What is answered and logged is the record as written.
    record = written.lastTick ?? decided
  }
  for (const line of describe(record)) wiring.log?.(line)
  return record
}

/**
 * Between the minute's ticks, the rows of the real project that may be checked more often and are
 * due again by `due`; what one of them started or resumed is a log line.
 */
async function glanceProject(repo: string, due: (command: ScheduledCommand) => boolean, wiring: Wiring): Promise<void> {
  const schedule = await readSchedule(repo)
  if (!schedule.commands.some(command => command.checkEvery)) return
  const decided = await glance(projectDeps(repo, await readState(repo), schedule, CHECK_TIMEOUT_MS, wiring), due)
  for (const decision of decided) if (decision.run !== undefined) wiring.log?.(`[scheduler] between ticks: ${decision.command}: ${decision.outcome}`)
}

/** `start`: the state on, and the scheduler's own process ticking until `stop`, unless this process is it. */
export async function startScheduler(repo: string, opts: { foreground?: boolean; everyMs?: number; keepAlive?: boolean; log?: (line: string) => void } = {}): Promise<State> {
  const state = await updateState(repo, s => ({ ...s, on: true, ...(opts.keepAlive !== undefined ? { keepAlive: opts.keepAlive } : {}) }))
  if (state.pid !== undefined && isPidAlive(state.pid) && state.pid !== process.pid) return state
  if (opts.foreground) {
    await loop(repo, opts.everyMs ?? TICK_MS, opts.log ?? (() => {}))
    return readState(repo)
  }
  const logPath = join(stateDir(repo), SCHEDULER_LOG)
  mkdirSync(stateDir(repo), { recursive: true })
  const fd = openSync(logPath, 'a')
  const child = spawn(process.execPath, [BIN, 'start', '--foreground'], { cwd: repo, detached: true, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  child.unref()
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  return updateState(repo, s => ({ ...s, pid: child.pid!, startedAt: new Date().toISOString() }))
}

/**
 * The scheduler's process: a tick now and every interval, until SIGINT or SIGTERM. The stop waits
 * for the tick in flight, which starts nothing more and records nothing once the stop is in, and
 * for no other: one that waited behind it does not run; and it
 * clears only this process's pid from the state, writing nothing when the state names another: a
 * dashboard's close hook stops this scheduler and its open hook starts the next one before this
 * tick is over, and that one's pid must stay.
 */
async function loop(repo: string, everyMs: number, log: (line: string) => void): Promise<void> {
  await updateState(repo, s => ({ ...s, pid: process.pid, startedAt: new Date().toISOString() }))
  let stopped = false
  let inflight: Promise<unknown> = Promise.resolve()
  // One tick waits at most: a tick that outlasts the interval (a slow pull, a check at its limit)
  // must not queue the minutes it missed behind it, which a stop would then have to wait out.
  let queued = false
  const once = (): void => {
    if (queued) return
    queued = true
    inflight = inflight
      .then(() => {
        queued = false
        return stopped ? undefined : tickProject(repo, { log, stopped: () => stopped })
      })
      .catch(err => log(`[scheduler] tick failed: ${err instanceof Error ? err.message : String(err)}`))
  }
  // Between ticks, the rows that may be checked more often, each when its own interval is over;
  // one look at a time, after the tick in flight, and none queued while one waits.
  const glanced = new Map<string, number>()
  const due = (command: ScheduledCommand): boolean => {
    const at = glanced.get(command.name)
    if (at !== undefined && Date.now() - at < command.checkEvery!.ms) return false
    glanced.set(command.name, Date.now())
    return true
  }
  let waiting = false
  const look = (): void => {
    if (waiting) return
    waiting = true
    inflight = inflight
      .then(() => {
        waiting = false
        return stopped ? undefined : glanceProject(repo, due, { log, stopped: () => stopped })
      })
      .catch(err => log(`[scheduler] look between ticks failed: ${err instanceof Error ? err.message : String(err)}`))
  }
  const timer = setInterval(once, everyMs)
  const glancer = setInterval(look, GLANCE_MS)
  once()
  await new Promise<void>(resolve => {
    const stop = (): void => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      clearInterval(glancer)
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await inflight
  // Written only when the state still names this process. After `stop` it does not, and a write
  // then would only put the state file back, after a clean-up may have removed it.
  if ((await readState(repo)).pid === process.pid) await updateState(repo, s => withoutPid(s, process.pid))
}

/**
 * `stop`: the state off, and the scheduler's process asked to stop. Agents in flight run to the end.
 * With `unlessKeepAlive`, a keep-alive scheduler is left as it is and the answer says `kept`: the
 * one reader of keep-alive, meant for the line a dashboard runs when it closes.
 */
export async function stopScheduler(repo: string, opts: { unlessKeepAlive?: boolean } = {}): Promise<State & { kept: boolean }> {
  const state = await readState(repo)
  if (opts.unlessKeepAlive && state.keepAlive) return { ...state, kept: true }
  if (state.pid !== undefined && isPidAlive(state.pid)) {
    try {
      process.kill(state.pid, 'SIGINT')
    } catch {
      // Gone between the probe and the signal.
    }
  }
  const stopped = await updateState(repo, s => {
    const { pid: _pid, startedAt: _startedAt, ...rest } = s
    return { ...rest, on: false }
  })
  return { ...stopped, kept: false }
}

/** A command as `status` lists it: what its file says, and its last run when it has one. */
export type StatusCommand = ListedCommand & { lastRun?: LastRun }

/** What `status` answers: the state, whether its process is alive, and the schedule as the project's files say it now. */
export type Status = State & { running: boolean; schedule: StatusCommand[]; unreadable: Unlisted[] }

/**
 * `status`: the state, whether its process is alive, and the schedule read now, each command with
 * its last run off the run records. Read from the files and the records, not off the last tick,
 * so a command saved, changed, removed or started a moment ago is listed as it stands, also where
 * no scheduler is running. Records that cannot be read list no last run and stop nothing.
 */
export async function schedulerStatus(repo: string): Promise<Status> {
  const [state, schedule] = await Promise.all([readState(repo), readSchedule(repo)])
  const last = await lastRuns(repo, schedule, hostname()).catch((): Record<string, LastRun> => ({}))
  return { ...state, running: state.pid !== undefined && isPidAlive(state.pid), schedule: schedule.commands.map((command): StatusCommand => ({ ...listed(command), ...(last[command.name] ? { lastRun: last[command.name]! } : {}) })), unreadable: schedule.unreadable }
}

function describe(record: TickRecord): string[] {
  const lines = [`[scheduler] tick ${record.at}${record.note ? `: ${record.note}` : ''}`]
  for (const d of record.decisions) lines.push(`[scheduler]   ${d.command}: ${d.outcome}`)
  return lines
}
