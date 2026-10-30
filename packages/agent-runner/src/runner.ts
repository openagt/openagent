import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeCli, type CliProbe, type Driver, type DriverReadiness, type PersonalSetup } from '@openagt/agent-driver'
import { ClaudeCodeDriver, claudeCodeReady } from '@openagt/agent-driver-claude'
import { CodexDriver, codexReady } from '@openagt/agent-driver-codex'
import { findRun } from '@openagt/skill-logs'
import { readPersonal, readProjectAccounts } from './config.js'
import { gitHostEnv } from './git-host.js'
import { resumeRun, runCommand, runIdFrom, type RunOutcome } from './run.js'
import { publishChange, type NO_PUBLISH, type Publish } from './records.js'
import { acquireRunLock, handOverRunLock, isPidAlive, releaseRunLock, runStderrPath } from './run-lock.js'
import { accountRotation, hasAddedAccount } from '@openagt/skill-account-rotation'

/**
 * The tool's process side: a run in this process, the same run detached in its own process and
 * answered at once, a resume either way, and whether a run can start here at all. State in files
 * throughout; nothing waits in memory.
 */

/** This package's executable, for the processes it spawns: the bin beside `dist/`. */
const BIN = fileURLToPath(new URL('../bin/agent-runner', import.meta.url))

/** The environment name the tickets skill reads the claiming agent's id from. */
export const AGENT_ID_ENV = 'AGENT_ID'

/** The coding agents a run can be on, by the name the run's record carries. */
export const DRIVER_NAMES = ['claude-code', 'codex'] as const
export type DriverName = (typeof DRIVER_NAMES)[number]

export function isDriverName(name: string): name is DriverName {
  return (DRIVER_NAMES as readonly string[]).includes(name)
}

/**
 * Whether a run on `driver` can start on this machine, asked before it spends a checkout: the
 * coding agent's CLI is installed and logged in (a problem when not: the session would die
 * before its first turn). Warnings: running as root, and on Codex, skills in `~/.agents/skills`
 * it cannot keep out and `memory` on that does nothing while `skills` is off. What a dashboard's check hook runs, and what a
 * person's run and a scheduler's tick refuse on. The git host is asked only when the project names
 * its own account there (`accounts:` in the config), whether that account can be used: a project
 * with no git host package runs fine, and one whose git host cannot answer says so in the run's own log.
 */
export async function readyToRun(repo: string, driver: DriverName, deps: { probe?: CliProbe; isRoot?: () => boolean; agentsSkills?: string; gitHostEnv?: typeof gitHostEnv } = {}): Promise<DriverReadiness> {
  const opts = { probe: deps.probe ?? probeCli, ...(deps.isRoot ? { isRoot: deps.isRoot } : {}) }
  // An added account is a login runs use: a server with only the person's own computers' logins runs on them.
  const ready = await (driver === 'claude-code' ? claudeCodeReady({ ...opts, addedAccount: hasAddedAccount('claude') }) : codexReady({ ...opts, addedAccount: hasAddedAccount('codex'), personal: await readPersonal(repo, () => {}), ...(deps.agentsSkills !== undefined ? { agentsSkills: deps.agentsSkills } : {}) }))
  // The project's own account at the git host, when it names one: a run never works as someone else.
  const user = (await readProjectAccounts(repo, () => {})).gitHost
  if (user !== undefined) {
    const given = await (deps.gitHostEnv ?? gitHostEnv)(repo, user)
    if (!given.ok) ready.problems.push(`This project's runs work as ${user} at the git host, and it cannot be used here: ${given.error}`)
  }
  return ready
}

/**
 * The accounts this run works as: at the git host, the project's own or else the computer's, its
 * environment set on this process, which is the run's own (the CLI's `run`), so the agent and
 * every git push of the run go as that account, and nothing of the person's own settings changes;
 * and the Claude and Codex accounts the project names, if it names some.
 */
export async function workAs(repo: string, log: (line: string) => void, deps: { gitHostEnv?: typeof gitHostEnv; env?: NodeJS.ProcessEnv } = {}): Promise<AgentAccounts> {
  const accounts = await readProjectAccounts(repo, log)
  const given = await (deps.gitHostEnv ?? gitHostEnv)(repo, accounts.gitHost)
  if (!given.ok) throw new Error(`This project's runs work as ${accounts.gitHost} at the git host, and it cannot be used here: ${given.error}`)
  Object.assign(deps.env ?? process.env, given.env)
  return { ...(accounts.claude ? { claude: accounts.claude } : {}), ...(accounts.codex ? { codex: accounts.codex } : {}) }
}

