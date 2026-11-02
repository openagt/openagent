import type { ProjectSummary } from './projects.js'

/**
 * The projects of the person's other computers, as this one lists them beside its own: a
 * laptop's on its server, a server's on the laptop. Each computer says its own projects only
 * ({@link OwnProject}), over the relay of the saved machine it is, and only a computer that is
 * the person's own is asked: a computer of another person's, shared on a server, keeps its
 * projects to its person.
 *
 * A project this computer has too, by its repository's address, is listed once, as this
 * computer's: a run of it goes to any computer that has it, by "Run on". One only another
 * computer has is listed as that computer's, under an id of its own ({@link elsewhereId}): what
 * the page asks of it is asked of that computer, and a run of it starts there unless another
 * computer is picked, which clones it first. What a computer said last is kept, so its projects
 * stay listed while it is off.
 */

/** What a computer says of one of its own projects to another computer of the person's. */
export interface OwnProject {
  /** Its id there. */
  id: string
  name: string
  /** Its folder there. */
  path: string
  /** Its repository's address ({@link import('../repository-address.js').repositoryAddress}), when it has one. */
  address?: string
  /** The same address in the letters its `origin` is written with: what another computer clones it from. */
  spelling?: string
  /** Whether the agents' records of it go to its repository's remote: a copy cloned from it takes the same answer. */
  share: boolean
  gitHost: boolean
  activated: boolean
  lastActivityAt?: string
  /** The packages that bring it a module's pages there (Queue, Tickets, Automations): the pages it has here too. */
  modules?: string[]
}

/** The longest list a computer is taken at its word for, and the longest strings in it. */
const MAX_PROJECTS = 200
const MAX_WORD = 512
/** The most module packages a project is taken to have. */
const MAX_MODULES = 50

/** What a computer answered as its projects, the ones that read as projects: anything else is dropped. */
export function ownProjectsOf(said: unknown): OwnProject[] {
  if (!Array.isArray(said)) return []
  const word = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_WORD
  const projects: OwnProject[] = []
  for (const raw of said.slice(0, MAX_PROJECTS)) {
    if (!raw || typeof raw !== 'object') continue
    const { id, name, path, address, spelling, share, gitHost, activated, lastActivityAt, modules } = raw as Record<string, unknown>
    // An id is a word of the URL-safe kind a computer makes its ids of: it goes in this computer's ids too.
    if (!word(id) || !/^[a-z0-9-]+$/.test(id) || !word(name) || !word(path)) continue
    projects.push({
      id,
      name,
      path,
      ...(word(address) ? { address } : {}),
      ...(word(spelling) ? { spelling } : {}),
      share: share === true,
      gitHost: gitHost === true,
      activated: activated === true,
      ...(word(lastActivityAt) && !Number.isNaN(Date.parse(lastActivityAt)) ? { lastActivityAt } : {}),
      ...(Array.isArray(modules) ? { modules: modules.slice(0, MAX_MODULES).filter(word) } : {}),
    })
  }
  return projects
}

/** What separates a project's id on its computer from the mark of that computer in an id here. A computer's own ids never have it. */
const MARK = '~'

/** A short, URL-safe mark of a saved machine, by its address: the same machine always gets the same one. */
function markOf(machineId: string): string {
  // djb2, as a project's own id hashes its path.
  let hash = 5381
  for (let i = 0; i < machineId.length; i++) hash = ((hash * 33) ^ machineId.charCodeAt(i)) >>> 0
  return hash.toString(36)
}

/** The id here of a project of another computer's: its id there, and the mark of the saved machine it is. */
export function elsewhereId(projectId: string, machineId: string): string {
  return `${projectId}${MARK}${markOf(machineId)}`
}

/** Whether an id is that of another computer's project, not one of this computer's own. */
export function isElsewhereId(id: unknown): id is string {
  return typeof id === 'string' && id.includes(MARK)
}

/** How a call about the project names it to its computer: its repository's address, or its id there when it has none. */
export function lineNameOf(project: Pick<OwnProject, 'id' | 'address'>): string {
  return project.address ?? `#${project.id}`
}

/** The project's id on its computer, from how a call named it there: undefined for an address. */
export function idInLineName(name: string): string | undefined {
  return name.startsWith('#') ? name.slice(1) : undefined
}

