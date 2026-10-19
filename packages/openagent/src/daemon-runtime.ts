import { basename, join, resolve, sep } from 'node:path'
import { hostname } from 'node:os'
import { stat } from 'node:fs/promises'
import { findAgent, findCheckout, fromDiaryLine, isPidAlive, isRunId, projectBranches, readLiveMetas, resolveAgentDiary, type AgentMeta, type AnyDiaryLine } from './store/index.js'
import { OPENAGENT_DIR } from './openagent-dir.js'
import type { OpenAgentEvent } from './events.js'
import type { StartAgentOptions, StartAgentResult, AddProjectResult, RemoveProjectResult, StartedInResult } from './dashboard/index.js'
import type { EventsSource, RemoteAgents, SavedMachine } from './dashboard/rpc-serve.js'
import { RelayedAgents, remoteFacts, startRemoteAgent, type BringProject, type RelayProject, type RemoteTarget } from './dashboard/remote-run.js'
import { cloneProject, cloneTarget } from './clone-project.js'
import { copyLoginsTo, loginsAreThere, ownLogins, type OwnLogins } from './dashboard/copy-logins.js'
import { screenInDiary } from './dashboard/screen.js'
import { dispatchRelayRpc } from './dashboard-rpc/relay-dispatch.js'
import { asRecorded, onMachine } from './dashboard-rpc/reads.js'
import { tailAgentEvents } from './dashboard-rpc/events-tail.js'
import { addProject, isHostName, listMachines, listProjects, nameMachine, projectId, readPreferences, removeProject, type MachineRecord, type Preferences } from './registry.js'
import { repositoryAddress } from './repository-address.js'
import { writeHookLines } from './built-in.js'
import { fileBranchRepo, installProject, writeSharing } from '@openagt/agent-data'
import { removeProjectFiles } from './remove-files.js'
import { runProjectHooks, runStartHook } from './project-hooks.js'
import { publishLevelOf, publishPickIn } from './publish-levels.js'
import { isBranchName } from './branch-name.js'
import { hasRemote } from './has-remote.js'
import { projectGitHost } from './store/git-host.js'
import { providedDataChanged } from './store/provided.js'
import { projectAddresses } from './project-address.js'

/**
 * What the daemon does for a project (#393): start a run, add a project, and relay a run to and
 * from a saved machine. Split from daemon.ts so that file reads as the daemon's lifecycle
 * (state file, ports, boot, shutdown). The daemon runs no agent itself (#1774): a Start is the
 * project's own `start` hook line, and the run it begins belongs to whatever tool that line names.
 */

/** How long a project folder's repository address is trusted before git is asked again. */
const ADDRESS_KEPT_MS = 10_000

/** How long a coding agent's name may be that another machine answers: a row shows it. */
const MAX_DRIVER_NAME = 64

/** How soon a machine that did not say its own name is asked again. */
const HOST_ASKED_AGAIN_MS = 30_000
/** How long a list waits for a machine that never said its name: a machine that is down does not hold a page. */
const HOST_WAIT_MS = 1_500
/** How long the machine a run runs on is kept: a run's reads ask every few seconds. */
const HOME_KEPT_MS = 10_000
/** How long a run is kept as this computer's own: its record never names another computer later, and a day is long enough not to ask again. */
const OWN_KEPT_MS = 24 * 60 * 60_000
/** How many runs' machines are kept before the memory starts over. */
const MAX_HOMES = 5_000

/** How many projects this computer clones at once for other machines; one more is told to ask again. */
const MAX_COMING = 3
/** How many clones are remembered at once, on their way or failed. */
const MAX_KEPT = 32
/** How much of a failed clone's reason is kept and told: git passes on what the other side said. */
const MAX_REASON = 600

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
}