/** The accounts a project's runs may use on each agent, by name, when it names its own few. */
export interface AgentAccounts {
  claude?: string[]
  codex?: string[]
}

/** The command line of a spawned run: the model, the coding agent, the follow-up, the publish level, the attached text, the parent, the base, the branch and what it is for named only when the run has them, so the run's own defaults apply otherwise. */
export function runArgs(run: SpawnedRun): string[] {
  const args = ['run', run.prompt, '--id', run.id]
  if (run.startedAt !== undefined) args.push('--started', run.startedAt)
  if (run.mark) args.push('--mark')
  if (run.model !== undefined) args.push('--model', run.model)
  if (run.effort !== undefined) args.push('--effort', run.effort)
  if (run.driver !== undefined) args.push('--driver', run.driver)
  if (run.then !== undefined) args.push('--then', run.then)
  if (run.publish !== undefined) args.push('--publish', run.publish)
  // One argument, flag and text: a text that opens with a dash would read as a flag of its own.
  if (run.attached !== undefined) args.push(`--attach=${run.attached}`)
  if (run.parent !== undefined) args.push('--parent', run.parent)
  if (run.base !== undefined) args.push('--base', run.base)
  if (run.branch !== undefined) args.push('--branch', run.branch)
  if (run.for !== undefined) args.push('--for', run.for)
  return args
}

/** A run spawned in its own process, its marker already on the branch unless it is to write it itself. */
export interface SpawnedRun {
  id: string
  prompt: string
  /** When the run was asked for (`run --started`), ISO: the start on its marker, kept as its record's start. */
  startedAt?: string
  /** The run writes its own marker: a person's detached start, answered before the marker is pushed. */
  mark?: boolean
  model?: string
  /** How hard the model may think (`run --effort`); the agent's own default when absent. */
  effort?: string
  driver?: DriverName
  /** The follow-up's prompt (`run --then`); a person's start only. */
  then?: string
  /** How far the run publishes (`run --publish`): the level in force for a scheduler's run, the person's pick for a detached start. */
  publish?: Publish
  /** A text handed to the agent with the prompt (`run --attach`): what a scheduler's check found. */
  attached?: string
  /** The run this one is started for (`run --parent`). */
  parent?: string
  /** The branch this run's branch starts from (`run --base`). */
  base?: string
  /** The branch the run works on, one that exists (`run --branch`): a person's pull request's. */
  branch?: string
  /** What the run is started for (`run --for`): a thread on the git host, by its address. */
  for?: string
  /** The account it starts on, of its agent's, by name: put in its environment ({@link ACCOUNT_ENV}). */
  account?: string
}

/** A resume spawned in its own process: the text or the answer it continues with, and who resumes it, when that is a scheduler's row. */
export interface SpawnedResume {
  id: string
  text?: string
  answer?: string
  model?: string
  effort?: string
  /** Who resumes the run (`run --resume --by`), kept on its mark. */
  by?: string
  /** How far the run takes its work from here on (`run --resume --publish`): a level, or `nothing`; its record's level when absent. */
  publish?: Publish | typeof NO_PUBLISH
  /** The account it goes on with, of its agent's, by name: put in its environment ({@link ACCOUNT_ENV}). */
  account?: string
}

/** The command line of a spawned resume: the text as the argument, or the answer. */
export function resumeArgs(run: SpawnedResume): string[] {
  const args = ['run', '--resume', run.id]
  if (run.text !== undefined) args.push(run.text)
  if (run.answer !== undefined) args.push('--answer', run.answer)
  if (run.model !== undefined) args.push('--model', run.model)
  if (run.effort !== undefined) args.push('--effort', run.effort)
  if (run.by !== undefined) args.push('--by', run.by)
  if (run.publish !== undefined) args.push('--publish', run.publish)
  return args
}

/**
 * The run's process, detached from whoever started it: `agent-runner run <prompt> --id <id>`, its
 * stderr kept. The run's lock is taken here before the process exists and handed to it once it
 * does, so the sweep never finds the run with neither a lock nor a checkout while it boots.
 */
