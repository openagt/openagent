import { isAbsolute, join, resolve, sep } from 'node:path'
import { hostname, tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { rename, rm, stat, writeFile } from 'node:fs/promises'
import { isDriverName, type ReadyNaming } from '@openagt/agent-runner'
import { nameStarted } from './started-names.js'
import { findCheckout, fromDiaryLine, isPidAlive, isRunId, projectBranches, readLiveMetas, resolveAgentDiary, type AgentMeta, type AnyDiaryLine } from './store/index.js'
import { OPENAGENT_DIR } from './openagent-dir.js'
import type { OpenAgentEvent } from './events.js'
import type { StartAgentOptions, StartAgentResult, AddProjectResult, RemoveProjectResult, StartedInResult } from './dashboard/types.js'
import type { EventsSource, RemoteAgents } from './dashboard-rpc/context.js'
import { relayRpc, startRemoteAgent, targetOf, type BringProject, type RelayProject, type RemoteTarget } from './dashboard/remote-run.js'
import { idInLineName, isElsewhereId } from './dashboard/elsewhere.js'
import { createRemoteAgents } from './remote-agents.js'
import { ownRunsWatch } from './dashboard/runs-watch.js'
import { cloneProject, cloneTarget } from './clone-project.js'
import { copyLoginsTo, loginsAreThere, ownLogins, type OwnLogins } from './dashboard/copy-logins.js'
import { screenInDiary } from './dashboard/screen.js'
import { gitUserOf, onMachine } from './dashboard/run-rows.js'
import { tailAgentEvents } from './dashboard-rpc/events-tail.js'
import { addProject, listMachines, listProjects, projectId, readPreferences, removeProject, type MachineRecord } from './registry.js'
import { writeHookLines } from './built-in.js'
import { fileBranchRepo, installProject, isAgentId, projectKey, projectNameOf, repositoryAddress, sessionsHome, writeSharing, isSkillName } from '@openagt/agent-data'
import { publishedBranch } from '@openagt/agent-data/names'
import { branchesOnOrigin } from './dashboard/start-branch.js'
import { removeProjectFiles } from './remove-files.js'
import { runProjectHooks, runStartHook, type StartHookInput } from './project-hooks.js'
import { publishLevelOf, publishPickIn } from './publish-levels.js'
import { isBranchName } from './branch-name.js'
import { hasRemote } from './has-remote.js'
import { projectGitHost } from './store/git-host.js'
import { providedDataChanged } from './store/provided.js'
import { projectAddresses, SESSIONS_ID } from './project-address.js'
import { readySessionsHome } from './sessions-home.js'

/**
 * What the daemon does for a project (#393): start a run, here or on a saved machine, add, find
 * and remove a project, and stream a run here back to the machine that sent it. What this
 * computer knows of the runs on the person's other computers is remote-agents.ts's. Split from
 * daemon.ts so that file reads as the daemon's lifecycle (ports, boot, shutdown). The daemon runs
 * no agent itself (#1774): a Start is the project's own `start` hook line, and the run it begins
 * belongs to whatever tool that line names.
 */

/** How long a project folder's repository address is trusted before git is asked again. */
const ADDRESS_KEPT_MS = 10_000

/** How long a coding agent's name may be that another machine answers: a row shows it. */
const MAX_DRIVER_NAME = 64

/** How many projects this computer clones at once for other machines; one more is told to ask again. */
const MAX_COMING = 3
/** How many clones are remembered at once, on their way or failed. */
const MAX_KEPT = 32
/** How much of a failed clone's reason is kept and told: git passes on what the other side said. */
const MAX_REASON = 600

/** The coding agent a Start goes to when none was picked: the start hook's own default (agent-runner's). */
const DEFAULT_DRIVER = 'claude-code'

/** How long a name handed to a run waits for it: a start line of another tool never takes it. */
const HANDED_NAME_KEPT_MS = 2 * 60_000

/** A run's name as it is asked while the run starts: what the start line is given of it, and what follows once the line answered. */
interface StartName {
  /** Whether the run is named at all, and the file it finds the name asked here in. */
  input: Pick<StartHookInput, 'nameRun' | 'nameFile'>
  /** The line started the run: the name, once in, is handed to it and shown for it. */
  started: (agentId: string) => void
  /** The line started nothing: the name is not asked for any more. */
  failed: () => void
}

/**
 * Hand the run the name asked for it: written whole, then renamed into place, so the run never
 * reads half of one. `{}` when none came: the run asks on its own then.
 */
async function handName(file: string, title: string | undefined): Promise<void> {
  await writeFile(`${file}.part`, JSON.stringify(title !== undefined ? { title } : {}))
    .then(() => rename(`${file}.part`, file))
    .catch(() => {})
  setTimeout(() => void rm(file, { force: true }).catch(() => {}), HANDED_NAME_KEPT_MS).unref()
}

/**
 * Why a Start's picks are refused before anything is asked of the project, or nothing: a pick
 * reaches the start line's environment, so only what reads as the thing it names goes there. The
 * branches are checked once the run is known to start here: a machine picked to run on is sent none.
 */
function refusedPicks(options: StartAgentOptions, noProject: boolean): string | undefined {
  // A session with no project: with no branch, and nothing committed or published; the repos it
  // has are copied into its folder.
  if (noProject && (options.base !== undefined || options.prBase !== undefined || options.publish !== undefined || options.account !== undefined || options.projectSkills !== undefined)) {
    return 'A session with no project runs with no branch, nothing to publish, no account at a git host and no project skills.'
  }
  // Its repos are folders on this computer, copied into its folder here: on a machine there is nothing to copy.
  if (noProject && options.machine !== undefined && options.repos !== undefined) return 'The repos are folders on this computer: a session with them runs here. Pick this computer, or start without them.'
  // The login reaches the run's environment: one word, as a login is.
  if (options.account !== undefined && !(typeof options.account === 'string' && /^\S+$/.test(options.account))) return 'An account is named by its login.'
  if (options.agent !== undefined && !isAgentId(options.agent)) return 'An agent is named by its id.'
  // The picks of skills reach the environment as lists of names: only names go there.
  const skillList = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(isSkillName)
  if ((options.skillsOn !== undefined && !skillList(options.skillsOn)) || (options.skillsOff !== undefined && !skillList(options.skillsOff))) return 'Skills are named by their names.'
  if (options.projectSkills !== undefined && options.projectSkills !== 'none' && !skillList(options.projectSkills)) return 'Project skills are none, or named by their names.'
  if (!noProject && options.repos !== undefined) return 'Repos are added to a session with no project: a project works in its own checkout.'
  // The folders reach the line one per line: only whole paths go there.
  if (options.repos !== undefined && !(Array.isArray(options.repos) && options.repos.every(folder => typeof folder === 'string' && isAbsolute(folder) && !folder.includes('\n')))) {
    return 'A repo is named by the path of its folder on this computer.'
  }
  return undefined
}

/** Inputs to {@link createProjectRuntime}. */
export interface ProjectRuntimeOptions {
  /** The daemon's home workspace; a run with no project id targets it. */
  cwd: string
  /** Env for the registry lookups (#393). */
  env: NodeJS.ProcessEnv
  /** How a project another machine asks for is cloned; `cloneProject` when unsaid. */
  clone?: (address: string) => ReturnType<typeof cloneProject>
  /** The logins this OpenAgent copies to another person's computer; its user's `gh` and its own Claude login when unsaid. */
  logins?: (env: NodeJS.ProcessEnv) => Promise<OwnLogins>
  /** The naming sessions kept waiting for runs started here; without, each run asks for its own name. */
  naming?: ReadyNaming
}

/** The per-project surface the dashboard drives, plus its teardown. */
export interface ProjectRuntime {
  onStart: (prompt: string, options?: StartAgentOptions, targetProjectId?: string) => Promise<StartAgentResult>
  onAddProject: (path: string, share?: boolean) => Promise<AddProjectResult>
  /**
   * The folder `openagent` was started in: the listed project that holds it, so starting again
   * inside a project, or inside one of its folders, adds nothing; else the folder, added as Add
   * project adds one, with no answer on the agents' records: the repository keeps the one it has. Asked in-process by the daemon that starts there, and over RPC (`sendStartedAgain`) by
   * a second `openagent` that finds the dashboard running already.
   */
  onStartedIn: (folder: string) => Promise<StartedInResult>
  onRemoveProject: (projectId: string, files?: boolean) => Promise<RemoveProjectResult>
  /** A Start is near in a project, on a coding agent: the run's naming session is started for it. */
  onPrepareStart: (projectId: string, driver?: string) => void
  /** The live event stream for an agent this daemon is relaying from a machine (#1067), else undefined
   *  so `onEvents` falls back to tailing the on-disk log. Wired as the dashboard's events source. */
  remoteEventsSource: EventsSource
  /** This machine's own id for its project cloned from `address`, the name a relayed call gives a
   *  project; undefined when no project here is cloned from it. */
  projectAt: (address: string) => Promise<string | undefined>
  /**
   * Where this computer's copy of the project at `address` stands, for a machine that sends a run
   * here. With `bring`, a project this computer does not have is cloned and added, on its own:
   * the answer comes at once, and says `coming` until the project is there.
   */
  bringProject: (address: string, bring?: BringProject) => Promise<RelayProject>
  /** Tail a relay-started agent's on-disk events (#1067): the daemon's `/_relay/events` endpoint uses
   *  it to stream one agent back to whichever daemon relayed it here. */
  tailRelayEvents: (projectId: string, agentId: string, onEvent: (event: OpenAgentEvent) => void) => () => void
  /** The relayed-agent lookup the dashboard's read RPCs consult (#1067 slice 2): which machine a remote
   *  run runs on, so a run-scoped RPC forwards there instead of resolving a local checkout. */
  remoteAgents: RemoteAgents
  /** Where the live screen of a run on this computer answers, as its diary names it; nothing when
   *  the run has none: it opened no screen, closed it, or ended. */
  screenOf: (projectId: string, agentId: string) => Promise<string | undefined>
  /** Let go of the relayed streams. */
  dispose: () => Promise<void>
}

/**
 * The daemon's per-project runtime (#393). The home `cwd` is the default target: a request with
 * no project id (or the home id) resolves to it without a registry lookup.
 */
export function createProjectRuntime({ cwd, env, clone = cloneProject, logins = ownLogins, naming }: ProjectRuntimeOptions): ProjectRuntime {
  const homeId = projectId(resolve(cwd))

  // A project id resolves to its repo path via the registry; the home id (or none)
  // resolves to the daemon's own `cwd` without a lookup.
  const resolveProject = async (id: string | undefined): Promise<string | undefined> => {
    if (!id || id === homeId) return cwd
    if (id === SESSIONS_ID) return sessionsHome(env)
    const records = await listProjects(env)
    return records.find(record => record.id === id)?.path
  }

  // The project here that a relayed call names by its repository's address: the first on the list
  // cloned from it, every time, so a run's later calls reach the project it started in. A folder's
  // address is kept for a few seconds, so a run's reads, which poll, do not ask git about every
  // project each time. Only an address is kept: a folder that had none is asked again.
  const addresses = new Map<string, { address: string; until: number }>()
  const addressOf = async (path: string): Promise<string | undefined> => {
    // The sessions with no project go by their own name on every machine: each has a sessions home of its own, which answers to it.
    if (path === sessionsHome(env)) return SESSIONS_ID
    const kept = addresses.get(path)
    if (kept && kept.until > Date.now()) return kept.address
    const address = await repositoryAddress(path)
    if (address === undefined) addresses.delete(path)
    else addresses.set(path, { address, until: Date.now() + ADDRESS_KEPT_MS })
    return address
  }
  const projectAt = async (address: string): Promise<string | undefined> => {
    // The sessions with no project: every OpenAgent has a home of its own for them, under the one id.
    if (address === SESSIONS_ID) return SESSIONS_ID
    // A project with no address is named by its id here, by the person's other computer that lists it.
    const id = idInLineName(address)
    if (id !== undefined) return (await listProjects(env)).some(record => record.id === id) ? id : undefined
    for (const record of await listProjects(env)) {
      if ((await addressOf(record.path)) === address) return record.id
    }
    return undefined
  }

  // What this computer knows of the runs and projects on the person's other computers, and the
  // runs it follows there (remote-agents.ts): the lookup the dashboard's RPCs consult.
  const remote = createRemoteAgents({ env, resolveProject, addressOf, bringHere: (address, bring) => bringProject(address, bring) })

  // Start (#1774): the project's own `start` hook line, which answers the id of the run it began.
  // The daemon names no tool and holds nothing about the run: no slot, no cap (a person's click is
  // the brake), no process to stop at shutdown. A project without the line cannot start a run here.
  const onStart = async (prompt: string, options: StartAgentOptions = {}, targetProjectId?: string): Promise<StartAgentResult> => {
    if (isElsewhereId(targetProjectId)) return startElsewhere(prompt, options, targetProjectId)
    // A session with no project runs in a folder of its own in the sessions home, on this computer.
    const noProject = targetProjectId === SESSIONS_ID
    const refused = refusedPicks(options, noProject)
    if (refused !== undefined) return { ok: false, error: refused }
    const projectCwd = noProject ? await readySessionsHome(sessionsHome(env)) : await resolveProject(targetProjectId)
    if (!projectCwd) return { ok: false, error: `unknown project: ${targetProjectId}` }
    // Run on a saved machine (#1067): forward the start to its daemon, which runs the hook of its
    // own copy of this project, and relay the run's events back. The project is named by its
    // repository's address, the one name both machines have for it.
    if (options.machine !== undefined) {
      // A session with no project is named by the sessions' own id: the machine works in its own sessions home.
      if (noProject) return sendToMachine(prompt, options, options.machine, { id: SESSIONS_ID, name: 'A session with no project', address: SESSIONS_ID })
      const project = await repositoryAddress(projectCwd)
      if (!project) return { ok: false, error: 'This project has no repository address, so it cannot be sent to another machine.' }
      return sendToMachine(prompt, options, options.machine, { id: targetProjectId ?? homeId, name: await projectNameOf(projectCwd), address: project, cwd: projectCwd })
    }
    // The branch to start from ends up on the line's command line: only a branch name goes there.
    // Refused, not dropped: a run started from the main branch instead would be a silent swap.
    if (options.base !== undefined && !isBranchName(options.base)) return { ok: false, error: `not a branch name: ${String(options.base)}` }
    if (options.prBase !== undefined && !isBranchName(options.prBase)) return { ok: false, error: `not a branch name: ${String(options.prBase)}` }
    // A branch picked off origin's list may have gone since. Asked of origin here, so the person is
    // told above the box, rather than by a run that fails to make its checkout.
    const published = options.base !== undefined ? publishedBranch(options.base) : undefined
    if (published !== undefined) {
      const onOrigin = await branchesOnOrigin(projectCwd)
      if (!onOrigin) return { ok: false, error: `Could not read the branch ${published} from origin. Check the connection, or pick another branch to start from.` }
      if (!onOrigin.includes(published)) return { ok: false, error: `The branch ${published} is no longer on origin. Pick another branch to start from.` }
    }
    // The pick in force is decided here, so every Start goes the same way whichever page sent it:
    // with none saved the run commits and pushes nothing, and with one the project is not offered
    // it goes as far as the project does with no pull request: its branch pushed, or its work
    // committed where there is no remote.
    const publish = noProject ? undefined : publishLevelOf(publishPickIn(options.publish, (await projectGitHost(projectCwd).catch(() => undefined)) !== undefined, await hasRemote(projectCwd)))
    const name = await nameAsStarted(projectCwd, prompt, options.driver ?? DEFAULT_DRIVER)
    const started = await runStartHook(projectCwd, {
      prompt,
      ...name.input,
      ...(options.driver !== undefined ? { driver: options.driver } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.effort !== undefined ? { effort: options.effort } : {}),
      ...(publish !== undefined ? { publish } : {}),
      ...(options.base !== undefined ? { base: options.base } : {}),
      ...(options.prBase !== undefined ? { prBase: options.prBase } : {}),
      ...(options.repos !== undefined ? { repos: options.repos } : {}),
      ...(options.account !== undefined ? { account: options.account } : {}),
      ...(options.agent !== undefined ? { agent: options.agent } : {}),
      ...(options.skillsOn !== undefined ? { skillsOn: options.skillsOn } : {}),
      ...(options.skillsOff !== undefined ? { skillsOff: options.skillsOff } : {}),
      ...(options.projectSkills !== undefined ? { projectSkills: options.projectSkills } : {}),
    })
    // The line made a checkout (or is about to): the project's checkouts are read again on the
    // next look rather than a few seconds from now, so the new run's page finds its own.
    if (started.ok) {
      projectBranches.changed(projectCwd)
      ownRunsWatch.poke(projectCwd)
      name.started(started.id)
    } else name.failed()
    return started.ok ? { ok: true, agentId: started.id, ...(started.driver !== undefined ? { driver: started.driver } : {}) } : { ok: false, error: started.error }
  }

  // The run's name, asked as the run is started rather than once its process is up: of a naming
  // session waiting for this project's runs, it is in about a second after Start. The run is
  // handed a file to find it in, and the page asks for it here (`started-names.ts`). Named unless
  // the person turned naming off: read here rather than sent from the page, so a run a schedule
  // starts is named exactly as one a person starts is.
  const nameAsStarted = async (projectCwd: string, prompt: string, driver: string): Promise<StartName> => {
    const nameRun = (await readPreferences(env)).nameRuns !== false
    if (naming === undefined || !nameRun || !isDriverName(driver) || !naming.names(prompt, driver)) return { input: nameRun ? {} : { nameRun: false }, started: () => {}, failed: () => {} }
    const nameFile = join(tmpdir(), `openagent-name-${randomUUID()}.json`)
    const stop = new AbortController()
    const name = naming.name(projectCwd, prompt, driver, stop.signal)
    return {
      input: { nameFile },
      started: id => {
        nameStarted(id, name)
        void name.then(title => handName(nameFile, title)).then(() => ownRunsWatch.poke(projectCwd))
      },
      failed: () => stop.abort(),
    }
  }

  // Send a start to a saved machine, which runs the hook of its own copy of the project and is
  // followed from here. `machine` is stripped so the other side does not relay onward, and `base`
  // because a branch of this machine names nothing there (it drops both too).
  const sendToMachine = async (prompt: string, options: StartAgentOptions, id: string, project: { id: string; name: string; address: string; cwd?: string }): Promise<StartAgentResult> => {
    const { machine: _id, base: _thisMachines, prBase: _thisMachinesToo, repos: _folders, ...forwarded } = options
    const machine = (await listMachines(env)).find(saved => saved.id === id)
    if (!machine) return { ok: false, error: 'That machine is no longer saved. Pick another place to run.' }
    const target = targetOf(machine, project.address)
    // Another person's computer: a run there uses this person's own logins, which this server
    // copies there first. Only a server's OpenAgent copies: a laptop's logins are made for it
    // alone, so a laptop only looks that they are there.
    if (machine.owner !== undefined) {
      // Copied only once the person read that they are, and said OK: the page says so before a first run there.
      if (env.OPENAGENT_SERVER === '1' && machine.told !== true) return { ok: false, error: `Your own logins are used on ${machine.owner}'s computer for a run there: say OK to that above the message box first.` }
      const there = env.OPENAGENT_SERVER === '1' ? await copyLoginsTo({ ...target, label: machine.label }, { own: () => logins(env) }) : await loginsAreThere({ ...target, label: machine.label })
      if (!there.ok) return there
    }
    const result = await startRemoteAgent(target, { prompt, options: forwarded })
    if (!result.ok) {
      // A machine from before sessions with no project could go there knows no project by that name: nothing to clone.
      if ('noProject' in result && project.address === SESSIONS_ID) return { ok: false, error: `${machine.label} runs an older OpenAgent, which takes no session with no project. Update it, or pick a project.` }
      // The one refusal the page can do something about: it has the machine clone the project, and starts again.
      return 'noProject' in result ? { ok: false, error: `${project.name} is not on ${machine.label} yet.`, notThere: true } : result
    }
    // The run's id is the machine's word, and from here on every call about that id goes to the
    // machine: what the person reads of the run, and what they click and type in its browser.
    // An id that is no run's, or that is a run of this computer's own, is not taken.
    if (!isRunId(result.agentId) || (project.cwd !== undefined && (await findCheckout(project.cwd, result.agentId, projectBranches)))) {
      return { ok: false, error: `${machine.label} answered with a run this computer cannot follow.` }
    }
    return followSent(result.agentId, result.driver, prompt, machine, target, project.id, project.cwd)
  }

  // A run this computer sent to a machine, followed from here as a run of the project.
  const followSent = async (agentId: string, driver: unknown, prompt: string, machine: MachineRecord, target: RemoteTarget, project: string, cwd?: string): Promise<StartAgentResult> => {
    // A relayed agent has no local checkout or pid, so its list row is a memory-only stub (#1077):
    // registered here so onAgents can show it and a dashboard reload re-opens it. Never written to disk.
    const now = new Date().toISOString()
    // Whose run it is: this computer's git user, as the record the machine writes will say of its own.
    const person = await gitUserOf(cwd ?? sessionsHome(env))
    const meta: AgentMeta = {
      status: 'running',
      id: agentId,
      startedAt: now,
      updatedAt: now,
      target: 'remote',
      intent: prompt,
      ...(person !== undefined ? { person } : {}),
      ...onMachine(machine),
      // The machine's word, as the run is: its record, which names the coding agent, never comes here.
      ...(typeof driver === 'string' && driver.length <= MAX_DRIVER_NAME ? { driver } : {}),
    }
    remote.followSent(agentId, target, meta, project)
    // Only what was checked goes on to the page, not whatever else the machine answered.
    return { ok: true, agentId, ...(meta.driver !== undefined ? { driver: meta.driver } : {}) }
  }

  // A project only another computer of the person's has (elsewhere.ts). On that computer, the run
  // starts there as its own page starts one: in the project as it stands there, from the branch
  // picked among its own. On this computer, in its copy here once there is one: the page has it
  // cloned when there is none, and is told the project the run started in. On any other, as a
  // project of this computer's is sent there, by its address.
  const startElsewhere = async (prompt: string, options: StartAgentOptions, id: string): Promise<StartAgentResult> => {
    const at = await remote.elsewhereAt(id)
    if (!at) return { ok: false, error: 'That project is no longer listed on any of your computers.' }
    const { home, target } = at
    const { address, name } = home.project
    if (options.machine === home.machine.id) {
      const { machine: _there, ...there } = options
      const said = await relayRpc(target, 'sendStart', [null, prompt, there]).then(
        answer => answer as StartAgentResult,
        (err: unknown): StartAgentResult => ({ ok: false, error: `could not reach ${home.machine.label}: ${err instanceof Error ? err.message : String(err)}` }),
      )
      if (!said.ok) return { ok: false, error: typeof said.error === 'string' ? said.error : `${home.machine.label} did not start the run.` }
      if (!isRunId(said.agentId)) return { ok: false, error: `${home.machine.label} answered with a run this computer cannot follow.` }
      return followSent(said.agentId, said.driver, prompt, home.machine, target, id)
    }
    if (address === undefined) return { ok: false, error: `${name} has no repository address, so it runs on ${home.machine.label} only.` }
    if (options.machine === undefined) {
      const here = await projectAt(address)
      if (here === undefined) return { ok: false, error: `${name} is not on this computer yet.`, notThere: true }
      const started = await onStart(prompt, options, here)
      return started.ok ? { ...started, projectId: here } : started
    }
    return sendToMachine(prompt, options, options.machine, { id, name, address })
  }

  // Add a project (#396): install the repo, then register it so it appears in the Projects
  // list. installProject is idempotent (an already-activated repo is a no-op success). `share`
  // is the person's answer on the agents' records, written before the project is registered:
  // the first sync of a project added with `false` sends nothing. No answer leaves the
  // repository's own as it is: one never asked reads as kept, and a yes given before stays a yes.
  const onAddProject = async (path: string, share?: boolean): Promise<AddProjectResult> => {
    // Resolve relative input against the daemon cwd, and check the directory really
    // exists first: without this a bad path reaches git as a missing cwd, which
    // surfaces as the confusing "spawn git ENOENT" rather than a path error.
    const abs = resolve(path)
    const isDir = await stat(abs).then(s => s.isDirectory()).catch(() => false)
    if (!isDir) return { ok: false, error: `path does not exist or is not a directory: ${abs}` }
    const result = await installProject(abs)
    if (!result.ok) return { ok: false, error: result.error }
    // A yes is to the remote that is there: with none the records are kept, so a remote the
    // project gets later is asked about, in the project's menu, before anything goes to it.
    const shared = share === true && (await hasRemote(abs))
    if (share !== undefined) {
      const written = await writeSharing(abs, shared).then(() => undefined, (err: unknown) => (err instanceof Error ? err.message : String(err)))
      if (written !== undefined) return { ok: false, error: written }
    }
    // Each package that writes hook lines writes its own (the built-in runner's start, resume and
    // check among them), so the new project starts an agent with nothing typed by hand. A writer
    // keeps every line already there, so adding a project again only fills what is missing.
    for (const failed of await writeHookLines(abs)) console.log(`[openagent] hook lines (${abs}): ${failed}`)
    await addProject(abs, new Date().toISOString(), env).catch(() => {})
    // The project's open hooks (#1774): a project added while the daemon runs is a project the
    // boot never saw, so its open lines run now, the way they would have at boot.
    await runProjectHooks(abs, 'open', { log: console.log })
    return { ok: true, alreadyActivated: result.alreadyActivated === true, ...(share && !shared ? { noRemote: true as const } : {}) }
  }

  const onStartedIn = async (folder: string): Promise<StartedInResult> => {
    const path = resolve(folder)
    const holding = (await listProjects(env)).find(project => path === project.path || path.startsWith(project.path + sep))
    if (!holding) {
      const added = await onAddProject(path)
      if (!added.ok) return added
    }
    const id = holding?.id ?? projectId(path)
    // The address the page writes: by the projects it lists, those whose folder is there, in the
    // registry's order. A module's page words are the browser's alone, so a folder named as one
    // (`logs`) is printed by its name where the page shows its id; both open it.
    const listed = await listProjects(env)
    const present = await Promise.all(listed.map(async project => ((await stat(project.path).then(s => s.isDirectory(), () => false)) ? [project.id] : [])))
    return { ok: true, id, path: holding?.path ?? path, added: !holding, address: projectAddresses(present.flat(), []).addressOf(id) }
  }

  // A project another machine asks for, to send a run here (the machine side of "Run on"): cloned
  // from its address with this computer's own logins and added like any other, once, by itself.
  // The asking machine is answered at once and asks again: a clone can take minutes, and no call
  // is held open that long. What is kept is only what is on its way and how the last try failed,
  // by address; a project that is there is read off the list.
  const coming = new Map<string, { error?: string }>()
  const bringProject = async (address: string, bring?: BringProject): Promise<RelayProject> => {
    const onItsWay = coming.get(address)?.error === undefined && coming.has(address)
    if ((await projectAt(address)) !== undefined) return { state: 'there' }
    // It landed while the list was read: the list is read once more, not taken for missing.
    if (onItsWay && !coming.has(address) && (await projectAt(address)) !== undefined) return { state: 'there' }
    const now = coming.get(address)
    if (now && now.error === undefined) return { state: 'coming' }
    if (!bring) return now?.error !== undefined ? { state: 'failed', error: now.error } : { state: 'missing' }
    // Only what reads as an address, and as this very one: the project is found again by it. The
    // asking machine's own spelling of it is what is cloned when it is the same `host/path` in
    // other letters, and nothing more: no way in, user or port of the caller's choosing.
    if (cloneTarget(address)?.address !== address) return { state: 'failed', error: `${address.slice(0, 80)} is not a repository's address.` }
    const from = bring.from !== undefined && bring.from.toLowerCase() === address ? bring.from : address
    const atWork = [...coming.values()].filter(entry => entry.error === undefined).length
    if (atWork >= MAX_COMING) return { state: 'failed', error: 'This machine is cloning other projects. Send again in a few minutes.' }
    // The failures kept are the last few: one per address a machine ever asked for would grow for ever.
    for (const [failed, entry] of coming) if (coming.size >= MAX_KEPT && entry.error !== undefined) coming.delete(failed)
    const entry: { error?: string } = {}
    coming.set(address, entry)
    void (async () => {
      const cloned = await clone(from)
      const added = cloned.ok ? await onAddProject(cloned.path, bring.share) : cloned
      if (added.ok) coming.delete(address)
      else entry.error = added.error.slice(0, MAX_REASON)
    })().catch((err: unknown) => {
      entry.error = (err instanceof Error ? err.message : String(err)).slice(0, MAX_REASON)
    })
    return { state: 'coming' }
  }

  // Remove a project: it leaves the Projects list and nothing in its folder is deleted. Found in
  // the list by its id and not through its folder, so a project whose folder is gone goes too.
  const onRemoveProject = async (id: string, files = false): Promise<RemoveProjectResult> => {
    const listed = await listProjects(env)
    const record = listed.find(project => project.id === id)
    if (!record) return { ok: false, error: 'no project with that id is on the list' }
    const here = await stat(record.path).then(s => s.isDirectory()).catch(() => false)
    if (here) {
      // The checkouts are read fresh: a run started a moment ago must be seen.
      projectBranches.changed(record.path)
      // An agent at work would go on working in a project the dashboard no longer shows. A card
      // left "running" by a process that died does not count: nothing is working there.
      const working = (await readLiveMetas(record.path).catch(() => [])).some(
        agent => agent.status === 'running' && agent.pid !== undefined && agent.host === hostname() && isPidAlive(agent.pid),
      )
      if (working) return { ok: false, error: 'An agent is working in this project. Stop it, then remove the project.' }
      // The project's close hooks, the ones a shutdown would have run for it: once it is off the
      // list no shutdown names it, and what its open hooks started (a scheduler) would run on.
      await runProjectHooks(record.path, 'close', { log: console.log })
    }
    await removeProject(id, env)
    providedDataChanged(record.path)
    if (!files || !here) return { ok: true }
    // Off the list first, so no background job of this daemon starts on the folder again; then
    // what OpenAgent left in it. The records are the repository's: while another project on the
    // list is a checkout of the same repository, or a clone of it whose records the personal
    // folder keeps in the same directory, they stay.
    const repository = await fileBranchRepo(record.path)
    const key = await projectKey(repository ?? record.path)
    let recordsUsedBy: string | undefined
    for (const other of listed) {
      if (other.id === id) continue
      const otherRepository = await fileBranchRepo(other.path)
      if ((repository !== undefined && otherRepository === repository) || (await projectKey(otherRepository ?? other.path)) === key) recordsUsedBy = other.path
    }
    const cleanup = await removeProjectFiles(record.path, { recordsUsedBy })
    providedDataChanged(record.path)
    return { ok: true, cleanup }
  }

  // Tail a relay-started run's own log (#1067) for the `/_relay/events` endpoint: the diary the
  // run's tool keeps, its lines turned into events. The relocating tail, for the same reason as
  // the dashboard's onEvents: the diary becomes the finished run's when the run ends.
  const tailRelayEvents = (project: string, agentId: string, onEvent: (event: OpenAgentEvent) => void): (() => void) =>
    tailAgentEvents<AnyDiaryLine>(
      async () => {
        const projectCwd = await resolveProject(project)
        return projectCwd ? resolveAgentDiary(projectCwd, agentId) : undefined
      },
      line => {
        const event = fromDiaryLine(line)
        if (event) onEvent(event)
      },
    )

  // A screen lives while its run has a checkout: a finished run's diary names none that answers,
  // so it is not read. Asked of the shared list only: a tab open on a run asks every few seconds.
  const screenOf = async (project: string, agentId: string): Promise<string | undefined> => {
    const projectCwd = await resolveProject(project)
    const checkout = projectCwd ? await findCheckout(projectCwd, agentId, projectBranches, { cached: true }) : undefined
    return checkout ? screenInDiary(join(checkout.path, OPENAGENT_DIR, `${agentId}.jsonl`)) : undefined
  }

  // A Start is near: the launcher opened, or its agent changed. The naming session that run will
  // take is started now, while the person types, unless one already waits.
  const onPrepareStart = (targetProjectId: string, driver?: string): void => {
    if (naming === undefined || isElsewhereId(targetProjectId)) return
    const picked = driver ?? DEFAULT_DRIVER
    if (!isDriverName(picked)) return
    void (async () => {
      if ((await readPreferences(env)).nameRuns === false) return
      const projectCwd = await resolveProject(targetProjectId)
      if (projectCwd) await naming.prepare(projectCwd, picked)
    })()
  }

  const dispose = async (): Promise<void> => {
    remote.dispose()
    await naming?.close()
  }

  return { onStart, onAddProject, onStartedIn, onRemoveProject, onPrepareStart, remoteEventsSource: remote.events, projectAt, bringProject, tailRelayEvents, remoteAgents: remote.agents, screenOf, dispose }
}