/** A saved machine of the person's own, with what it said of its projects last. */
export interface OwnMachine {
  id: string
  projects?: OwnProject[]
}

/** A project of another computer's: the saved machine it is on, and the project as that computer said it. */
export interface ElsewhereHome<M extends OwnMachine = OwnMachine> {
  machine: M
  project: OwnProject
}

/** The listing of another computer's project, as the page lists projects: marked with the saved machine it is on. */
export function elsewhereSummary(home: ElsewhereHome): ProjectSummary {
  const { machine, project } = home
  return {
    id: elsewhereId(project.id, machine.id),
    path: project.path,
    name: project.name,
    activated: project.activated,
    gitHost: project.gitHost,
    machine: machine.id,
    ...(project.lastActivityAt !== undefined ? { lastActivityAt: project.lastActivityAt } : {}),
    ...(project.modules !== undefined ? { modules: project.modules } : {}),
  }
}

/**
 * The projects of the person's other computers that this one does not have, each listed once:
 * one whose repository's address is a project here is this computer's, and of two computers
 * with the same repository the first one listed has it. A project with no address is only its
 * own computer's, and listed for it.
 */
export function elsewhereHomes<M extends OwnMachine>(machines: readonly M[], ownAddresses: ReadonlySet<string>): ElsewhereHome<M>[] {
  const taken = new Set(ownAddresses)
  const homes: ElsewhereHome<M>[] = []
  for (const machine of machines) {
    for (const project of machine.projects ?? []) {
      if (project.address !== undefined) {
        if (taken.has(project.address)) continue
        taken.add(project.address)
      }
      homes.push({ machine, project })
    }
  }
  return homes
}

/** The project of another computer's with this id, among the saved machines, whether it is listed here or not. */
export function homeOf<M extends OwnMachine>(machines: readonly M[], id: string): ElsewhereHome<M> | undefined {
  if (!isElsewhereId(id)) return undefined
  const at = id.lastIndexOf(MARK)
  const projectId = id.slice(0, at)
  const mark = id.slice(at + MARK.length)
  const machine = machines.find(saved => markOf(saved.id) === mark)
  const project = machine?.projects?.find(own => own.id === projectId)
  return machine && project ? { machine, project } : undefined
}

/** How long a computer's word on its projects is taken before it is asked again. */
export const PROJECTS_KEPT_MS = 20_000
/** How long a list waits for a computer never answered before: what it says after comes at the next list. */
export const FIRST_WAIT_MS = 3_000

/**
 * Each of the person's computers asked for its projects at most every {@link PROJECTS_KEPT_MS}, and
 * what it said kept by `keep` (the saved machine's record), so a list is made of what each said
 * last: at once, while each is asked again behind it. One never answered yet is waited for a
 * little, the first time.
 */
export class OwnProjectsAsked<M extends OwnMachine> {
  private readonly asked = new Map<string, { at: number; asking?: Promise<void> | undefined }>()

  constructor(
    /** Ask the machine for its projects. */
    private readonly ask: (machine: M) => Promise<unknown>,
    /** Keep what the machine said, when it answered and said otherwise than it had. */
    private readonly keep: (machine: M, projects: OwnProject[]) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Ask each machine whose word is old, and wait for the ones never heard from, a little. */
  async refresh(machines: readonly M[]): Promise<void> {
    const waits: Promise<void>[] = []
    for (const machine of machines) {
      const was = this.asked.get(machine.id)
      if (was?.asking || (was && this.now() - was.at < PROJECTS_KEPT_MS)) continue
      const one: { at: number; asking?: Promise<void> | undefined } = { at: this.now() }
      one.asking = this.askOne(machine).finally(() => (one.asking = undefined))
      this.asked.set(machine.id, one)
      if (machine.projects === undefined) waits.push(one.asking)
    }
    if (waits.length > 0) await Promise.race([Promise.all(waits), new Promise(done => setTimeout(done, FIRST_WAIT_MS).unref())])
  }

  private async askOne(machine: M): Promise<void> {
    const said = await this.ask(machine).then(
      answer => ({ answer }),
      () => undefined,
    )
    if (said === undefined) return
    const projects = ownProjectsOf(said.answer)
    if (JSON.stringify(projects) !== JSON.stringify(machine.projects ?? null)) await this.keep(machine, projects).catch(() => {})
  }
}
