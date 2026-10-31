import { homedir } from 'node:os'
import { contextProjects, contextRemote, resolveProjectPath } from './context.js'
import { runModuleCommand as runCommand, type ModuleCommandResult } from '@openagt/skill-ui'
import { findBroughtModule, findComputerModule, findProjectModule, readComputerModules, readProjectModules } from '../project-modules.js'
import { broughtModuleUrl, computerModuleUrl, moduleUrl, versionedModuleUrl } from '../dashboard/module-serve.js'
import { providedDataChanged } from '../store/provided.js'
import { callModuleRead, serverHost, type ModuleReadResult } from '../dashboard/module-host.js'
import { relayOr } from './relay-agent.js'
import { COMPUTER_ENV, URL_ENV, ownUrlSaid } from '../package-services.js'
import { computerSaid } from '../dashboard/machine-call.js'
import { CALLER_ENV, callerAtPage } from '../dashboard/person.js'
import { THROUGH_PATH, remoteComputerCommand } from '../dashboard/remote-run.js'
import { listMachines } from '../registry.js'
import { DATA_BRANCH, pullFileBranch } from '@openagt/agent-data'

export type { ModuleCommandResult } from '@openagt/skill-ui'
export type { ModuleReadResult } from '../dashboard/module-host.js'

/** One module as the dashboard loads it: where its module is, and which projects have it. */
export interface DashboardModule {
  /** The package that brings it. */
  package: string
  /** The URL of its browser module, served from the first project that has it, or from OpenAgent's own copy for one of the computer's, with its file's version: a browser keeps it for good. */
  url: string
  /** The registered projects whose packages include it, in the registry's order; none for one of the computer's, whose commands run in no project. */
  projects: string[]
  /** Set for one of the computer's packages: what it keeps is the person's, in their home folder, and no project's. */
  computer?: true
}

/**
 * Every module the dashboard loads (#1774), one per package. First the computer's, which are
 * there with no project added. Then every module any registered project brings, with the projects
 * that have it: with no project picked the sidebar and the pages are every project's, and the
 * dashboard narrows them itself to a picked project's. A package several projects install is loaded once, from
 * the first of them in the registry's order; its page then reads each project through that
 * project's own command. A project that cannot be read contributes nothing.
 */
export async function onModules(): Promise<DashboardModule[]> {
  const byPackage = new Map<string, DashboardModule>()
  for (const module of await readComputerModules().catch(() => [])) {
    byPackage.set(module.package, { package: module.package, url: await versionedModuleUrl(computerModuleUrl(module), module), projects: [], computer: true })
  }
  for (const project of await contextProjects().list()) {
    const modules = await readProjectModules(project.path).catch(() => [])
    for (const module of modules) {
      const known = byPackage.get(module.package)
      if (known) known.projects.push(project.id)
      else byPackage.set(module.package, { package: module.package, url: await versionedModuleUrl(moduleUrl(project.id, module), module), projects: [project.id] })
    }
  }
  // Another computer's projects have the pages their computer said they have, from a copy of the
  // module here: a project's of this computer's, else OpenAgent's own. One with no copy here has none.
  for (const project of await contextRemote().elsewhere().catch(() => [])) {
    for (const pkg of project.modules ?? []) {
      const known = byPackage.get(pkg)
      if (known?.computer) continue
      if (known) {
        known.projects.push(project.id)
        continue
      }
      const brought = await findBroughtModule(pkg).catch(() => undefined)
      if (brought) byPackage.set(pkg, { package: pkg, url: await versionedModuleUrl(broughtModuleUrl(brought), brought), projects: [project.id] })
    }
  }
  return [...byPackage.values()]
}

/**
 * Run one of a module package's commands in one project and answer its JSON output: how a module
 * reads (and changes) its own data. Refused for an unknown project and for a package that is not a
 * module of that project, so a page can run only its own package's commands, never an arbitrary
 * program.
 *
 * `acts` says the command is a module's action on the project (a claim released, an entry added),
 * not a page's read. Only then does OpenAgent converge the project's data branch with origin, as
 * its clock does every minute, and forget what it had read of the data that package provides (the
 * queue package's queue): in a project that shares its records a package's command writes as a
 * remote writer, straight to origin, and the next read shows the change at once instead of at the
 * next sync. A read writes nothing, so what was read stays: the Members card reading the logs
 * package's people leaves the runs that package provides read.
 */
