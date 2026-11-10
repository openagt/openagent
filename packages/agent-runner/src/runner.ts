import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeCli, type CliProbe, type Driver, type DriverReadiness, type PersonalSetup } from '@openagt/agent-driver'
import { ClaudeCodeDriver, claudeCodeReady } from '@openagt/agent-driver-claude'
import { CodexDriver, codexReady } from '@openagt/agent-driver-codex'
import { findRun } from '@openagt/skill-logs'
import { readPersonal } from './config.js'
import { runAgent, type SkillPicks } from './agent.js'
import { basicSkills } from './basic-skills.js'
import { gitHostCommand, gitHostEnv } from './git-host.js'
import { namedAtStart, resumeRun, runCommand, runIdFrom, type RunOutcome, type RunRequest } from './run.js'
import { askName } from './title.js'
import { publishChange, runnerMark, type NO_PUBLISH, type Publish } from './records.js'
import { acquireRunLock, handOverRunLock, isPidAlive, releaseRunLock, runStderrPath } from './run-lock.js'
import { accountRotation, accountsPath, hasAddedAccount, readAccounts } from '@openagt/skill-account-rotation'
import { AGENT_ID_ENV, type AgentRecord } from '@openagt/agent-data'

/**
 * The tool's process side: a run in this process, the same run detached in its own process and
 * answered at once, a resume either way, and whether a run can start here at all. State in files
 * throughout; nothing waits in memory.
 */

/** This package's executable, for the processes it spawns: the bin beside `dist/`. */
const BIN = fileURLToPath(new URL('../bin/agent-runner', import.meta.url))

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
 * person's run and a scheduler's tick refuse on. The git host is asked whether the account runs
 * work as there can be used, `login` when one is named: a project with no git host package runs
 * fine, and one with no account there is refused.
 */
export async function readyToRun(repo: string, driver: DriverName, deps: { probe?: CliProbe; isRoot?: () => boolean; agentsSkills?: string; gitHostEnv?: typeof gitHostEnv; login?: string } = {}): Promise<DriverReadiness> {
  const opts = { probe: deps.probe ?? probeCli, ...(deps.isRoot ? { isRoot: deps.isRoot } : {}) }
  // An added account is a login runs use: a server with only the person's own computers' logins runs on them.
  const ready = await (driver === 'claude-code' ? claudeCodeReady({ ...opts, addedAccount: hasAddedAccount('claude') }) : codexReady({ ...opts, addedAccount: hasAddedAccount('codex'), personal: await readPersonal(repo, () => {}), ...(deps.agentsSkills !== undefined ? { agentsSkills: deps.agentsSkills } : {}) }))
  const given = await (deps.gitHostEnv ?? gitHostEnv)(repo, deps.login)
  if (!given.ok) ready.problems.push(deps.login !== undefined ? cannotWorkAs(deps.login, given.error) : given.error)
  return ready
}

/** Why a run cannot go as `login` at the git host, on this computer. */
function cannotWorkAs(login: string, error: string): string {
  return `This session works as @${login} at the git host, and it cannot be used here: ${error}`
}

/**
 * The account this run works as at the git host: `login`, the one picked for this session, or
 * else the computer's. Its environment is set on this process, which is the run's own (the CLI's
 * `run`), so the agent and every git push of the run go as that account, and nothing of the
 * person's own settings changes. The login, when the git host can say; an account this computer
 * cannot use is a refusal naming it, never a run as someone else.
 */
export async function workAs(repo: string, login: string | undefined, deps: { gitHostEnv?: typeof gitHostEnv; env?: NodeJS.ProcessEnv } = {}): Promise<string | undefined> {
  const given = await (deps.gitHostEnv ?? gitHostEnv)(repo, login)
  if (!given.ok) throw new Error(login !== undefined ? cannotWorkAs(login, given.error) : given.error)
  Object.assign(deps.env ?? process.env, given.env)
  return given.login
}

/** The command line of a spawned run: the model, the coding agent, the publish level, the attached text, the parent, the base, the pull request's base, the branch and what it is for named only when the run has them, so the run's own defaults apply otherwise. */
export function runArgs(run: SpawnedRun): string[] {
  const args = ['run', run.prompt, '--id', run.id]
  if (run.startedAt !== undefined) args.push('--started', run.startedAt)
  if (run.mark) args.push('--mark')
  if (run.model !== undefined) args.push('--model', run.model)
  if (run.effort !== undefined) args.push('--effort', run.effort)
  if (run.driver !== undefined) args.push('--driver', run.driver)
  if (run.publish !== undefined) args.push('--publish', run.publish)
  // One argument, flag and text: a text that opens with a dash would read as a flag of its own.
  if (run.attached !== undefined) args.push(`--attach=${run.attached}`)
  if (run.parent !== undefined) args.push('--parent', run.parent)
  if (run.base !== undefined) args.push('--base', run.base)
  if (run.prBase !== undefined) args.push('--pr-base', run.prBase)
  if (run.branch !== undefined) args.push('--branch', run.branch)
  if (run.for !== undefined) args.push('--for', run.for)
  // One argument, the folders one per line: the process reads them as the start did.
  if (run.repos !== undefined && run.repos.length > 0) args.push(`--repos=${run.repos.map(repo => repo.from).join('\n')}`)
  return args
}