/** The per-project surface the dashboard drives, plus its teardown. */
export interface ProjectRuntime {
  onStart: (prompt: string, options?: StartAgentOptions, targetProjectId?: string) => Promise<StartAgentResult>
  onAddProject: (path: string, share: boolean) => Promise<AddProjectResult>
  /**
   * The folder `openagent` was started in: the listed project that holds it, so starting again
   * inside a project, or inside one of its folders, adds nothing; else the folder, added as Add
   * project adds one. Asked in-process by the daemon that starts there, and over RPC (`sendStartedAgain`) by
   * a second `openagent` that finds the dashboard running already.
   */
  onStartedIn: (folder: string) => Promise<StartedInResult>
  onRemoveProject: (projectId: string, files?: boolean) => Promise<RemoveProjectResult>
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
  /** The machine side of the relay (#1067 slice 2): run one whitelisted read/steer/handoff RPC against
   *  this daemon's own copy of the project, for a daemon that relayed an agent here. */
  onRelayRpc: (projectId: string, fn: string, args: unknown[]) => Promise<unknown>
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
export function createProjectRuntime({ cwd, env, clone = cloneProject, logins = ownLogins }: ProjectRuntimeOptions): ProjectRuntime {
  const homeId = projectId(resolve(cwd))
  // Runs this daemon is relaying to/from a saved machine (#1067): the local half of a remote agent.
  const relayedAgents = new RelayedAgents()
  // Each saved machine's own computer name: what the records of its runs carry, so a run that came
  // through a project's shared records is known as that machine's. A machine says it in its ping,
  // and it is kept with the machine as first said. One that has not said it yet is asked, not
  // more often than every half minute, and a list waits for it only the first time, and not long.
  let machines: MachineRecord[] = []
  const asked = new Map<string, number>()
  let asking: Promise<void> | undefined
  const askNames = (unnamed: MachineRecord[]): Promise<void> =>
    (asking ??= Promise.all(
      unnamed.map(async machine => {
        asked.set(machine.url, Date.now())
        const { host } = await remoteFacts(machine).catch((): { host?: string } => ({}))
        if (host !== undefined) await nameMachine(machine, host, undefined, env).catch(() => false)
      }),
    ).then(
      () => void (asking = undefined),
      () => void (asking = undefined),
    ))
  const machineNames = async (): Promise<(host: string) => SavedMachine | undefined> => {
    // A list that could not be read keeps the last one: a read that fails once does not hand a machine's runs back to this computer.
    const read = async (): Promise<void> => void (machines = await listMachines(undefined, env).catch(() => machines))
    await read()
    for (const url of asked.keys()) if (!machines.some(machine => machine.url === url)) asked.delete(url)
    const now = Date.now()
    const unnamed = machines.filter(machine => machine.host === undefined && now - (asked.get(machine.url) ?? 0) > HOST_ASKED_AGAIN_MS)
    if (unnamed.length > 0) {
      const first = unnamed.some(machine => !asked.has(machine.url))
      const said = askNames(unnamed)
      if (first) {
        await Promise.race([said, new Promise(resolvePromise => setTimeout(resolvePromise, HOST_WAIT_MS).unref())])
        await read()
      }
    }
    return host => {
      const machine = machineOf(host)
      return machine && { label: machine.label, url: machine.url }
    }
  }
  // A name two saved machines say is no machine's: neither gets the other's runs by saying it.
  const machineOf = (host: string): MachineRecord | undefined => {
    const named = machines.filter(machine => machine.host === host)
    return named.length === 1 ? named[0] : undefined
  }

  // The machine a run runs on. A run this computer sent is known by what was kept at its start.
  // Any other is known by its record: the computer it names is this one, a saved machine, or
  // someone else's, and only a saved machine's run is that machine's to be asked about. A run is
  // looked up in its own project, and what is kept is kept by project and run: an id alone says
  // nothing of the project, and a record in one project does not speak for a run of another.
  const homes = new Map<string, { home?: { target: RemoteTarget; label: string }; until: number }>()
  const homeOf = async (project: string, agentId: string): Promise<{ target: RemoteTarget; label: string } | undefined> => {
    if (!isRunId(agentId)) return undefined
    const key = `${project} ${agentId}`
    const kept = homes.get(key)
    if (kept && kept.until > Date.now()) return kept.home
    const keep = (home: { target: RemoteTarget; label: string } | undefined, forMs: number): typeof home => {
      if (homes.size >= MAX_HOMES) homes.clear()
      homes.set(key, { ...(home ? { home } : {}), until: Date.now() + forMs })
      return home
    }
    const projectCwd = await resolveProject(project)
    const agent = projectCwd ? await findAgent(projectCwd, agentId).catch(() => undefined) : undefined
    // No record yet: nothing is known, and it is asked again.
    if (!projectCwd || !agent) return undefined
    // A run's computer never changes: this one's own, and one whose record names none, is not looked up again.
    if (!isHostName(agent.host) || agent.host === hostname()) return keep(undefined, OWN_KEPT_MS)
    await machineNames()
    const machine = machineOf(agent.host)
    const address = machine ? await addressOf(projectCwd) : undefined
    if (!machine || address === undefined) return keep(undefined, HOME_KEPT_MS)
    return keep({ target: { url: machine.url, key: machine.key, ...(machine.pin ? { pin: machine.pin } : {}), project: address }, label: machine.label }, HOME_KEPT_MS)
  }

  // The relayed-agent lookup the dashboard's read RPCs consult (#1067 slice 2): is this agentId remote, and
  // which machine owns it. Outlives the event stream so a finished remote agent's push/PR still reaches it.
  const remoteAgents: RemoteAgents = {
    target: (agentId, project) => relayedAgents.target(agentId, project),
    list: projectId => relayedAgents.list(projectId),
    working: url => relayedAgents.working(url),
    rekey: (url, key, pin) => {
      relayedAgents.rekey(url, key, pin)
      homes.clear()
    },
    home: async (project, agentId) => relayedAgents.target(agentId, project) ?? (await homeOf(project, agentId))?.target,
    follow: async (project, agentId) => {
      // An id kept as a run of another project, followed now or not, is not taken over by a record in this one.
      const elsewhere = (): boolean => relayedAgents.target(agentId) !== undefined && relayedAgents.target(agentId, project) === undefined
      if (relayedAgents.follows(agentId) || elsewhere()) return
      const home = await homeOf(project, agentId)
      const projectCwd = home ? await resolveProject(project) : undefined
      const agent = projectCwd ? await findAgent(projectCwd, agentId).catch(() => undefined) : undefined
      if (!home || !agent || relayedAgents.follows(agentId) || elsewhere()) return
      // The row starts as the record may say the run is, and the machine's own events take it from there.
      // Its cost is counted again from what the machine says, from the run's first line on.
      const { cost: _counted, ...said } = asRecorded(agent)
      relayedAgents.register(agentId, home.target, { ...said, target: 'remote', ...onMachine({ label: home.label, url: home.target.url }) }, project, false)
    },
    sent: agentId => relayedAgents.isSent(agentId),
    machineNames,
  }
  // The machine side of the relay (#1067 slice 2): run one whitelisted read/steer/handoff RPC against this
  // daemon's own copy of the project the call named, for a daemon that relayed an agent here.
  const onRelayRpc = (project: string, fn: string, args: unknown[]): Promise<unknown> => dispatchRelayRpc(project, fn, args)

  // A project id resolves to its repo path via the registry; the home id (or none)
  // resolves to the daemon's own `cwd` without a lookup.
  const resolveProject = async (id: string | undefined): Promise<string | undefined> => {
    if (!id || id === homeId) return cwd
    const records = await listProjects(undefined, env).catch(() => [])
    return records.find(record => record.id === id)?.path
  }

  // The project here that a relayed call names by its repository's address: the first on the list
  // cloned from it, every time, so a run's later calls reach the project it started in. A folder's
  // address is kept for a few seconds, so a run's reads, which poll, do not ask git about every
  // project each time. Only an address is kept: a folder that had none is asked again.
  const addresses = new Map<string, { address: string; until: number }>()
  const addressOf = async (path: string): Promise<string | undefined> => {
    const kept = addresses.get(path)
    if (kept && kept.until > Date.now()) return kept.address
    const address = await repositoryAddress(path)
    if (address === undefined) addresses.delete(path)
    else addresses.set(path, { address, until: Date.now() + ADDRESS_KEPT_MS })
    return address
  }
  const projectAt = async (address: string): Promise<string | undefined> => {
    for (const record of await listProjects(undefined, env).catch(() => [])) {
      if ((await addressOf(record.path)) === address) return record.id
    }
    return undefined
  }

  // Start (#1774): the project's own `start` hook line, which answers the id of the run it began.
  // The daemon names no tool and holds nothing about the run: no slot, no cap (a person's click is
  // the brake), no process to stop at shutdown. A project without the line cannot start a run here.
  const onStart = async (prompt: string, options: StartAgentOptions = {}, targetProjectId?: string): Promise<StartAgentResult> => {
    const projectCwd = await resolveProject(targetProjectId)
    if (!projectCwd) return { ok: false, error: `unknown project: ${targetProjectId}` }
    // Run on a saved machine (#1067): forward the start to its daemon, which runs the hook of its
    // own copy of this project, and relay the run's events back. The project is named by its
    // repository's address, the one name both machines have for it. `machine` is stripped so the
    // other side does not relay onward, and `base` because a branch of this machine names nothing
    // there (it drops both too).
    if (options.machine !== undefined) {
      const { machine: id, base: _thisMachines, ...forwarded } = options
      const machine = (await listMachines(undefined, env)).find(saved => saved.id === id)
      if (!machine) return { ok: false, error: 'That machine is no longer saved. Pick another place to run.' }
      const project = await repositoryAddress(projectCwd)
      if (!project) return { ok: false, error: 'This project has no repository address, so it cannot be sent to another machine.' }
      const target = { url: machine.url, key: machine.key, ...(machine.pin ? { pin: machine.pin } : {}), project }
      // Another person's computer: a run there uses this person's own logins, which this server
      // copies there first. Only a server's OpenAgent copies: a laptop's logins are made for it
      // alone, so a laptop only looks that they are there.
      if (machine.owner !== undefined) {
        // Copied only once the person read that they are, and said OK: the page says so before a first run there.
        if (env.OPENAGENT_SERVER === '1' && machine.told !== true) return { ok: false, error: `Your logins are copied to @${machine.owner}'s server for a run there: say OK to that above the message box first.` }
        const there = env.OPENAGENT_SERVER === '1' ? await copyLoginsTo({ ...target, label: machine.label }, { own: () => logins(env) }) : await loginsAreThere({ ...target, label: machine.label })
        if (!there.ok) return there
      }
      const result = await startRemoteAgent(target, { prompt, options: forwarded })
      if (!result.ok) {
        // The one refusal the page can do something about: it has the machine clone the project, and starts again.
        return 'noProject' in result ? { ok: false, error: `${basename(projectCwd)} is not on ${machine.label} yet.`, notThere: true } : result
      }
      // The run's id is the machine's word, and from here on every call about that id goes to the
      // machine: what the person reads of the run, and what they click and type in its browser.
      // An id that is no run's, or that is a run of this computer's own, is not taken.
      if (!isRunId(result.agentId) || (await findCheckout(projectCwd, result.agentId, projectBranches))) {
        return { ok: false, error: `${machine.label} answered with a run this computer cannot follow.` }
      }
      // A relayed agent has no local checkout or pid, so its list row is a memory-only stub (#1077):
      // registered here so onAgents can show it and a dashboard reload re-opens it. Never written to disk.
      const now = new Date().toISOString()
      const meta: AgentMeta = {
        status: 'running',
        id: result.agentId,
        startedAt: now,
        updatedAt: now,
        target: 'remote',
        intent: prompt,
        ...onMachine(machine),
        // The machine's word, as the run is: its record, which names the coding agent, never comes here.
        ...(typeof result.driver === 'string' && result.driver.length <= MAX_DRIVER_NAME ? { driver: result.driver } : {}),
      }
      relayedAgents.register(result.agentId, target, meta, targetProjectId ?? homeId)
      // Only what was checked goes on to the page, not whatever else the machine answered.
      return { ok: true, agentId: result.agentId, ...(meta.driver !== undefined ? { driver: meta.driver } : {}) }
    }
    // The branch to start from ends up on the line's command line: only a branch name goes there.
    // Refused, not dropped: a run started from the main branch instead would be a silent swap.
    if (options.base !== undefined && !isBranchName(options.base)) return { ok: false, error: `not a branch name: ${String(options.base)}` }
    // The pick in force is decided here, so every Start goes the same way whichever page sent it:
    // with none saved the run commits and pushes nothing, and with one the project is not offered
    // it goes as far as the project does with no pull request: its branch pushed, or its work
    // committed where there is no remote.
    const publish = publishLevelOf(publishPickIn(options.publish, (await projectGitHost(projectCwd).catch(() => undefined)) !== undefined, await hasRemote(projectCwd)))
    // Named unless the person turned naming off: read here rather than sent from the page, so a
    // run a schedule starts is named exactly as one a person starts is.
    const nameRun = (await readPreferences(undefined, env).catch((): Preferences => ({}))).nameRuns !== false
    const started = await runStartHook(projectCwd, {
      prompt,
      ...(nameRun ? {} : { nameRun: false }),
      ...(options.driver !== undefined ? { driver: options.driver } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.effort !== undefined ? { effort: options.effort } : {}),
      ...(options.then !== undefined ? { then: options.then } : {}),
      ...(publish !== undefined ? { publish } : {}),
      ...(options.base !== undefined ? { base: options.base } : {}),
    })
    // The line made a checkout (or is about to): the project's checkouts are read again on the
    // next look rather than a few seconds from now, so the new run's page finds its own.
    if (started.ok) projectBranches.changed(projectCwd)
    return started.ok ? { ok: true, agentId: started.id, ...(started.driver !== undefined ? { driver: started.driver } : {}) } : { ok: false, error: started.error }
  }

  // Add a project (#396): install the repo, then register it so it appears in the Projects
  // list. installProject is idempotent (an already-activated repo is a no-op success). `share`
  // is the person's answer on the agents' records, written before the project is registered:
  // the first sync of a project added with `false` sends nothing.
  const onAddProject = async (path: string, share: boolean): Promise<AddProjectResult> => {
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
    const shared = share && (await hasRemote(abs))
    const written = await writeSharing(abs, shared).then(() => undefined, (err: unknown) => (err instanceof Error ? err.message : String(err)))
    if (written !== undefined) return { ok: false, error: written }
    // Each package that writes hook lines writes its own (the built-in runner's start, resume and
    // check among them), so the new project starts an agent with nothing typed by hand. A writer
    // keeps every line already there, so adding a project again only fills what is missing.
    for (const failed of await writeHookLines(abs)) console.log(`[openagent] hook lines (${abs}): ${failed}`)
    await addProject(abs, new Date().toISOString(), undefined, env).catch(() => {})
    // The project's open hooks (#1774): a project added while the daemon runs is a project the
    // boot never saw, so its open lines run now, the way they would have at boot.
    await runProjectHooks(abs, 'open', { log: console.log })
    return { ok: true, alreadyActivated: result.alreadyActivated === true, ...(share && !shared ? { noRemote: true as const } : {}) }
  }

  const onStartedIn = async (folder: string): Promise<StartedInResult> => {
    const path = resolve(folder)
    const holding = (await listProjects(undefined, env).catch(() => [])).find(project => path === project.path || path.startsWith(project.path + sep))
    if (!holding) {
      const added = await onAddProject(path, false)
      if (!added.ok) return added
    }
    const id = holding?.id ?? projectId(path)
    // The address the page writes: by the projects it lists, those whose folder is there, in the
    // registry's order. A module's page words are the browser's alone, so a folder named as one
    // (`logs`) is printed by its name where the page shows its id; both open it.
    const listed = await listProjects(undefined, env).catch(() => [])
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
    const listed = await listProjects(undefined, env).catch(() => [])
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
    await removeProject(id, undefined, env)
    providedDataChanged(record.path)
    if (!files || !here) return { ok: true }
    // Off the list first, so no background job of this daemon starts on the folder again; then
    // what OpenAgent left in it. The records are the repository's: while another project on the
    // list is a checkout of the same repository, they stay.
    const repository = await fileBranchRepo(record.path)
    let recordsUsedBy: string | undefined
    for (const other of listed) {
      if (other.id !== id && repository !== undefined && (await fileBranchRepo(other.path)) === repository) recordsUsedBy = other.path
    }
    const cleanup = await removeProjectFiles(record.path, { recordsUsedBy })
    providedDataChanged(record.path)
    return { ok: true, cleanup }
  }

  // The dashboard's events source (#1067): a stream for an agent this daemon is relaying from a machine,
  // else undefined so `onEvents` tails the on-disk log as usual for an ordinary local agent.
  const remoteEventsSource: EventsSource = (projectId, agentId) => relayedAgents.get(agentId, projectId)

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

  const dispose = async (): Promise<void> => {
    relayedAgents.dispose()
  }

  return { onStart, onAddProject, onStartedIn, onRemoveProject, remoteEventsSource, projectAt, bringProject, tailRelayEvents, remoteAgents, onRelayRpc, screenOf, dispose }
}