export async function spawnRun(repo: string, run: SpawnedRun): Promise<void> {
  await acquireRunLock(repo, run.id, { pid: process.pid, isAlive: isPidAlive })
  try {
    const child = await spawnDetached(repo, run.id, runArgs(run), run.account)
    await handOverRunLock(repo, run.id, process.pid, child)
  } catch (err) {
    await releaseRunLock(repo, run.id, process.pid)
    throw err
  }
}

/** A resumed run's process, detached the same way: `agent-runner run --resume <id> …`. */
export async function spawnResume(repo: string, run: SpawnedResume): Promise<void> {
  await spawnDetached(repo, run.id, resumeArgs(run), run.account)
}

/** Spawn a detached process of this tool for the run `id`; resolves with its pid once it is spawned. */
async function spawnDetached(repo: string, id: string, args: string[], account?: string): Promise<number> {
  const stderrPath = runStderrPath(repo, id)
  mkdirSync(dirname(stderrPath), { recursive: true })
  const fd = openSync(stderrPath, 'a')
  const child = spawn(process.execPath, [BIN, ...args], {
    cwd: repo,
    detached: true,
    stdio: ['ignore', 'ignore', fd],
    env: { ...process.env, [AGENT_ID_ENV]: id, ...(account !== undefined ? { [ACCOUNT_ENV]: account } : {}) },
  })
  closeSync(fd)
  child.unref()
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  return child.pid!
}

/**
 * A person's run, answered at once: the run's process spawned detached, the id returned. What a
 * dashboard's start hook runs: it needs the id back now, not when the agent ends. The run's process
 * writes its own marker: pushing it takes seconds, and the page waits on the id.
 */
export async function detachRun(
  repo: string,
  opts: { prompt: string; model?: string; effort?: string; driver?: DriverName; then?: string; publish?: Publish; attached?: string; parent?: string; base?: string; branch?: string; for?: string; now?: () => Date },
  deps: { spawn?: typeof spawnRun } = {},
): Promise<{ id: string; driver: DriverName; model?: string }> {
  const now = opts.now ?? (() => new Date())
  const id = runIdFrom(now().toISOString())
  const driver = opts.driver ?? 'claude-code'
  const model = opts.model
  const named = { ...(opts.then !== undefined ? { then: opts.then } : {}), ...(opts.publish !== undefined ? { publish: opts.publish } : {}), ...(opts.attached !== undefined ? { attached: opts.attached } : {}), ...(opts.parent !== undefined ? { parent: opts.parent } : {}), ...(opts.base !== undefined ? { base: opts.base } : {}), ...(opts.branch !== undefined ? { branch: opts.branch } : {}), ...(opts.for !== undefined ? { for: opts.for } : {}) }
  await (deps.spawn ?? spawnRun)(repo, { id, prompt: opts.prompt, mark: true, driver, ...(model !== undefined ? { model } : {}), ...(opts.effort !== undefined ? { effort: opts.effort } : {}), ...named })
  return { id, driver, ...(model !== undefined ? { model } : {}) }
}

/**
 * An ended run continued in its own process, and answered at once: what a dashboard's resume
 * hook runs. A run this project has no record of is refused here, while someone is still
 * listening; everything after is the resumed run's own record.
 */
export async function detachResume(
  repo: string,
  opts: SpawnedResume,
  deps: { spawn?: typeof spawnResume } = {},
): Promise<{ id: string }> {
  if (!(await findRun(repo, opts.id))) throw new Error(`no run ${opts.id} in this project`)
  await (deps.spawn ?? spawnResume)(repo, opts)
  return { id: opts.id }
}

/**
 * A run of the real project, in this process, on the coding agent named (Claude Code when none is). A
 * scheduler's run comes with its id and its marker already on the branch; a person's run mints its
 * id here and marks itself. A follow-up it names runs on the same coding agent. The model is the
 * one given; none given, the coding agent starts on its own default. A parent it names that has
 * ended by the time this run ends is continued in a process of its own.
 */
