import { join } from 'node:path'
import { DISTRIBUTION_ENV, distributionItems, packageDirOf, type DistributionEntry, type DistributionPackage, type ModuleDefinition, type PluginInfo, type ProjectRef } from '@openagt/hooks'
import { projectId, readManifest, type ProjectPackage } from '@openagt/agent-data'
import { distributionHooks, projectRefAt } from './distribution-hooks.js'

/**
 * The packages the dashboard brings (#2394): the ones its distribution lists, resolved from the
 * distribution's own install (`@openagt/dashboard`'s), so a project installs nothing for them and
 * an empty folder starts an agent and shows it. Each comes through the same contract, its module's
 * hooks. A plugin's package is there only where its Enabled row is on (`@openagt/hooks`). Nothing in `ui` names a
 * package, and a project's own dependencies bring none.
 */

/** A package of the dashboard's distribution: a package as `@openagt/hooks` lists it, and whose it is. */
export interface DashboardPackage extends DistributionPackage {
  /** `computer`: this computer and no project, with no project added; what it keeps is in the person's home folder. Every project's when unsaid. */
  for?: 'computer'
}

/** A module as it is given (a demo's fakes): with its package named, the rest of that package is read as the package's own. */
export type DashboardEntry = DistributionEntry & Pick<DashboardPackage, 'for'>

/** What the dashboard's distribution lists: its packages, and modules as they are given. */
export type DashboardDistribution = readonly (DashboardPackage | DashboardEntry)[]

/** One of the distribution's packages, resolved. */
export interface OwnPackage extends ProjectPackage {
  /** Whose it is: every project's, or this computer's. */
  of: 'every project' | 'the computer'
}

/** The distribution's packages as read last, by the file they were read off. */
let read: { file: string; packages: Promise<OwnPackage[]> } | undefined

/**
 * Every package of the distribution handed down to this process ({@link DISTRIBUTION_ENV}), in
 * its order, read once per distribution; none when none was handed down.
 */
export function distributionPackages(env: NodeJS.ProcessEnv = process.env): Promise<OwnPackage[]> {
  const file = env[DISTRIBUTION_ENV] ?? ''
  if (read?.file !== file) read = { file, packages: file ? readPackages(file) : Promise.resolve([]) }
  return read.packages
}

/** The distribution's plugins, in its order, each with what its package says it is. */
export async function distributionPlugins(): Promise<{ module: ModuleDefinition & { plugin: PluginInfo }; description: string }[]> {
  const hooks = await distributionHooks()
  return (await distributionPackages()).flatMap(pkg => {
    const module = hooks.ofPackage(pkg.name)
    if (!module?.plugin) return []
    return [{ module: module as ModuleDefinition & { plugin: PluginInfo }, description: typeof pkg.manifest.description === 'string' ? pkg.manifest.description : '' }]
  })
}

async function readPackages(file: string): Promise<OwnPackage[]> {
  const packages: OwnPackage[] = []
  for (const item of (await distributionItems(file)) as DashboardDistribution) {
    if (item.package === undefined) continue
    const dir = await packageDirOf(file, item.package)
    const manifest = await readManifest(join(dir, 'package.json'))
    if (!manifest) throw new Error(`${item.package}, which the distribution ${file} lists, has no package.json that reads`)
    packages.push({ name: item.package, dir, manifest, of: item.for === 'computer' ? 'the computer' : 'every project' })
  }
  return packages
}

/**
 * The packages of `of` that are on: one with no module, or a core module's, always; a plugin's where
 * its Enabled row is on, in `project` for one kept per project. A plugin that keeps its own row is
 * there either way: its row is switched on its own Settings entry, which its package brings.
 */
async function onPackages(of: OwnPackage['of'], project?: ProjectRef): Promise<OwnPackage[]> {
  const hooks = await distributionHooks()
  const on = new Set(await hooks.on(project))
  return (await distributionPackages()).filter(pkg => {
    const module = hooks.ofPackage(pkg.name)
    return pkg.of === of && (module === undefined || module.plugin?.row !== undefined || on.has(module))
  })
}

/**
 * The packages of the distribution the project at `root` has: every project's, a plugin's where
 * it is on in the project. Read each time, so a plugin switched a moment ago counts at once.
 * None of the computer's: no project has those.
 */
export async function packagesOf(root: string): Promise<OwnPackage[]> {
  return onPackages('every project', await projectRefAt(projectId(root), root))
}

/**
 * Every package of the distribution a project can have, a plugin's off everywhere too: the copy a
 * module's page is served from on a computer where no project of its own has the module.
 */
export async function projectsPackages(): Promise<OwnPackage[]> {
  return (await distributionPackages()).filter(pkg => pkg.of === 'every project')
}

/** The packages that are this computer's ({@link DashboardPackage.for}), a plugin's where it is on. */
export async function computerPackages(): Promise<OwnPackage[]> {
  return onPackages('the computer')
}
