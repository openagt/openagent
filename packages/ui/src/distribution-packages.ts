import { join } from 'node:path'
import type { CleanupReport } from './dashboard/types.js'
import { DISTRIBUTION_ENV, distributionItems, packageDirOf, type DistributionEntry, type DistributionPackage, type ModuleDefinition, type PluginInfo, type ProjectRef } from '@openagt/hooks'
import { declaring, projectId, readManifest, runPackageCommand, type ProjectPackage, type ProvidedCommand, type ProvidedCommandLookup } from '@openagt/agent-data'
import { distributionHooks, projectRefAt } from './distribution-hooks.js'

/**
 * The packages the dashboard brings (#2394): the ones its distribution lists, resolved from the
 * distribution's own install (`@openagt/dashboard`'s), so a project installs nothing for them and
 * an empty folder starts an agent and shows it. Each comes through the same contract: a module
 * by its `./dashboard` export, a provider of a kind of data by its `openagent` key. A plugin's
 * package is there only where its Enabled row is on (`@openagt/hooks`). Nothing in `ui` names a
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

/**
 * What provides `kind` in the project at `root`: the one package it has that declares it
 * (`"openagent": { "<kind>": "<command>" }`). Two that both do are the distribution's mistake,
 * which the project's banner says.
 */
export async function lookupProvided(root: string, kind: string): Promise<ProvidedCommandLookup> {
  const providers = declaring(await packagesOf(root), kind)
  if (providers.length === 1) return { command: providers[0]! }
  if (providers.length === 0) return {}
  return { problem: `${providers.length} packages of the distribution provide ${kind}: ${providers.map(p => p.package).join(', ')}` }
}

/** {@link lookupProvided}'s command, for a caller that only needs to run it. */
export async function providedCommand(root: string, kind: string): Promise<ProvidedCommand | undefined> {
  return (await lookupProvided(root, kind)).command
}

/**
 * Have every package that declares a clean-up remove what it left in the project at `root`: a
 * package declares `"openagent": { "cleanup": "<command>" }`, and `<command> cleanup`, run in the
 * project, answers `{ ok: true, removed, kept }`. Every package of the distribution is asked, also
 * one this project no longer has (what it left stays its own to remove), each whatever the one
 * before answered. A package that refuses, fails or answers something else is one line in
 * `failed`, in words.
 */
export async function runCleanups(root: string): Promise<CleanupReport> {
  const report: CleanupReport = { removed: [], kept: [], failed: [] }
  for (const command of declaring(await distributionPackages(), 'cleanup')) {
    const result = await runPackageCommand(root, command, ['cleanup'])
    if (!result.ok) {
      report.failed.push(`${command.package}: ${result.error}`)
      continue
    }
    const answer = readCleanupAnswer(result.output)
    if (!answer) {
      report.failed.push(`${command.package}: its clean-up answered something else than what it removed and kept`)
      continue
    }
    report.removed.push(...answer.removed)
    report.kept.push(...answer.kept)
  }
  return report
}

/** A clean-up's answer, read strictly: anything else is not one. */
function readCleanupAnswer(output: unknown): Pick<CleanupReport, 'removed' | 'kept'> | undefined {
  if (!output || typeof output !== 'object') return undefined
  const { ok, removed, kept } = output as { ok?: unknown; removed?: unknown; kept?: unknown }
  if (ok !== true || !Array.isArray(removed) || !Array.isArray(kept)) return undefined
  if (!removed.every(path => typeof path === 'string')) return undefined
  const isKept = (entry: unknown): entry is { path: string; reason: string } =>
    Boolean(entry) && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string' && typeof (entry as { reason?: unknown }).reason === 'string'
  if (!kept.every(isKept)) return undefined
  return { removed: [...removed] as string[], kept: kept.map(entry => ({ path: entry.path, reason: entry.reason })) }
}