export async function runModuleCommand(projectId: string, pkg: string, args: string[], command?: string, acts = false): Promise<ModuleCommandResult> {
  const root = await resolveProjectPath(projectId)
  if (!root) return { ok: false, error: 'unknown project' }
  if (!Array.isArray(args)) return { ok: false, error: 'arguments must be a list' }
  const module = await findProjectModule(root, pkg)
  if (!module) return { ok: false, error: `${pkg} brings no module to this project` }
  const result = await runCommand(root, module, args, command)
  if (acts) {
    await pullFileBranch(root, DATA_BRANCH, { log: () => {} }).catch(() => {})
    providedDataChanged(root, pkg)
  }
  return result
}

/**
 * Run one of the commands of a package that is this computer's, in no project, and answer its
 * JSON output: how the door's page and the servers' page read and change what they keep, which is
 * in the person's home folder, where the command runs. Refused for any other package: a project's
 * module runs its commands in its project ({@link runModuleCommand}). `input` is what the command
 * reads on standard input: a login handed over there is on no command line.
 *
 * The command is told which computer this is and where this OpenAgent answers: what it sets up on
 * another machine is listed there as this computer's, and what it asks of a saved machine it asks
 * through this OpenAgent, which holds the keys.
 */
export async function runComputerCommand(pkg: string, args: string[], command?: string | null, input?: string | null): Promise<ModuleCommandResult> {
  if (!Array.isArray(args)) return { ok: false, error: 'arguments must be a list' }
  const module = await findComputerModule(pkg)
  if (!module) return { ok: false, error: `${pkg} is not this computer's` }
  // Told which computer this is, in the word OpenAgent's own calls are made from: what such a command sets up on another machine is listed there as this computer's.
  const computer = computerSaid()
  const url = ownUrlSaid()
  // Told whose device asks, when it is a person's the owner invited: the package decides what such a person may see and do.
  const caller = callerAtPage()
  const more = { ...(computer !== undefined ? { [COMPUTER_ENV]: computer } : {}), ...(url !== undefined ? { [URL_ENV]: url } : {}), ...(caller !== undefined ? { [CALLER_ENV]: encodeURIComponent(caller) } : {}) }
  return runCommand(homedir(), module, args, typeof command === 'string' ? command : undefined, more, typeof input === 'string' ? input : undefined)
}

/**
 * Run one of the commands of a package that is this computer's on a saved machine, where the
 * same package is that machine's: a module reads and changes what it keeps over there, with this
 * computer's key there, as the machine's own page would. Not for a computer reached through a
 * server: what comes down a line is a machine's calls, not its page's.
 */
export async function runComputerCommandOn(pkg: string, machineId: string, args: string[], command?: string | null, input?: string | null): Promise<ModuleCommandResult> {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) return { ok: false, error: 'arguments must be a list of words' }
  if (!(await findComputerModule(pkg))) return { ok: false, error: `${pkg} is not this computer's` }
  const machine = (await listMachines()).find(saved => saved.id === machineId)
  if (!machine || machine.url.includes(THROUGH_PATH)) return { ok: false, error: 'That machine is no longer saved.' }
  return remoteComputerCommand(machine, pkg, args, typeof command === 'string' ? command : undefined, typeof input === 'string' ? input : undefined)
}

/**
 * Call read `name` of a module's server part in one project: how a module's browser part reads
 * what a command cannot answer fast enough. Refused for an unknown project, a package that is not
 * a module of that project, and a module with no server part. A read whose input names a run this
 * daemon relays to a saved machine (`input.agentId`) is read over there, by that machine's own
 * copy of the module, since the run's checkout is there.
 */
export async function readModule(projectId: string, pkg: string, name: string, input: unknown): Promise<ModuleReadResult> {
  const agentId = input && typeof input === 'object' && typeof (input as { agentId?: unknown }).agentId === 'string' ? (input as { agentId: string }).agentId : undefined
  return relayOr<ModuleReadResult>(agentId, 'readModule', [projectId, pkg, name, input], async () => {
    const root = await resolveProjectPath(projectId)
    if (!root) return { ok: false, error: 'unknown project' }
    const module = await findProjectModule(root, pkg).catch(() => undefined)
    if (!module) return { ok: false, error: `${pkg} is no module of this project` }
    if (!module.server) return { ok: false, error: `${pkg} has no server part` }
    return callModuleRead(module.server, name, serverHost(root), input)
  }, { ok: false, error: 'the machine this run works on did not answer' })
}
