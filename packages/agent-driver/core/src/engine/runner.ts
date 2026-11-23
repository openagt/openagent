import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codingAgent } from '../agents.js'
import { findRun } from '../record-store.js'
import { createHooks, DISTRIBUTION_ENV, loadHandedDown, type DistributionEntry, type Driver, type DriverReadiness, type PersonalSetup, type Profile, type RunAgent } from '@openagt/hooks'
import { readPersonal } from './config.js'
import { runProfile, type SessionPicks } from './profile.js'
import { gitHostCommand, gitHostEnv } from './git-host.js'
import { namedAtStart, resumeRun, runCommand, runIdFrom, type RunOutcome, type RunRequest } from './run.js'
import { NAME_FILE_ENV, askName } from './title.js'
import { publishChange, runnerMark, type NO_PUBLISH, type Publish } from './records.js'
import { acquireRunLock, handOverRunLock, isPidAlive, releaseRunLock, runStderrPath } from './run-lock.js'
import { accountRotation } from '../accounts/rotation.js'
import { accountsPath, hasAddedAccount, readAccounts } from '../accounts/accounts.js'
import { AGENT_ID_ENV, PLUGINS_WITHOUT_ENV, PROFILE_ENV, PROJECT_SKILLS_ENV, sessionsHomeOf } from '@openagt/agent-data'

/**
 * The tool's process side: a run in this process, the same run detached in its own process and
 * answered at once, a resume either way, and whether a run can start here at all. State in files
 * throughout; nothing waits in memory.
 */

/** This package's executable, for the processes it spawns: the bin beside `dist/`. */
const BIN = fileURLToPath(new URL('../../bin/agent-runner', import.meta.url))

/**
 * Whether a run on the coding agent `driver` (the distribution's first when none is named) can
 * start on this machine, asked before it spends a checkout: what the agent says stands in the way
 * (its CLI missing or logged out: the session would die before its first turn) and warns of. What
 * this computer's host checks before a Start (`host.ts`), and what a person's run and a scheduler's
 * tick refuse on. The git host is asked whether the account runs work as there can be used,
 * `login` when one is named: a project with no git host package runs fine, and one with no account
 * there is refused.
 */
export async function readyToRun(repo: string, driver: string | undefined, deps: { agent?: RunAgent; gitHostEnv?: typeof gitHostEnv; login?: string } = {}): Promise<DriverReadiness> {
  const agent = deps.agent ?? (await codingAgent(driver))
  // An added account is a login runs use: the CLI's own is not needed beside it.
  const ready = await agent.ready({ personal: await readPersonal(repo, () => {}), addedAccount: agent.accounts !== undefined && hasAddedAccount(agent.accounts.list) })
  const given = await (deps.gitHostEnv ?? gitHostEnv)(repo, deps.login)
  if (!given.ok) ready.problems.push(deps.login !== undefined ? cannotWorkAs(deps.login, given.error) : given.error)
  return ready
}

/** Why a run cannot go as `login` at the git host, on this computer. */
function cannotWorkAs(login: string, error: string): string {
  return `This session works as @${login} at the git host, and it cannot be used here: ${error}`
}

/** The command line of a spawned run: the model, the coding agent, the publish level, the attached text, the base, the pull request's base, the branch and what it is for named only when the run has them, so the run's own defaults apply otherwise. */
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
  for (const image of run.images ?? []) args.push('--image', image)
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
  /** The coding agent, by its id; the distribution's first when absent. */
  driver?: string
  /** The account it starts on, by name, among the ones its coding agent may use: put in its environment ({@link ACCOUNT_ENV}). */
  account?: string
  /** What the run's process finds in its environment beside what this one has: the picks its command line does not carry. */
  env?: Readonly<Record<string, string>>
}

/** A resume spawned in its own process: the text or the answer it continues with, and who resumes it, when that is a scheduler's row. */
export interface SpawnedResume {
  id: string
  text?: string
  /** The images the text goes with, by their names in this computer's image store. */
  images?: string[]
  answer?: string
  model?: string
  effort?: string
  /** Who resumes the run (`run --resume --by`), kept on its mark. */
  by?: string
  /** How far the run takes its work from here on (`run --resume --publish`): a level, or `nothing`; its record's level when absent. */
  publish?: Publish | typeof NO_PUBLISH
  /** The account it goes on with, by name, among the ones its coding agent may use: put in its environment ({@link ACCOUNT_ENV}). */
  account?: string
}

