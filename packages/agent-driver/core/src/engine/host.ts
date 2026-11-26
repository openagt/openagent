import { rm, stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { appendInbox, givenRepos, imagesOf, promptLines, takeInbox } from '../inbox.js'
import { deleteRun, findRun, patchRun } from '../record-store.js'
import { isRunId, type RunCard, type RunPatch } from '../record.js'
import { PLUGINS_WITHOUT_ENV, PROFILE_ENV, PROJECT_SKILLS_ENV, isSkillName } from './names.js'
import { originUrl, LOCAL_HOST, MODULE_NAME, PUBLISH_LEVELS, isBranchName, NAME_RUNS, PICKED_AGENT, PICKED_PROFILE, isProfileId, type AgentPick, type ProjectRef, type Settings, type RunFacts, type RunFound, type RunHost, type RunInput, type RunOptions, type RunReadiness, type RunRef, type RunRequest, type InboxLine, type PromptLine, type RunAgent, sessionsHome } from '@openagt/hooks'
import { sessionFolder, sessionsHomeOf, discardWorktree, worktreePath } from '@openagt/git-branches'
import { listedRuns, liveCard, ownFolder, runEvents, standing, type RunReadsDeps } from '../reads/run-reads.js'
import { handedDownSettings, runProfile } from './profile.js'
import { inboxPath, liveDir } from './live-card.js'
import { isPublish, NO_PUBLISH } from './records.js'
import { takesRequests } from './git-host.js'
import { isPidAlive } from './run-lock.js'
import { profileLoginFor, detachResume, detachRun, GIT_ACCOUNT_ENV, readyToRun, spawnResume, spawnRun } from './runner.js'
import type { RunRequest as AskedRun } from './run.js'
import { nameHandOver } from './title.js'
import { ReadyNaming } from './ready-naming.js'
import { nameStarted, withStartedNames } from './started-names.js'
import { codingAgents } from '../agents.js'
import { refusedImages } from '../images.js'

/**
 * This computer's host (`run.host`, #2394): a run started here is a process of its own, detached,
 * answered with its id at once (`runner.ts`); what a person says to it goes through its inbox
 * while it works, and resumes it once it has ended; a Stop is a signal to the process its card
 * names. Nothing waits in memory: a run's state is its files, the live card in its checkout and
 * its record, so a host made again finds every run where it was.
 */

/** What this computer's host works with; the real one when absent. A demo scripts the runs' processes (`spawnRun`, `spawnResume`). */
export interface LocalHostDeps {
  spawnRun?: typeof spawnRun
  spawnResume?: typeof spawnResume
  /** Whether a run on the coding agent `driver` (the distribution's first when none is named) can start here, working as `login` at the git host when one is named. */
  ready?: (dir: string, driver: string | undefined, login?: string) => Promise<RunReadiness>
  /** The account at the git host a run on `profile` works as when it names none: its profile's. */
  loginFor?: (dir: string, profile: string | undefined) => Promise<string | undefined>
  isAlive?: (pid: number) => boolean
  /** This computer's name, as the cards of its runs say it. */
  host?: string
  /** How long a Stop waits for a run that is starting to name its process. */
  startingMs?: number
  /** The settings a run's picks for every next run are read from: the distribution's. */
  settings?: () => Promise<Settings>
  /** Where a run's name is asked as it starts: the naming sessions this process keeps waiting. */
  naming?: Pick<ReadyNaming, 'names' | 'name' | 'prepare'>
  /** The coding agents, which say how one of their sessions is picked back up: the distribution's. */
  agents?: () => Promise<readonly RunAgent[]>
  /** Whether a pull request can be opened at the host of `remote`, a repository's address, as one of OpenAgent's accounts there: the modules' (`account.access`). */
  takesRequests?: (remote: string) => Promise<boolean>
  /** Whether the project's folder has an `origin` remote, the one every push goes to: its git's. */
  hasOrigin?: (dir: string) => Promise<boolean>
}

/** How long a Stop waits for a run just started to name its process: as long as a page shows a run as starting. */
const STARTING_MS = 30_000

export function localHost(deps: LocalHostDeps = {}): RunHost {
  const ready = deps.ready ?? ((dir, driver, login) => readyToRun(dir, driver, login !== undefined ? { login } : {}))
  const loginFor = deps.loginFor ?? (async (dir, profile) => profileLoginFor(dir, await runProfile(profile, await handedDownSettings())))
  const isAlive = deps.isAlive ?? isPidAlive
  const here = deps.host ?? hostname()
  const startingMs = deps.startingMs ?? STARTING_MS
  const settings = deps.settings ?? (() => handedDownSettings())
  const naming = (): Pick<ReadyNaming, 'names' | 'name' | 'prepare'> => deps.naming ?? (readyNaming ??= new ReadyNaming())
  const requestsAt = deps.takesRequests ?? (remote => takesRequests(remote))
  const hasOrigin = deps.hasOrigin ?? (async dir => (await originUrl(dir)) !== undefined)

  /**
   * The options with an Auto level the project can reach, so every Start goes as far whichever page
   * sent it: with no `origin` nothing leaves this computer, so the level stops at the commit; where
   * no module has an account of OpenAgent's at the host of the project's address, no pull request is
   * opened as one, so it stops at the branch. A session with no project takes each of its copies of
   * repos as far as picked, whatever host each is on.
   */
  const reachable = async (project: ProjectRef | undefined, options: RunOptions): Promise<RunOptions> => {
    if (project === undefined || options.publish === undefined) return options
    const level = PUBLISH_LEVELS.indexOf(options.publish)
    if (level <= PUBLISH_LEVELS.indexOf('commit')) return options
    if (!(await hasOrigin(project.dir))) return { ...options, publish: 'commit' }
    return level <= PUBLISH_LEVELS.indexOf('branch') || (project.remote !== undefined && (await requestsAt(project.remote))) ? options : { ...options, publish: 'branch' }
  }
  /** The coding agent a run that names none is on: the distribution's first. */
  const firstAgent = async (): Promise<string | undefined> => (await codingAgents().catch(() => []))[0]?.id
  /** How this host's runs are read: its summaries name it, and each coding agent says how its sessions are picked back up. */
  const reads: RunReadsDeps = { host: LOCAL_HOST, here, isAlive, agents: () => deps.agents?.() ?? codingAgents() }
  /** Whether runs started here are named: the person's setting, read as each run starts; a store that cannot be read names them. */
  const namesRuns = (): Promise<boolean> => settings().then(read => read.get(NAME_RUNS), () => true)

  /**
   * A run's name, asked as the run is started rather than once its process is up: of a naming
   * session waiting for the project's runs, it is in about a second after Start. The run is handed
   * a file to find it in, and this host lists the run with it meanwhile (`started-names.ts`). Asked only
   * where the Start brings none of its own and the person names runs: read here, so a run a
   * schedule starts is named exactly as one a person starts is.
   */
  const nameAsStarted = async (dir: string, prompt: string, driver: string | undefined, title: RunRequest['title']): Promise<{ title: RunRequest['title']; started: (id: string) => void; failed: () => void }> => {
    const none = { started: () => {}, failed: () => {} }
    if (title !== undefined) return { title, ...none }
    if (!(await namesRuns())) return { title: false, ...none }
    const agent = driver ?? (await firstAgent())
    if (agent === undefined || !naming().names(prompt)) return { title: undefined, ...none }
    const stop = new AbortController()
    const name = naming().name(dir, prompt, agent, stop.signal)
    return { title: name, started: id => nameStarted(id, name), failed: () => stop.abort() }
  }

  /** Whether the run's live card says it is working, here, under a process that is alive. */
  const working = async (dir: string, id: string): Promise<boolean> => {
    const card = await liveCard(await checkoutOf(dir, id), id)
    const { pid, host } = processOf(card)
    return card?.status === 'running' && pid !== undefined && host === here && isAlive(pid)
  }

  /**
   * The run's card once it names the run's process, or says it ended. A run just started has
   * neither yet: a Stop then waits for it, as long as a run may take to start, rather than being
   * lost while the run goes on.
   */
  const cardOnceUp = async (dir: string, id: string): Promise<RunCard | undefined> => {
    const deadline = Date.now() + startingMs
    for (;;) {
      const card = await cardOf(dir, id)
      if ((card && (card.status !== 'running' || processOf(card).pid !== undefined)) || Date.now() >= deadline) return card
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }

  const resume = async (run: RunRef, input: RunInput): Promise<void> => {
    if (input.text === undefined && input.answer === undefined) throw new Error('A run goes on with a message or an answer.')
    await refuseImages(input.images)
    await detachResume(
      placeOf(run.project),
      {
        id: run.id,
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.images !== undefined && input.images.length > 0 ? { images: input.images } : {}),
        ...(input.answer !== undefined ? { answer: input.answer } : {}),
        ...(input.publish !== undefined ? { publish: input.publish } : {}),
        ...(input.repos !== undefined && input.repos.length > 0 ? { repos: input.repos } : {}),
      },
      deps.spawnResume ? { spawn: deps.spawnResume } : {},
    )
  }

  return {
    id: LOCAL_HOST,
    label: 'This computer',

    // A Start is near, on these picks (the launcher opened, or its picks changed): the naming
    // session that run will take is started now, while the person types, unless one already waits.
    async check({ project, options: given }) {
      const dir = placeOf(project)
      const driver = (await withPicks(given, settings))['agent-driver']?.driver
      void (async () => {
        const agent = driver ?? (await firstAgent())
        if (agent !== undefined && (await namesRuns())) await naming().prepare(dir, agent)
      })().catch(() => {})
      return ready(dir, driver)
    },

    async start({ project, prompt, images, options: picked, title }) {
      const given = await reachable(project, withoutIdleLevel(project, picked))
      refuse(project, given)
      await refuseImages(images)
      // A run whose options name no profile, or no coding agent, is on the ones picked for every next run on this computer.
      const options = await withPicks(given, settings)
      const dir = placeOf(project)
      const driver = options['agent-driver']?.driver
      // A run is refused before it spends a checkout when its coding agent cannot start, or the account it works as cannot be used here.
      const login = options.github?.account ?? (await loginFor(dir, options.profiles?.profile))
      const readiness = await ready(dir, driver, login)
      if (readiness.problems.length > 0) throw new Error(readiness.problems.join(' '))
      const naming = await nameAsStarted(dir, prompt, driver, title)
      const name = nameHandOver(naming.title)
      const started = await detachRun(dir, { prompt, ...(images !== undefined && images.length > 0 ? { images } : {}), ...(driver !== undefined ? { driver } : {}), ...asked(options), env: { ...picks(options), ...name.env } }, deps.spawnRun ? { spawn: deps.spawnRun } : {}).catch((err: unknown) => {
        naming.failed()
        throw err
      })
      name.started()
      naming.started(started.id)
      return { id: started.id }
    },

    resume,

    async steer(run, line) {
      if (line.kind === 'message') await refuseImages(line.images)
      const dir = placeOf(run.project)
      const lines: InboxLine[] = [line]
      if (await working(dir, run.id)) {
        const inbox = inboxPath(await checkoutOf(dir, run.id))
        await appendInbox(inbox, line)
        if (await working(dir, run.id)) return
        // The run ended while the line was on its way, into an inbox nobody reads: what is still there resumes it instead.
        lines.splice(0, 1, ...(await takeInbox(inbox)))
      }
      for (const stranded of promptLines(lines)) await resume(run, inputOf(stranded))
    },

    async stop(run, opts = {}) {
      const card = await cardOnceUp(placeOf(run.project), run.id)
      const { pid, host } = processOf(card)
      if (!card || (card.status === 'running' && pid === undefined)) throw new Error('It has not started yet.')
      if (card.status !== 'running') throw new Error('It had already ended.')
      if (host !== here) throw new Error(`This run is on ${host ?? 'another computer'}.`)
      if (pid === undefined || !isAlive(pid)) throw new Error('Its process had already ended.')
      try {
        // The run's process asks its agent to end the turn where it is, as Esc does in Claude Code.
        process.kill(pid, 'SIGINT')
        // A second signal ends the agent's process tree at once (`run.ts`): of another kind, so the two are never taken for one.
        if (opts.force) process.kill(pid, 'SIGTERM')
      } catch {
        // Gone between the look and the signal.
        throw new Error('Its process had already ended.')
      }
    },

    async delete(run) {
      if (!isRunId(run.id)) throw new Error(`invalid session id: ${run.id}`)
      const dir = placeOf(run.project)
      if ((await cardOf(dir, run.id))?.status === 'running') throw new Error('that session is still going; stop it before deleting it')
      await dropFolder(dir, run.id)
      // Then the record that put the row in the list. A run with none (its checkout was all there
      // was, or a delete stopped half-way) is done once its folder is.
      if (await findRun(dir, run.id).catch(() => undefined)) {
        const removed = await deleteRun(dir, run.id)
        if (!removed.ok) throw new Error(removed.error)
      }
    },

    async record(run, facts) {
      const patch = patchOf(facts)
      if (patch === undefined) throw new Error('Nothing of this is kept on a run\'s record.')
      if (!(await patchRun(placeOf(run.project), run.id, patch).catch(() => false))) throw new Error('the record was not updated')
    },

    // A run just started goes by the name asked for it as it started, until its record has one.
    async list(project, wanted = {}) {
      return withStartedNames(await listedRuns(placeOf(project), project?.id, wanted, reads))
    },

    async find(run) {
      if (!isRunId(run.id)) return undefined
      const dir = placeOf(run.project)
      const folder = await ownFolder(dir, run.id)
      const [live, record] = await Promise.all([folder !== undefined ? liveCard(folder.path, run.id) : undefined, findRun(dir, run.id).catch(() => undefined)])
      if (folder === undefined && !record) return undefined
      return foundOf(standing(record, live) ?? {}, folder !== undefined ? { path: folder.path, branch: folder.branch } : undefined, here)
    },

    events(run, signal) {
      return runEvents(placeOf(run.project), run.id, signal)
    },
  }
}

/**
 * Where a run's work is, by its card as it stands (its live card's facts over its record's, fact by
 * fact, so the pull request a dashboard wrote on the record is kept): its checkout while it has one,
 * at the branch it has out then, since an agent renames its branch as it works and its card learns
 * the name at the end. A run that ended here with no pull request and nothing landed changed nothing
 * (#1850): its tool deletes a branch with its checkout only when the branch holds nothing.
 */
function foundOf(card: Partial<RunCard>, checkout: { path: string; branch: string | undefined } | undefined, here: string): RunFound {
  const caller = card.caller ?? {}
  const text = (key: string): string | undefined => (typeof caller[key] === 'string' ? (caller[key] as string) : undefined)
  const host = text('host')
  const base = text('base')
  const baseCommit = text('baseCommit')
  const landed = text('landed')
  const branch = checkout?.branch ?? card.branch
  const options = isMap(caller['options']) ? (caller['options'] as RunOptions) : undefined
  const earlierPrs = Array.isArray(caller['earlierPrs']) ? (caller['earlierPrs'] as unknown[]).filter(isPullRequest) : undefined
  const record = card.status === undefined ? undefined : {
    status: card.status,
    ...(card.startedAt !== undefined ? { startedAt: card.startedAt } : {}),
    ...(card.endedAt !== undefined ? { endedAt: card.endedAt } : {}),
    ...(card.intent !== undefined ? { prompt: card.intent } : {}),
    ...(options ? { options } : {}),
    ...(host !== undefined ? { host } : {}),
    ...(branch !== undefined ? { branch } : {}),
    ...(card.pr ? { pr: { number: card.pr.number, url: card.pr.url } } : {}),
    ...(earlierPrs?.length ? { earlierPrs } : {}),
    ...(base !== undefined ? { base } : {}),
    ...(baseCommit !== undefined ? { baseCommit } : {}),
    ...(landed !== undefined ? { landed } : {}),
  }
  const ended = card.status === 'done' || card.status === 'failed' || card.status === 'stopped'
  return {
    ...(checkout ? { checkout: checkout.path } : {}),
    ...(record ? { record } : {}),
    changedNothing: !card.pr && landed === undefined && ended && host === here,
  }
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A pull request as a record keeps it: its number and its address. */
function isPullRequest(value: unknown): value is { number: number; url: string } {
  return isMap(value) && typeof value['number'] === 'number' && typeof value['url'] === 'string'
}

/** Where a run of `project` is started and found: the project's folder, or the sessions home for a session with no project. */
function placeOf(project: ProjectRef | undefined): string {
  return project?.dir ?? sessionsHome()
}

/** The folder a run works in: its checkout of the project, or a session's folder of its own. */
async function checkoutOf(dir: string, id: string): Promise<string> {
  const home = await sessionsHomeOf(dir)
  return home !== undefined ? sessionFolder(home, id) : worktreePath(dir, id)
}

/**
 * A deleted run's folder gone, whatever it holds: a session's folder in the sessions home, or the
 * run's checkout of the project, its uncommitted work with it (the session is being thrown away;
 * git-branches' Remove worktree would keep a checkout holding any). Its branch and its commits
 * stay: a branch may carry merged work or an open pull request, and that is git's. A folder that is
 * no git worktree is left alone, and the delete refused.
 */
async function dropFolder(dir: string, id: string): Promise<void> {
  const home = await sessionsHomeOf(dir)
  if (home !== undefined) {
    await rm(sessionFolder(home, id), { recursive: true, force: true })
    return
  }
  const checkout = worktreePath(dir, id)
  if (!(await stat(checkout).then(found => found.isDirectory(), () => false))) return
  const dropped = await discardWorktree(dir, checkout)
  if (!dropped.ok) throw new Error(`its folder ${checkout} is not a git worktree; left alone`)
}

/**
 * What a run's record keeps of the facts a module found out once the run's process was gone: its
 * pull request, and the work landed, the branch's last commit with the commit its work began at,
 * which the record keeps as the run's own tools do. None when the facts hold neither.
 */
function patchOf(facts: RunFacts): RunPatch | undefined {
  const pr = facts.github?.pr
  const branches = facts['git-branches']
  const landed = branches?.landed !== undefined && branches.baseCommit !== undefined ? { commit: branches.landed, from: branches.baseCommit } : undefined
  if (!pr && !landed) return undefined
  return { ...(pr ? { pr: { number: pr.number, url: pr.url } } : {}), ...(landed ? { landed } : {}) }
}

/** A run's card as it stands: its live one while it has a checkout, its record's once it has none. */
async function cardOf(dir: string, id: string): Promise<RunCard | undefined> {
  return (await liveCard(await checkoutOf(dir, id), id)) ?? (await findRun(dir, id))
}

/** The process a card names, and the computer it is on: any tool's, as a reader of the card finds them. */
function processOf(card: RunCard | undefined): { pid?: number; host?: string } {
  const pid = card?.caller?.['pid']
  const host = card?.caller?.['host']
  return { ...(typeof pid === 'number' ? { pid } : {}), ...(typeof host === 'string' ? { host } : {}) }
}

/** Refuse images a run cannot be handed, in words for the person ({@link refusedImages}): before anything is spent, or said to the run. */
async function refuseImages(images: unknown): Promise<void> {
  const refused = await refusedImages(images)
  if (refused !== undefined) throw new Error(refused)
}

/**
 * The options with no Auto level where it has nothing to act on: a session with no project
 * publishes its copies of repos, and with none it has nothing to publish. The launcher offers the
 * level before its repos are picked, which another module's control does.
 */
function withoutIdleLevel(project: ProjectRef | undefined, options: RunOptions): RunOptions {
  if (project || options.publish === undefined || options['git-branches']?.repos?.length) return options
  const { publish: _idle, ...rest } = options
  return rest
}

/**
 * Picks that cannot make a run, refused before anything is spent: what a session with no project
 * has no git for, and names that are not names. The run's process
 * reads its picks off its command line and its environment: only what reads as the thing it names goes there.
 */
function refuse(project: ProjectRef | undefined, options: RunOptions): void {
  const branches = options['git-branches'] ?? {}
  if (!project && (branches.base !== undefined || branches.branch !== undefined || options.github?.prBase !== undefined || options.skills?.project !== undefined)) {
    throw new Error('A session with no project has no git: no branch to start from or work on, and no project skills.')
  }
  if (branches.branch !== undefined && branches.base !== undefined) throw new Error('A run given a branch to work on starts from no other.')
  if (options.github?.account !== undefined && !/^\S+$/.test(options.github.account)) throw new Error('An account is named by its login.')
  // The branch a pull request goes into ends up on the run's command line: only a branch name goes there.
  if (options.github?.prBase !== undefined && !isBranchName(options.github.prBase)) throw new Error(`not a branch name: ${String(options.github.prBase)}`)
  const profile = options.profiles?.profile
  if (profile !== undefined && !isProfileId(profile)) throw new Error('A profile is named by its id.')
  const kept = options.skills?.project
  if (kept !== undefined && kept !== 'all' && kept !== 'none' && !kept.every(isSkillName)) throw new Error('Skills are named by their names.')
  if (options.plugins?.without?.every(name => MODULE_NAME.test(name)) === false) throw new Error('Plugins are named by their names.')
}

/** What the run's own process is asked on its command line (`runArgs`). */
function asked(options: RunOptions): Omit<AskedRun, 'prompt'> {
  const agent = options['agent-driver'] ?? {}
  const branches = options['git-branches'] ?? {}
  return {
    ...(agent.model !== undefined ? { model: agent.model } : {}),
    ...(agent.effort !== undefined ? { effort: agent.effort } : {}),
    ...(options.publish !== undefined ? { publish: options.publish } : {}),
    ...(branches.base !== undefined ? { base: branches.base } : {}),
    ...(branches.branch !== undefined ? { branch: branches.branch } : {}),
    ...(branches.repos !== undefined && branches.repos.length > 0 ? { repos: branches.repos } : {}),
    ...(branches.projects !== undefined && branches.projects.length > 0 ? { projects: branches.projects } : {}),
    ...(options.github?.prBase !== undefined ? { prBase: options.github.prBase } : {}),
  }
}

/** The picks the run's own process reads off its environment: the account it works as, its profile, the plugins it goes without and the project's skills it gets. */
function picks(options: RunOptions): Record<string, string> {
  const profile = options.profiles?.profile
  const without = options.plugins?.without
  const project = options.skills?.project
  return {
    ...(options.github?.account !== undefined ? { [GIT_ACCOUNT_ENV]: options.github.account } : {}),
    ...(profile !== undefined ? { [PROFILE_ENV]: profile } : {}),
    // Set, even to nothing: a session that goes without none of them, where its profile leaves some out.
    ...(without !== undefined ? { [PLUGINS_WITHOUT_ENV]: without.join(',') } : {}),
    ...(project !== undefined ? { [PROJECT_SKILLS_ENV]: project === 'all' || project === 'none' ? project : project.join(',') } : {}),
  }
}

/** What a line left in the inbox resumes the run with: the message, with how far it takes the work from there, or the answer. */
function inputOf(line: PromptLine): RunInput {
  if (line.kind === 'answer') return { answer: line.answer }
  const publish = line.publish
  return {
    text: line.text,
    ...(publish !== undefined && (isPublish(publish) || publish === NO_PUBLISH) ? { publish } : {}),
    ...imagesOf(line),
    ...(givenRepos(line).length > 0 ? { repos: givenRepos(line) } : {}),
  }
}

/** The naming sessions this process keeps waiting for the runs it starts, made at the first that is named. */
let readyNaming: ReadyNaming | undefined

/**
 * The run's options, on the picks made for every next run on this computer where they name none:
 * the profile picked (`PICKED_PROFILE`), and the coding agent with its model and effort: the run's
 * own where its options name an agent, else its profile's, else the one picked (`PICKED_AGENT`). A
 * store that cannot be read picks none.
 */
async function withPicks(options: RunOptions, settings: () => Promise<Settings>): Promise<RunOptions> {
  const read = await settings().catch(() => undefined)
  const pickedProfile = options.profiles?.profile ?? (await read?.get(PICKED_PROFILE).catch(() => undefined))
  const profiled = pickedProfile === undefined ? options : { ...options, profiles: { ...options.profiles, profile: pickedProfile } }
  const asked = options['agent-driver'] ?? {}
  if (asked.driver !== undefined || read === undefined) return profiled
  const profile = (await runProfile(pickedProfile, read).catch(() => undefined))?.options['agent-driver'] ?? {}
  const picked: AgentPick = profile.driver !== undefined ? profile : await read.get(PICKED_AGENT).catch(() => ({}))
  const agent = { ...(picked.driver !== undefined ? { driver: picked.driver } : {}), ...(picked.model !== undefined ? { model: picked.model } : {}), ...(picked.effort !== undefined ? { effort: picked.effort } : {}) }
  return Object.keys(agent).length === 0 ? profiled : { ...profiled, 'agent-driver': { ...asked, ...agent } }
}