export async function runProject(repo: string, opts: { prompt: string; id?: string; startedAt?: string; mark?: boolean; model?: string; effort?: string; driver?: DriverName; then?: string; publish?: Publish; attached?: string; parent?: string; base?: string; branch?: string; for?: string; log?: (line: string) => void }): Promise<RunOutcome> {
  const id = opts.id ?? runIdFrom(new Date().toISOString())
  const driver = opts.driver ?? 'claude-code'
  const setup = await readPersonal(repo, opts.log ?? (() => {}))
  const as = await workAs(repo, opts.log ?? (() => {}))
  return runCommand(repo, {
    prompt: opts.prompt,
    id,
    ...(opts.startedAt !== undefined ? { startedAt: opts.startedAt } : {}),
    // A run given its id was marked by whoever spawned it, unless it was told to mark itself.
    marked: opts.id !== undefined && opts.mark !== true,
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
    driver: driverFor(driver, id, setup, as),
    ...(opts.then !== undefined ? { then: opts.then, nextDriver: (next: string) => driverFor(driver, next, setup, as) } : {}),
    ...(opts.publish !== undefined ? { publish: opts.publish } : {}),
    ...(opts.attached !== undefined ? { attached: opts.attached } : {}),
    ...(opts.parent !== undefined ? { parent: opts.parent } : {}),
    ...(opts.base !== undefined ? { base: opts.base } : {}),
    ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
    ...(opts.for !== undefined ? { for: opts.for } : {}),
    resume: resumeDetached(repo),
    ...(opts.log ? { log: opts.log } : {}),
  })
}

/** How a run's ended parent is continued: in a process of its own, with the line it is told. */
export function resumeDetached(repo: string): (id: string, line: { text: string } | { answer: string }) => Promise<void> {
  return (id, line) => spawnResume(repo, { id, ...line })
}

/**
 * Continue an ended run of the real project, in this process: the user's text, or the answer to
 * the question it ended on. The coding agent is the one the run's record names: the session
 * to resume is its own.
 */
export async function resumeProject(
  repo: string,
  opts: SpawnedResume & { log?: (line: string) => void },
  deps: { driverFor?: typeof driverFor } = {},
): Promise<RunOutcome> {
  const card = await findRun(repo, opts.id)
  const recorded = card?.driver ?? 'claude-code'
  if (!isDriverName(recorded)) throw new Error(`run ${opts.id} is on ${recorded}, which agent-runner cannot start`)
  const setup = await readPersonal(repo, opts.log ?? (() => {}))
  const as = await workAs(repo, opts.log ?? (() => {}))
  return resumeRun(repo, {
    id: opts.id,
    ...(opts.text !== undefined ? { text: opts.text } : {}),
    ...(opts.answer !== undefined ? { answer: opts.answer } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
    ...(opts.by !== undefined ? { by: opts.by } : {}),
    ...(opts.publish !== undefined ? { publish: publishChange(opts.publish) ?? null } : {}),
    driver: (deps.driverFor ?? driverFor)(recorded, opts.id, setup, as),
    nextDriver: next => (deps.driverFor ?? driverFor)(recorded, next, setup, as),
    resume: resumeDetached(repo),
    ...(opts.log ? { log: opts.log } : {}),
  })
}

/** The account a run starts on, of the agent it runs on, by name, when whoever started it picked one: a scheduler's pick. */
export const ACCOUNT_ENV = 'OPENAGENT_ACCOUNT'

/**
 * The coding agent a run is on, unrestricted either way: Claude Code with permissions bypassed, Codex
 * with full access. The run's agent, when asked to publish, pushes its branch and opens its pull request itself, which
 * Codex's default sandbox (the workspace only) does not allow. The run's id is in the agent's
 * environment, so the claim it makes names the run (the tickets skill reads `AGENT_ID`).
 *
 * The coding agent starts with the person's own setup, as when started by hand, less the parts
 * this machine's config turns off (`personal:` in `config.ts`). How a part is turned off is the
 * adapter's own business.
 */
export function driverFor(name: DriverName, id: string, personal: PersonalSetup, as: AgentAccounts = {}): Driver {
  const env: NodeJS.ProcessEnv = { ...process.env, [AGENT_ID_ENV]: id }
  // On the person's accounts of the agent, or the project's own few, the next free one taking over at a limit; the one to start on, when whoever started the run said.
  const prefer = env[ACCOUNT_ENV]?.trim()
  const accounts = (only: string[] | undefined) => ({ ...(prefer ? { prefer } : {}), ...(only ? { only } : {}) })
  switch (name) {
    case 'claude-code':
      return new ClaudeCodeDriver({ permissionMode: 'bypassPermissions', env, personal, accounts: accountRotation('claude', accounts(as.claude)) })
    case 'codex':
      return new CodexDriver({ sandbox: 'danger-full-access', env, personal, accounts: accountRotation('codex', accounts(as.codex)) })
  }
}