/** A run spawned in its own process, its marker already on the branch unless it is to write it itself. */
export interface SpawnedRun extends RunRequest {
  id: string
  /** When the run was asked for (`run --started`), ISO: the start on its marker, kept as its record's start. */
  startedAt?: string
  /** The run writes its own marker: a person's detached start, answered before the marker is pushed. */
  mark?: boolean
  driver?: DriverName
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
  opts: RunRequest & { driver?: DriverName; now?: () => Date },
  deps: { spawn?: typeof spawnRun } = {},
): Promise<{ id: string; driver: DriverName; model?: string }> {
  const { now = () => new Date(), driver = 'claude-code', ...request } = opts
  const id = runIdFrom(now().toISOString())
  await (deps.spawn ?? spawnRun)(repo, { ...request, id, mark: true, driver })
  return { id, driver, ...(request.model !== undefined ? { model: request.model } : {}) }
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

/** A run of the real project in this process, as the command line starts one: what it is asked, and what the command read off its flags and its environment. */
export interface ProjectRun extends RunRequest {
  /** The run's id, from whoever spawned it with its marker written; minted here when absent. */
  id?: string
  /** When the run was asked for (`run --started`), ISO; this process's clock when absent. */
  startedAt?: string
  /** A run given its id that writes its own marker all the same (`run --mark`): a person's detached start. */
  mark?: boolean
  /** The coding agent; Claude Code when absent. */
  driver?: DriverName
  /** The account at the git host picked for this session ({@link GIT_ACCOUNT_ENV}); its agent's, else the computer's, when absent. */
  gitAccount?: string
  /** The agent the run is on, by its id; the default agent when absent. */
  agent?: string
  /** The session's picks of skills. */
  skills?: SkillPicks
  log?: (line: string) => void
}

/**
 * A run of the real project, in this process, on the coding agent named (Claude Code when none is). A
 * scheduler's run comes with its id and its marker already on the branch; a person's run mints its
 * id here and marks itself. The model is the
 * one given; none given, the coding agent starts on its own default. A parent it names that has
 * ended by the time this run ends is continued in a process of its own.
 */
export async function runProject(repo: string, opts: ProjectRun, deps: { workAs?: typeof workAs } = {}): Promise<RunOutcome> {
  // What the run is asked, its start, its agent and its log go on to it as they are; the rest is read here.
  const { id: given, mark, driver = 'claude-code', gitAccount, skills: picks = {}, ...rest } = opts
  const id = given ?? runIdFrom(new Date().toISOString())
  const log = rest.log ?? (() => {})
  const setup = await readPersonal(repo, log)
  // The agent the run is on: its skills, with the session's picks, go into the checkout; its accounts are the run's unless the session picked one.
  const on = await runAgent(rest.agent, log)
  const accounts = accountsOn(on)
  // A run given its id was marked by whoever spawned it, unless it was told to mark itself.
  const marked = given !== undefined && mark !== true
  // The name is asked for before the git host's account is read, which takes a second or more
  // (`gitHostEnv` runs the git host's command) and is nothing the small model naming the run needs.
  const naming = namedAtStart({ ...rest, marked }) ? askName(driverFor(driver, undefined, setup, accounts), rest.prompt) : undefined
  const as = await (deps.workAs ?? workAs)(repo, gitAccount ?? (await agentLoginFor(repo, on)))
  return runCommand(repo, {
    ...rest,
    ...(naming !== undefined ? { naming } : {}),
    id,
    marked,
    driver: driverFor(driver, id, setup, accounts),
    skills: (where, agent) => basicSkills(where, agent, on, picks),
    ...(as !== undefined ? { gitAccount: as } : {}),
    ...(picks.on !== undefined ? { skillsOn: picks.on } : {}),
    ...(picks.off !== undefined ? { skillsOff: picks.off } : {}),
    ...(picks.project !== undefined ? { projectSkills: picks.project } : {}),
    resume: resumeDetached(repo),
  })
}

/** How a run's ended parent is continued: in a process of its own, with the line it is told. */
export function resumeDetached(repo: string): (id: string, line: { text: string } | { answer: string }) => Promise<void> {
  return (id, line) => spawnResume(repo, { id, ...line })
}

/**
 * Continue an ended run of the real project, in this process: the user's text, or the answer to
 * the question it ended on. The coding agent is the one the run's record names: the session
 * to resume is its own, and so is the account at the git host it worked as, when the record
 * names one; the computer's for a run recorded before that was kept.
 */
export async function resumeProject(
  repo: string,
  opts: SpawnedResume & { log?: (line: string) => void },
  deps: { driverFor?: typeof driverFor; workAs?: typeof workAs } = {},
): Promise<RunOutcome> {
  const card = await findRun(repo, opts.id)
  const recorded = card?.driver ?? 'claude-code'
  if (!isDriverName(recorded)) throw new Error(`run ${opts.id} is on ${recorded}, which agent-runner cannot start`)
  const log = opts.log ?? (() => {})
  const setup = await readPersonal(repo, log)
  const previous = card ? runnerMark(card) : undefined
  // The agent the record names, as it stands now: its skills again, with the session's picks, its accounts on this computer.
  const on = await runAgent(previous?.agent, log)
  const picks: SkillPicks = { ...(previous?.skillsOn !== undefined ? { on: previous.skillsOn } : {}), ...(previous?.skillsOff !== undefined ? { off: previous.skillsOff } : {}), ...(previous?.projectSkills !== undefined ? { project: previous.projectSkills } : {}) }
  const accounts = accountsOn(on)
  const as = await (deps.workAs ?? workAs)(repo, previous?.gitAccount)
  return resumeRun(repo, {
    id: opts.id,
    ...(opts.text !== undefined ? { text: opts.text } : {}),
    ...(opts.answer !== undefined ? { answer: opts.answer } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
    ...(opts.by !== undefined ? { by: opts.by } : {}),
    ...(opts.publish !== undefined ? { publish: publishChange(opts.publish) ?? null } : {}),
    driver: (deps.driverFor ?? driverFor)(recorded, opts.id, setup, accounts),
    skills: (where, agent) => basicSkills(where, agent, on, picks),
    ...(as !== undefined ? { gitAccount: as } : {}),
    resume: resumeDetached(repo),
    ...(opts.log ? { log: opts.log } : {}),
  })
}

/** The account a run starts on, of the agent it runs on, by name, when whoever started it picked one: a scheduler's pick. */
export const ACCOUNT_ENV = 'OPENAGENT_ACCOUNT'

/**
 * The account at the git host a run works as, by its login, when whoever started it picked one
 * for this session: a dashboard's pick beside the message box. In the environment, as the
 * dashboard's other settings for a run are, so no project's `start` line has to carry it.
 */
export const GIT_ACCOUNT_ENV = 'OPENAGENT_GIT_ACCOUNT'

/**
 * The login a run on `agent` works as at the git host, where the project has one: an agent's
 * account at GitHub means nothing in a session with no project, or in a project on another host,
 * and such a run goes as no account rather than refused. (A pick made for the session is another
 * matter: it was made among the host's accounts, and is asked for as it is.)
 */
export async function agentLoginFor(repo: string, agent: Pick<AgentRecord, 'accounts'>): Promise<string | undefined> {
  if (agent.accounts.github === undefined) return undefined
  return (await gitHostCommand(repo)) ? agent.accounts.github : undefined
}

/** The accounts of each coding agent a run may use, by name, when its agent names its own few. */
export interface AgentAccounts {
  claude?: string[]
  codex?: string[]
}

/**
 * The Claude and Codex accounts the run's agent names, those this computer has: an account named
 * on another computer applies only where it is. None of them here, or none named: every account
 * of the computer's.
 */
export function accountsOn(agent: Pick<AgentRecord, 'accounts'>, env: NodeJS.ProcessEnv = process.env): AgentAccounts {
  const here = (kind: 'claude' | 'codex', named: string[] | undefined): string[] | undefined => {
    if (!named) return undefined
    const have = new Set(readAccounts(accountsPath(kind, env)).map(account => account.name))
    const kept = named.filter(name => have.has(name))
    return kept.length > 0 ? kept : undefined
  }
  const claude = here('claude', agent.accounts.claude)
  const codex = here('codex', agent.accounts.codex)
  return { ...(claude ? { claude } : {}), ...(codex ? { codex } : {}) }
}

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
export function driverFor(name: DriverName, id: string | undefined, personal: PersonalSetup, as: AgentAccounts = {}): Driver {
  // Without an id, a driver for no run's agent: a session that only names one.
  const env: NodeJS.ProcessEnv = { ...process.env, ...(id !== undefined ? { [AGENT_ID_ENV]: id } : {}) }
  // On the person's accounts of the agent, or the few its own agent names, the next free one taking over at a limit; the one to start on, when whoever started the run said.
  const prefer = env[ACCOUNT_ENV]?.trim()
  const accounts = (only: string[] | undefined) => ({ ...(prefer ? { prefer } : {}), ...(only ? { only } : {}) })
  switch (name) {
    case 'claude-code':
      return new ClaudeCodeDriver({ permissionMode: 'bypassPermissions', env, personal, accounts: accountRotation('claude', accounts(as.claude)) })
    case 'codex':
      return new CodexDriver({ sandbox: 'danger-full-access', env, personal, accounts: accountRotation('codex', accounts(as.codex)) })
  }
}
