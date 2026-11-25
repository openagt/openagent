import { homedir } from 'node:os'
import { contextProjects, resolveProjectPath } from './context.js'
import { SESSIONS_ID } from '../project-address.js'
import { findComputerModule, findProjectModule, readComputerModules, readProjectModules, runModuleCommand as runCommand, type ModuleCommandResult } from '../project-modules.js'
import { broughtModuleUrl, computerModuleUrl, moduleUrl, versionedModuleUrl } from '../dashboard/module-serve.js'
import { pullProjectData } from '@openagt/agent-data'

export type { ModuleCommandResult } from '../project-modules.js'

/** One module as the dashboard loads it: where its module is, and which projects have it. */
export interface DashboardModule {
  /** The package that brings it. */
  package: string
  /** The URL of its browser module, served from the first project that has it, or from OpenAgent's own copy for one of the computer's, with its file's version: a browser keeps it for good. */
  url: string
  /** The registered projects whose packages include it, in the registry's order; none for one of the computer's, whose commands run in no project. */
  projects: string[]
  /** Set for one the sessions with no project have: a module of every project's, or a plugin they have as the distribution starts it. */
  sessions?: true
  /** Set for one of the computer's packages: what it keeps is the person's, in their home folder, and no project's. */
  computer?: true
}

/**
 * Every module the dashboard loads (#1774), one per package. First the computer's, which are
 * there with no project added. Then every module whose pages a registered project shows, with
 * the projects that show them, and those the sessions with no project have: with no project picked the sidebar and the pages are every
 * project's, and the dashboard narrows them itself to a picked project's. A package several
 * projects install is loaded once, from
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
  // The sessions with no project have what a project has where nobody switched a plugin, from the
  // first project that has it, else from OpenAgent's own copy.
  const sessions = await contextProjects()
    .resolvePath(SESSIONS_ID)
    .catch(() => undefined)
  for (const module of sessions !== undefined ? await readProjectModules(sessions).catch(() => []) : []) {
    const known = byPackage.get(module.package)
    if (known?.computer) continue
    if (known) known.sessions = true
    else byPackage.set(module.package, { package: module.package, url: await versionedModuleUrl(broughtModuleUrl(module), module), projects: [], sessions: true })
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
 * its clock does every minute: in a project that shares its records a package's command writes as
 * a remote writer, straight to origin, and the next read shows the change at once instead of at
 * the next sync. `input` is what the command reads
 * on standard input: a whole file an action writes, a ticket say.
 */
export async function runModuleCommand(projectId: string, pkg: string, args: string[], command?: string, acts = false, input?: string | null): Promise<ModuleCommandResult> {
  const root = await resolveProjectPath(projectId)
  if (!root) return { ok: false, error: 'unknown project' }
  if (!Array.isArray(args)) return { ok: false, error: 'arguments must be a list' }
  const module = await findProjectModule(root, pkg)
  if (!module) return { ok: false, error: `${pkg} brings no module to this project` }
  const result = await runCommand(root, module, args, command, typeof input === 'string' ? input : undefined)
  if (acts) await pullProjectData(root, { log: () => {} }).catch(() => {})
  return result
}

/**
 * Run one of the commands of a package that is this computer's, in no project, and answer its
 * JSON output: how such a package's page (the Accounts card) reads and changes what it keeps,
 * which is in the person's home folder, where the command runs. Refused for any other package: a
 * project's module runs its commands in its project ({@link runModuleCommand}). `input` is what
 * the command reads on standard input: a login is on no command line.
 */
export async function runComputerCommand(pkg: string, args: string[], command?: string | null, input?: string | null): Promise<ModuleCommandResult> {
  if (!Array.isArray(args)) return { ok: false, error: 'arguments must be a list' }
  const module = await findComputerModule(pkg)
  if (!module) return { ok: false, error: `${pkg} is not this computer's` }
  return runCommand(homedir(), module, args, typeof command === 'string' ? command : undefined, typeof input === 'string' ? input : undefined)
}
