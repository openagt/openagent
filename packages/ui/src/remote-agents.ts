import { hostname } from 'node:os'
import { findAgent, isRunId, type AgentMeta } from './store/index.js'
import type { EventsSource, RemoteAgents, SavedMachine } from './dashboard-rpc/context.js'
import { RelayedAgents, machineCall, relayRpc, remoteFacts, targetOf, type RemoteTarget } from './dashboard/remote-run.js'
import { OwnProjectsAsked, elsewhereHomes, elsewhereId, elsewhereSummary, homeOf as elsewhereHomeOf, isElsewhereId, lineNameOf, type ElsewhereHome, type OwnProject } from './dashboard/elsewhere.js'
import { AnswersKept, interventionsOf, namedHere, type MachinesQueue } from './dashboard/machine-interventions.js'
import type { Intervention } from './dashboard/interventions.js'
import type { ProjectSummary, ProjectionRead } from './dashboard/projects.js'
import { MachineRunsKept, RUNS_WAIT_MS, type MachineRuns } from './dashboard/machine-runs.js'
import { asRecorded, onMachine } from './dashboard/run-rows.js'
import { isHostName, listMachines, listProjects, machineNamed, nameMachine, noteProjects, noteSeen, noteServer, type MachineRecord } from './registry.js'
import { callerAtPage } from './dashboard/person.js'
import { machineKind, machineName } from './reached-by-line.js'

/**
 * What this computer knows of the runs and projects on the person's other computers, the saved
 * machines, and the runs it follows there (#1067): the {@link RemoteAgents} lookup the dashboard's
 * RPCs consult, so a read or a press about a run on a machine goes to that machine. The daemon's
 * project runtime (daemon-runtime.ts) makes it, and hands it what it knows of its own projects:
 * their folders by id, and the addresses they are cloned from, which every machine names them by.
 */

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
/** How long a machine gets to say its runs once it stops holding the call: a page is answered with what it said before meanwhile. */
const RUNS_ASKED_MS = 8_000
/** How often the machines' runs of a project someone listens to are asked for again, to keep them followed (machine-runs.ts follows them a minute). */
const RUNS_FOLLOWED_MS = 30_000

/** How long one of the person's computers gets to say its projects: a list does not wait on it past the first time (elsewhere.ts). */
const PROJECTS_ASKED_MS = 8_000
/** How long one of the person's computers gets to say its Human Queue: its PRs are asked of the git host (machine-interventions.ts). */
const QUEUE_ASKED_MS = 15_000

/** Inputs to {@link createRemoteAgents}. */
export interface RemoteAgentsOptions {
  /** Env for the registry lookups. */
  env: NodeJS.ProcessEnv
  /** A project's folder here by its id; undefined for no project here. */
  resolveProject: (id: string) => Promise<string | undefined>
  /** The repository address a project's folder is cloned from, by which every machine names the project. */
  addressOf: (path: string) => Promise<string | undefined>
  /** Where this computer's copy of the project at an address stands; with `bring`, cloned here when there is none. */
  bringHere: RemoteAgents['bringHere']
}

/** The lookup, and what the project runtime does with the runs it follows on a machine. */
export interface RemoteAgentsRuntime {
  /** The lookup the dashboard's RPCs consult. */
  agents: RemoteAgents
  /** The live event stream of a run followed here from its machine, else undefined so `onEvents` tails the run's diary off disk. */
  events: EventsSource
  /** Follow a run this computer sent to a machine: its row is `meta` until the machine's own events say more. */
  followSent: (agentId: string, target: RemoteTarget, meta: AgentMeta, projectId: string) => void
  /** Another computer's project by its id here, and how a call reaches it there. */
  elsewhereAt: (id: string) => Promise<{ home: ElsewhereHome<MachineRecord>; target: RemoteTarget } | undefined>
  /** Let go of every followed run, and stop following the machines' runs. */
  dispose: () => void
}