/** The command line of a spawned resume: the text as the argument, or the answer. */
export function resumeArgs(run: SpawnedResume): string[] {
  const args = ['run', '--resume', run.id]
  if (run.text !== undefined) args.push(run.text)
  for (const image of run.images ?? []) args.push('--image', image)
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
    const child = await spawnDetached(repo, run.id, runArgs(run), run.account, run.env)
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

/** Spawn a detached process of this tool for the run `id`, with `env` on top of this one's; resolves with its pid once it is spawned. */
async function spawnDetached(repo: string, id: string, args: string[], account?: string, env: Readonly<Record<string, string>> = {}): Promise<number> {
  const stderrPath = runStderrPath(repo, id)
  mkdirSync(dirname(stderrPath), { recursive: true })
  const fd = openSync(stderrPath, 'a')
  const child = spawn(process.execPath, [BIN, ...args], {
    cwd: repo,
    detached: true,
    stdio: ['ignore', 'ignore', fd],
    env: { ...process.env, ...env, [AGENT_ID_ENV]: id, ...(account !== undefined ? { [ACCOUNT_ENV]: account } : {}) },
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
 * A person's run, answered at once: the run's process spawned detached, the id returned. How this
 * computer's host starts a run (`host.ts`): the page needs the id back now, not when the agent
 * ends. The run's process writes its own marker: pushing it takes seconds, and the page waits on the id.
 */
export async function detachRun(
  repo: string,
  opts: RunRequest & { driver?: string; now?: () => Date; env?: Readonly<Record<string, string>> },
  deps: { spawn?: typeof spawnRun } = {},
): Promise<{ id: string }> {
  const { now = () => new Date(), ...request } = opts
  const id = runIdFrom(now().toISOString())
  await (deps.spawn ?? spawnRun)(repo, { ...request, id, mark: true })
  return { id }
}

/**
 * An ended run continued in its own process, and answered at once: how this computer's host
 * resumes a run (`host.ts`). A run this project has no record of is refused here, while someone is still
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
  /** The coding agent, by its id; the distribution's first when absent. */
  driver?: string
  /** The account at the git host picked for this session ({@link GIT_ACCOUNT_ENV}); its profile's, else the computer's, when absent. */
  gitAccount?: string
  /** The profile the run is on, by its id; Default when absent. */
  profile?: string
  /** The session's picks: the plugins the run goes without, the project's skills it gets. */
  picks?: SessionPicks
  log?: (line: string) => void
}

/**
 * A run of the real project, in this process, on the coding agent named (the distribution's first when none is). A
 * scheduler's run comes with its id and its marker already on the branch; a person's run mints its
 * id here and marks itself. The model is the
 * one given; none given, the coding agent starts on its own default.
 */
export async function runProject(repo: string, opts: ProjectRun, deps: { modules?: readonly DistributionEntry[] } = {}): Promise<RunOutcome> {
  const modules = deps.modules ?? (await distributionModules())
  // What the run is asked, its start, its profile and its log go on to it as they are; the rest is read here.
  const { id: given, mark, driver, gitAccount, picks = {}, ...rest } = opts
  const id = given ?? runIdFrom(new Date().toISOString())
  const log = rest.log ?? (() => {})
  const agent = await codingAgent(driver, modules)
  const setup = await readPersonal(repo, log)
  // The profile the run is on, as the person's store keeps it: its options are the run's where the session picked none.
  const profile = await runProfile(rest.profile, createHooks(modules).settings, log)
  const accounts = accountsOn(profile, agent)
  // A run given its id was marked by whoever spawned it, unless it was told to mark itself.
  const marked = given !== undefined && mark !== true
  // The name is asked for first of all: the run's account at the git host is read by its first
  // step, which takes a second or more, and is nothing the small model naming the run needs.
  const naming = namedAtStart({ ...rest, marked }) ? askName(driverFor(agent, undefined, setup, accounts), rest.prompt) : undefined
  const asked = gitAccount ?? (await profileLoginFor(repo, profile))
  return runCommand(repo, {
    ...rest,
    ...(naming !== undefined ? { naming } : {}),
    id,
    modules,
    marked,
    driver: driverFor(agent, id, setup, accounts),
    profileOptions: profile.options,
    ...(asked !== undefined ? { gitAccount: asked } : {}),
    ...(picks.without !== undefined ? { pluginsWithout: picks.without } : {}),
    ...(picks.project !== undefined ? { projectSkills: picks.project } : {}),
  })
}

/**
 * Continue an ended run of the real project, in this process: the user's text, or the answer to
 * the question it ended on. The coding agent is the one the run's record names: the session
 * to resume is its own, and so is the account at the git host it worked as, when the record
 * names one; the account runs use for a run recorded with none.
 */
export async function resumeProject(
  repo: string,
  opts: SpawnedResume & { log?: (line: string) => void },
  deps: { driverFor?: typeof driverFor; modules?: readonly DistributionEntry[] } = {},
): Promise<RunOutcome> {
  const modules = deps.modules ?? (await distributionModules())
  const card = await findRun(repo, opts.id)
  const agent = await codingAgent(card?.driver, modules)
  const log = opts.log ?? (() => {})
  const setup = await readPersonal(repo, log)
  const previous = card ? runnerMark(card) : undefined
  // The profile the record names, as it stands now: its accounts on this computer. The session's picks are the record's (`run.ts` optionsOf).
  const profile = await runProfile(previous?.profile, createHooks(modules).settings, log)
  const accounts = accountsOn(profile, agent)
  return resumeRun(repo, {
    id: opts.id,
    modules,
    ...(opts.text !== undefined ? { text: opts.text } : {}),
    ...(opts.images !== undefined ? { images: opts.images } : {}),
    ...(opts.answer !== undefined ? { answer: opts.answer } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
    ...(opts.by !== undefined ? { by: opts.by } : {}),
    ...(opts.publish !== undefined ? { publish: publishChange(opts.publish) ?? null } : {}),
    driver: (deps.driverFor ?? driverFor)(agent, opts.id, setup, accounts),
    profileOptions: profile.options,
    ...(opts.log ? { log: opts.log } : {}),
  })
}

/**
 * The modules a run of this process goes through: those of the distribution that started it, which
 * hands itself down to every process it starts (`@openagt/hooks`' {@link DISTRIBUTION_ENV}). A run
 * started with none handed down is refused before anything is written: without its distribution's
 * modules a run has no checkout to work in.
 */
async function distributionModules(): Promise<DistributionEntry[]> {
  const modules = await loadHandedDown(process.env)
  if (!modules) throw new Error(`no distribution was handed down to this process (${DISTRIBUTION_ENV}): a run goes through the modules of the OpenAgent that starts it`)
  return modules
}

/** The account a run starts on, by name, when whoever started it picked one: a scheduler's pick. */
export const ACCOUNT_ENV = 'OPENAGENT_ACCOUNT'

/**
 * The account at the git host a run works as, by its login, when whoever started it picked one
 * for this session: a dashboard's pick beside the message box. In the environment, as the
 * dashboard's other settings for a run are, so no project's `start` line has to carry it.
 */
export const GIT_ACCOUNT_ENV = 'OPENAGENT_GIT_ACCOUNT'

/**
 * The login a run on `profile` works as at the git host, where the project has one, and in a
 * session with no project, which may reach the host all the same: a profile's account at GitHub
 * means nothing in a project on another host, and such a run goes as no account rather than
 * refused. (A pick made for the session is another matter: it was made among the host's accounts,
 * and is asked for as it is.)
 */
export async function profileLoginFor(repo: string, profile: Pick<Profile, 'options'>): Promise<string | undefined> {
  const account = profile.options.github?.account
  if (account === undefined) return undefined
  return (await sessionsHomeOf(repo)) !== undefined || (await gitHostCommand(repo)) ? account : undefined
}

/**
 * The accounts of `agent`'s list the run's profile names (`RunOptions['agent-driver']`), those this
 * computer has: an account named on another computer applies only where it is. None of them here,
 * none named, or an agent with no list: every account of the computer's.
 */
export function accountsOn(profile: Pick<Profile, 'options'>, agent: Pick<RunAgent, 'accounts'>, env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const list = agent.accounts?.list
  if (list === undefined) return undefined
  const picks: Record<string, unknown> = { ...profile.options['agent-driver'] }
  const named = picks[list]
  if (!Array.isArray(named)) return undefined
  const have = new Set(readAccounts(accountsPath(list, env)).map(account => account.name))
  const kept = named.filter((name): name is string => typeof name === 'string' && have.has(name))
  return kept.length > 0 ? kept : undefined
}

/**
 * What whoever starts a run tells its process in the environment, and the run's process alone
 * reads: the session's picks, its profile, its accounts, the file its name comes in. Its agent
 * never gets them: they are no part of the agent's own work, and an OpenAgent the agent starts in
 * its checkout (a dashboard to try its change) would take them for its own runs' picks, and
 * refuse to continue any of them.
 */
export const RUN_PICKS_ENV: readonly string[] = [ACCOUNT_ENV, GIT_ACCOUNT_ENV, PROFILE_ENV, PLUGINS_WITHOUT_ENV, PROJECT_SKILLS_ENV, NAME_FILE_ENV]

/**
 * The driver of a run on `agent`, as the agent builds it for a run: unrestricted, as nobody is
 * there to approve what it does in the run's checkout. The run's id is in the agent's
 * environment, so the claim it makes names the run (the tickets skill reads `AGENT_ID`); the
 * picks this process was started with are not ({@link RUN_PICKS_ENV}).
 *
 * The coding agent starts with the person's own setup, as when started by hand, less the parts
 * this machine's config turns off (`personal:` in `config.ts`). How a part is turned off is the
 * agent's own business. `only` is the accounts of its list the run takes, all of them when absent.
 */
export function driverFor(agent: RunAgent, id: string | undefined, personal: PersonalSetup, only?: string[]): Driver {
  // Without an id, a driver for no run's agent: a session that only names one.
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !RUN_PICKS_ENV.includes(name)))
  if (id !== undefined) env[AGENT_ID_ENV] = id
  // On the computer's accounts of the agent's list, or the few the run's profile names, the next free one taking over at a limit; the one to start on, when whoever started the run said.
  const prefer = process.env[ACCOUNT_ENV]?.trim()
  const accounts = agent.accounts ? accountRotation(agent.accounts, { ...(prefer ? { prefer } : {}), ...(only ? { only } : {}) }) : undefined
  return agent.driver({ env, personal, ...(accounts ? { accounts } : {}) })
}
