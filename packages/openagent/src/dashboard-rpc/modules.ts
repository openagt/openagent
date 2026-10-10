import { contextProjects, resolveProjectPath } from './context.js'
import { findProjectModule, readProjectModules, runModuleCommand as runCommand, type ModuleCommandResult } from '../project-modules.js'
import { moduleUrl } from '../dashboard/module-serve.js'
import { providedDataChanged } from '../store/provided.js'
import { callModuleRead, serverHost, type ModuleReadResult } from '../dashboard/module-host.js'
import { relayOr } from './relay-agent.js'
import { DATA_BRANCH, pullFileBranch } from '@openagt/agent-data'

export type { ModuleCommandResult } from '../project-modules.js'
export type { ModuleReadResult } from '../dashboard/module-host.js'

/** One module as the dashboard loads it: where its module is, and which projects have it. */
export interface DashboardModule {
  /** The package that brings it. */
  package: string
  /** The URL of its browser module, served from the first project that has it. */
  url: string
  /** The registered projects whose packages include it, in the registry's order. */
  projects: string[]
}

/**
 * Every module any registered project brings (#1774), one per package, with the projects
 * that have it: with no project picked the sidebar and the pages are every project's, and the
 * dashboard narrows them itself to a picked project's. A package several projects install is loaded once, from
 * the first of them in the registry's order; its page then reads each project through that
 * project's own command. A project that cannot be read contributes nothing.
 */
export async function onModules(): Promise<DashboardModule[]> {
  const byPackage = new Map<string, DashboardModule>()
  for (const project of await contextProjects().list()) {
    const modules = await readProjectModules(project.path).catch(() => [])
    for (const module of modules) {
      const known = byPackage.get(module.package)
      if (known) known.projects.push(project.id)
      else byPackage.set(module.package, { package: module.package, url: moduleUrl(project.id, module), projects: [project.id] })
    }
  }
  return [...byPackage.values()]
}

/**
 * Run one of a module package's commands in one project and answer its JSON output: how a module
 * reads (and changes) its own data. Refused for an unknown project and for a package that is not a
 * module of that project, so a page can run only its own package's commands, never an arbitrary
 * program. Once the command has run, OpenAgent forgets what it had read of that project's
 * provided data (its queue, its runs): the command may have written it, and the next read sees
 * that at once instead of a cached copy.
 *
 * `acts` says the command is a module's action on the project (a link action), not a page's read:
 * OpenAgent then also converges the project's data branch with origin, as its clock does
 * every minute, before forgetting — in a project that shares its records a package's command
 * writes as a remote writer, straight to origin, and this machine's copy would otherwise show the
 * write only at the next sync.
 */
export async function runModuleCommand(projectId: string, pkg: string, args: string[], command?: string, acts = false): Promise<ModuleCommandResult> {
  const root = await resolveProjectPath(projectId)
  if (!root) return { ok: false, error: 'unknown project' }
  if (!Array.isArray(args)) return { ok: false, error: 'arguments must be a list' }
  const module = await findProjectModule(root, pkg)
  if (!module) return { ok: false, error: `${pkg} brings no module to this project` }
  const result = await runCommand(root, module, args, command)
  if (acts) await pullFileBranch(root, DATA_BRANCH, { log: () => {} }).catch(() => {})
  providedDataChanged(root)
  return result
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