export function createRemoteAgents({ env, resolveProject, addressOf, bringHere }: RemoteAgentsOptions): RemoteAgentsRuntime {
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
        const { host, server } = await remoteFacts(machine).catch((): { host?: string; server?: true } => ({}))
        if (host === undefined) return
        await nameMachine(machine, host, env).catch(() => false)
        await noteServer(machine, server === true, env).catch(() => {})
      }),
    ).then(
      () => void (asking = undefined),
      () => void (asking = undefined),
    ))
  const machineNames = async (): Promise<(host: string) => SavedMachine | undefined> => {
    const read = async (): Promise<void> => void (machines = await listMachines(env))
    await read()
    for (const url of asked.keys()) if (!machines.some(machine => machine.url === url)) asked.delete(url)
    const now = Date.now()
    const due = machines.filter(machine => now - (asked.get(machine.url) ?? 0) > HOST_ASKED_AGAIN_MS)
    if (due.length > 0) {
      // A list waits only for a machine it knows no name of yet, and not long.
      const first = due.some(machine => machine.host === undefined && !asked.has(machine.url))
      const said = askNames(due)
      if (first) {
        await Promise.race([said, new Promise(resolvePromise => setTimeout(resolvePromise, HOST_WAIT_MS).unref())])
        await read()
      }
    }
    return host => {
      const machine = machineOf(host)
      return machine && { label: machine.label, url: machine.url, ...(machine.server ? { server: true } : {}) }
    }
  }
  // A name two saved machines say is no machine's: neither gets the other's runs by saying it.
  const machineOf = (host: string): MachineRecord | undefined => machineNamed(machines, host)

  // What each saved machine says of its own runs of a project (machine-runs.ts): asked over its
  // relay with this computer's key there, so a computer's runs read as they stand whether its
  // records are shared or not. When it last answered is kept with it, for while it does not.
  const savedAt = (url: string): MachineRecord | undefined => machines.find(machine => machine.url === url)
  const machineRunsKept = new MachineRunsKept(
    (machine, address, since) => {
      const saved = savedAt(machine.url)
      if (!saved) return Promise.reject(new Error('that machine is no longer saved'))
      // The machine holds the call until its runs change: it is given that long and a while more to answer.
      return relayRpc(targetOf(saved, address), 'onOwnRuns', [null, since ?? null, RUNS_WAIT_MS], RUNS_WAIT_MS + RUNS_ASKED_MS)
    },
    (machine, at) => {
      const saved = savedAt(machine.url)
      if (saved) void noteSeen(saved, at, env).catch(() => {})
    },
  )
  // The machines' runs of the project they name `address` (`#<id>` for one of a machine's own with no address), of the
  // ones `only` keeps: every saved machine for a project of this computer's, the one it is on for another computer's.
  const runsAt = async (address: string, only: (machine: MachineRecord) => boolean = () => true): Promise<MachineRuns[]> => {
    await machineNames()
    // A machine that has not said its computer's name, or says one another machine says too, has no runs to say.
    const asked = machines.flatMap(machine => (only(machine) && machine.host !== undefined && machineOf(machine.host) === machine ? [{ url: machine.url, host: machine.host, ...(machine.seenAt !== undefined ? { seenAt: machine.seenAt } : {}) }] : []))
    return asked.length > 0 ? machineRunsKept.of(asked, address) : []
  }
  const machineRuns = async (path: string): Promise<MachineRuns[]> => {
    const address = await addressOf(path)
    return address === undefined ? [] : runsAt(address)
  }
  const elsewhereRuns = async (id: string): Promise<MachineRuns[]> => {
    const at = await elsewhereAt(id)
    return at ? runsAt(at.target.project, machine => machine.url === at.home.machine.url) : []
  }
  // Followed while someone listens: asked for again before the machines stop being followed.
  const followRuns = (path: string, changed: () => void): (() => void) => followAt(() => addressOf(path), () => machineRuns(path), changed)
  const followElsewhereRuns = (id: string, changed: () => void): (() => void) =>
    followAt(async () => (await elsewhereAt(id))?.target.project, () => elsewhereRuns(id), changed)
  const followAt = (address: () => Promise<string | undefined>, read: () => Promise<MachineRuns[]>, changed: () => void): (() => void) => {
    let stopped = false
    let stopListening: (() => void) | undefined
    void address().then(said => {
      if (said !== undefined && !stopped) stopListening = machineRunsKept.listen(said, changed)
    })
    const keep = (): void => void read().catch(() => {})
    keep()
    const timer = setInterval(keep, RUNS_FOLLOWED_MS)
    timer.unref()
    return () => {
      stopped = true
      clearInterval(timer)
      stopListening?.()
    }
  }
  // The projects of the person's other computers (elsewhere.ts): each computer of the person's own,
  // a saved machine that is no other person's, says its projects, and what it said is kept with it,
  // so they stay listed while it is off. One whose repository is a project here is listed as this computer's.
  // They are the owner's: a person the owner invited, whose device the door passes to this OpenAgent,
  // is listed none and reaches none of them.
  const ownMachines = async (): Promise<MachineRecord[]> => (await listMachines(env)).filter(machine => machine.owner === undefined)
  const projectsAsked = new OwnProjectsAsked<MachineRecord>(
    async machine => {
      const said = await machineCall(machine, 'onOwnProjects', [], PROJECTS_ASKED_MS)
      if (!said.ok) throw new Error(said.error)
      return said.ret
    },
    (machine, projects) => noteProjects(machine, projects, env),
  )
  const elsewhereProjects = async (): Promise<ProjectSummary[]> => {
    if (callerAtPage() !== undefined) return []
    await projectsAsked.refresh(await ownMachines())
    const own = await ownMachines()
    const addresses = await Promise.all((await listProjects(env)).map(record => addressOf(record.path)))
    return elsewhereHomes(own, new Set(addresses.filter(address => address !== undefined))).map(elsewhereSummary)
  }
  // The Human Queues of the person's other computers (machine-interventions.ts): each says its own
  // projects' items, named here by the project as it is listed here, one of a run there marked with
  // its computer. None for a person the owner invited, as their projects are none.
  const queuesAsked = new AnswersKept<MachineRecord, ProjectionRead<Intervention>>(async machine => {
    const said = await machineCall(machine, 'onOwnInterventions', [], QUEUE_ASKED_MS)
    if (!said.ok) throw new Error(said.error)
    return interventionsOf(said.ret)
  })
  const machinesQueue = async (): Promise<MachinesQueue> => {
    if (callerAtPage() !== undefined) return { said: [], unread: [] }
    const own = (await ownMachines()).filter(machine => (machine.projects ?? []).length > 0)
    const [answers, records] = await Promise.all([queuesAsked.of(own), listProjects(env)])
    // A project as it is listed here, by its repository's address, else by its computer and its id there: as elsewhereHomes lists them.
    const keyOf = (machine: MachineRecord, project: OwnProject): string => project.address ?? `${machine.url} ${lineNameOf(project)}`
    const listed = new Map<string, string>()
    for (const record of records) {
      const address = await addressOf(record.path)
      if (address !== undefined && !listed.has(address)) listed.set(address, record.id)
    }
    for (const home of elsewhereHomes(own, new Set(listed.keys()))) listed.set(keyOf(home.machine, home.project), elsewhereId(home.project.id, home.machine.id))
    const queue: MachinesQueue = { said: [], unread: [] }
    for (const machine of own) {
      const idHere = (theirs: string): string | undefined => {
        const project = machine.projects?.find(one => one.id === theirs)
        return project && listed.get(keyOf(machine, project))
      }
      const said = answers.get(machine.id)
      if (said) queue.said.push(namedHere(said, idHere, { name: machineName(machine), kind: machineKind(machine).kind, id: machine.id }))
      else queue.unread.push(...(machine.projects ?? []).flatMap(project => idHere(project.id) ?? []))
    }
    return queue
  }
  // Another computer's project by its id here, and how a call reaches it there.
  const elsewhereAt = async (id: string): Promise<{ home: ElsewhereHome<MachineRecord>; target: RemoteTarget } | undefined> => {
    if (callerAtPage() !== undefined) return undefined
    const home = elsewhereHomeOf(await ownMachines(), id)
    return home && { home, target: targetOf(home.machine, lineNameOf(home.project)) }
  }

  // A run of a project by its id: its record here, else what the saved machine it runs on said of
  // it, for a run whose record was never shared.
  const runOf = async (path: string, agentId: string): Promise<AgentMeta | undefined> =>
    (await findAgent(path, agentId).catch(() => undefined)) ?? (await machineRuns(path)).flatMap(machine => machine.runs).find(run => run.id === agentId)

  // The machine a run runs on. A run this computer sent is known by what was kept at its start.
  // Any other is known by its record, or by what a saved machine said of it: the computer it names
  // is this one, a saved machine, or someone else's, and only a saved machine's run is that
  // machine's to be asked about. A run is
  // looked up in its own project, and what is kept is kept by project and run: an id alone says
  // nothing of the project, and a record in one project does not speak for a run of another.
  const homes = new Map<string, { home?: { target: RemoteTarget; label: string }; until: number }>()
  const homeOf = async (project: string, agentId: string): Promise<{ target: RemoteTarget; label: string } | undefined> => {
    if (!isRunId(agentId)) return undefined
    // Another computer's project: its runs are that computer's.
    if (isElsewhereId(project)) {
      const at = await elsewhereAt(project)
      return at && { target: at.target, label: at.home.machine.label }
    }
    const key = `${project} ${agentId}`
    const kept = homes.get(key)
    if (kept && kept.until > Date.now()) return kept.home
    const keep = (home: { target: RemoteTarget; label: string } | undefined, forMs: number): typeof home => {
      if (homes.size >= MAX_HOMES) homes.clear()
      homes.set(key, { ...(home ? { home } : {}), until: Date.now() + forMs })
      return home
    }
    const projectCwd = await resolveProject(project)
    const agent = projectCwd ? await runOf(projectCwd, agentId) : undefined
    if (!projectCwd) return undefined
    // No record of it here: a run a saved machine's Human Queue names is that machine's, else nothing is known, and it is asked again.
    if (!agent) {
      const queued = (await machinesQueue()).said.flatMap(said => said.items).find(item => item.projectId === project && item.agentId === agentId)?.computer?.id
      const machine = queued === undefined ? undefined : (await ownMachines()).find(saved => saved.id === queued)
      const address = machine ? await addressOf(projectCwd) : undefined
      return machine && address !== undefined ? keep({ target: targetOf(machine, address), label: machine.label }, HOME_KEPT_MS) : undefined
    }
    // A run's computer never changes: this one's own, and one whose record names none, is not looked up again.
    if (!isHostName(agent.host) || agent.host === hostname()) return keep(undefined, OWN_KEPT_MS)
    await machineNames()
    const machine = machineOf(agent.host)
    const address = machine ? await addressOf(projectCwd) : undefined
    if (!machine || address === undefined) return keep(undefined, HOME_KEPT_MS)
    return keep({ target: targetOf(machine, address), label: machine.label }, HOME_KEPT_MS)
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
      const agent = home ? await runIn(project, agentId) : undefined
      if (!home || !agent || relayedAgents.follows(agentId) || elsewhere()) return
      // The row starts as the record may say the run is, and the machine's own events take it from there.
      // Its cost is counted again from what the machine says, from the run's first line on.
      const { cost: _counted, ...said } = asRecorded(agent)
      relayedAgents.register(agentId, home.target, { ...said, target: 'remote', ...onMachine({ label: home.label, url: home.target.url }) }, project, false)
    },
    sent: agentId => relayedAgents.isSent(agentId),
    machineNames,
    machineRuns,
    followRuns,
    elsewhere: elsewhereProjects,
    elsewhereRuns,
    followElsewhereRuns,
    elsewhereHome: async project => {
      const at = await elsewhereAt(project)
      return at && { machine: at.home.machine.id, project: at.home.project }
    },
    bringHere,
    machinesQueue,
    forward: async (project, fn, args) => {
      const at = await elsewhereAt(project)
      if (!at) throw new Error('That project is no longer listed on any of your computers.')
      return relayRpc(at.target, fn, args)
    },
  }
  // A run of a project by its id, this computer's project or another's.
  async function runIn(project: string, agentId: string): Promise<AgentMeta | undefined> {
    if (isElsewhereId(project)) return (await elsewhereRuns(project)).flatMap(machine => machine.runs).find(run => run.id === agentId)
    const projectCwd = await resolveProject(project)
    return projectCwd ? runOf(projectCwd, agentId) : undefined
  }

  return {
    agents: remoteAgents,
    events: (projectId, agentId) => relayedAgents.get(agentId, projectId),
    followSent: (agentId, target, meta, projectId) => relayedAgents.register(agentId, target, meta, projectId),
    elsewhereAt,
    dispose: () => {
      relayedAgents.dispose()
      machineRunsKept.stop()
    },
  }
}
