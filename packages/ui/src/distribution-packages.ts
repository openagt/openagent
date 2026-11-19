import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CleanupReport } from './dashboard/types.js'
import { DISTRIBUTION_ENV, distributionItems, packageDirOf, type DistributionEntry, type DistributionPackage } from '@openagt/hooks'
import { declaring, SKILLS_DIRS, packageBins, readManifest, runPackageCommand, type ProjectPackage, type ProvidedCommand, type ProvidedCommandLookup } from '@openagt/agent-data'

/**
 * The packages the dashboard brings (#2394): the ones its distribution lists, resolved from the
 * distribution's own install (`@openagt/dashboard`'s), so a project installs nothing for them and
 * an empty folder starts an agent and shows it. Each comes through the same contract: a module
 * by its `./dashboard` export, a provider of a kind of data by its `openagent` key, a skill by its
 * `SKILL.md`. Nothing in `ui` names a package, and a project's own dependencies bring none.
 */

/**
 * A package of the dashboard's distribution: a package as `@openagt/hooks` lists it, and whose
 * its pages, cards and commands are, until each plugin has its Enabled row (#2394).
 */
export interface DashboardPackage extends DistributionPackage {
  /**
   * Who has it: every project when unsaid. `picked`: a project once it picked the package's
   * skill, which it has when every run gets the skill or when the project holds its text where
   * the coding agents read it (`.claude/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md`),
   * so deleting the skill's folder takes its page away. `computer`: this computer and no project,
   * with no project added; what it keeps is in the person's home folder.
   */
  for?: 'picked' | 'computer'
  /** Its pages and cards show only in a project that picked its skill, though every project has its commands. */
  pages?: 'picked'
  /** Every run gets its skill, with nothing written in the project. */
  skill?: 'every run'
}

/** What the dashboard's distribution lists: its packages, and modules as they are given (a demo's fakes). */
export type DashboardDistribution = readonly (DashboardPackage | DistributionEntry)[]

/** One of the distribution's packages, resolved, with the skill it is when it is one. */
export interface OwnPackage extends ProjectPackage {
  /** The `name` in the front matter of the package's `SKILL.md`; absent for a package that is no skill. */
  skill?: string
  /** Whose it is: every project's, a project's once it picked it, or this computer's. */
  of: 'every project' | 'a pick' | 'the computer'
  /** Its pages and cards are a project's only once it picked it ({@link DashboardPackage.pages}). */
  pagesPicked: boolean
  /** Every run gets its skill. */
  everyRun: boolean
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

async function readPackages(file: string): Promise<OwnPackage[]> {
  const packages: OwnPackage[] = []
  for (const item of (await distributionItems(file)) as DashboardDistribution) {
    if ('module' in item) continue
    const dir = await packageDirOf(file, item.package)
    const manifest = await readManifest(join(dir, 'package.json'))
    if (!manifest) throw new Error(`${item.package}, which the distribution ${file} lists, has no package.json that reads`)
    const skill = /^name:[ \t]*([a-z0-9][a-z0-9-]*)[ \t]*$/m.exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => ''))?.[1] ?? '')?.[1]
    const of = item.for === 'picked' ? 'a pick' : item.for === 'computer' ? 'the computer' : 'every project'
    packages.push({ name: item.package, dir, manifest, of, pagesPicked: item.pages === 'picked', everyRun: item.skill === 'every run', ...(skill !== undefined ? { skill } : {}) })
  }
  return packages
}

/**
 * The packages of the distribution the project at `root` has: the ones every project has, and
 * each picked one the project has by its rule ({@link DashboardPackage.for}). Read off the
 * project's files each time, so a skill written or deleted a moment ago counts at once. None of
 * the computer's: no project has those.
 */
export async function packagesOf(root: string): Promise<OwnPackage[]> {
  const packages: OwnPackage[] = []
  for (const pkg of await distributionPackages()) {
    if (pkg.of === 'the computer') continue
    if (pkg.of === 'a pick' && !(await picked(root, pkg))) continue
    packages.push(pkg)
  }
  return packages
}

/** Whether the project at `root` shows the pages and cards of `name`, one of the packages it has: always, but for one whose pages are a pick it did not pick. */
export async function showsPages(root: string, name: string): Promise<boolean> {
  const pkg = (await distributionPackages()).find(own => own.name === name)
  if (!pkg?.pagesPicked) return true
  return picked(root, pkg)
}

/** Whether the project at `root` has the skill of `pkg`: every run gets it, or the project holds its text. */
async function picked(root: string, pkg: OwnPackage): Promise<boolean> {
  return pkg.everyRun || (pkg.skill !== undefined && (await holdsSkill(root, pkg.skill)))
}

/** Whether the project holds the text of the skill `name`, in one of the folders the coding agents read. */
async function holdsSkill(root: string, name: string): Promise<boolean> {
  for (const dir of SKILLS_DIRS) if (await stat(join(root, dir, name, 'SKILL.md')).then(s => s.isFile(), () => false)) return true
  return false
}

/**
 * Every package of the distribution a project can have, the picked ones too, whatever a project
 * holds: the copy a module's page is served from on a computer where no project of its own has
 * the module.
 */
export async function projectsPackages(): Promise<OwnPackage[]> {
  return (await distributionPackages()).filter(pkg => pkg.of !== 'the computer')
}

/** The packages that are this computer's ({@link DashboardPackage.for}). */
export async function computerPackages(): Promise<OwnPackage[]> {
  return (await distributionPackages()).filter(pkg => pkg.of === 'the computer')
}

/**
 * The services of the computer's packages: a package declares
 * `"openagent": { "service": "<command>" }`, and `<command> serve` runs for as long as OpenAgent
 * runs (`package-services.ts`). Only those packages: a service is this computer's, and any
 * other package is a project's.
 */
export async function distributionServices(): Promise<ProvidedCommand[]> {
  return declaring(await computerPackages(), 'service')
}

/** The directories the commands of the distribution's packages sit in: what a hook line's PATH gains before the project's own installed tools. */
export async function distributionBinDirs(): Promise<string[]> {
  const dirs = new Set<string>()
  for (const { name, dir, manifest } of await distributionPackages()) {
    for (const bin of Object.values(packageBins(name, manifest.bin, dir))) dirs.add(dirname(bin))
  }
  return [...dirs]
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
