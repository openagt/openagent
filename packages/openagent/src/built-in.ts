import { readFile, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { CleanupReport } from './dashboard/types.js'
import { SKILLS_DIRS } from './project-commands.js'
import { readProjectHooks } from './project-hooks.js'
import { declaring, lineRuns, lookupProvidedCommand, packageBins, projectPackages, readManifest, runPackageCommand, type ProjectPackage, type ProvidedCommand, type ProvidedCommandLookup } from '@openagt/agent-data'

/**
 * The packages OpenAgent brings, by name: dependencies of OpenAgent itself, resolved from its
 * own install, so a project installs nothing for them and an empty folder starts an agent and
 * shows it. Each comes through the same contract as any package: a module by its `./dashboard`
 * export, a provider of a kind of data and the writer of its hook lines by its `openagent` key.
 * These two lists are the one place OpenAgent names a package. One of these names among a
 * project's own dependencies is not read: OpenAgent's copy, and the rules below for which
 * project has it, are the only ones.
 */

/** The packages every project has: an agent cannot start, be shown or be put on a git host without them, and the door to this computer is no project's to pick. */
export const BUILT_IN_PACKAGES: readonly string[] = ['@openagt/files', '@openagt/remote-access', '@openagt/skill-branches', '@openagt/skill-github', '@openagt/skill-logs', '@openagt/agent-runner']

/**
 * The packages a project has once it picked them (#2023). A skill's package is the project's
 * when the project holds the skill's text where the coding agents read it
 * (`.claude/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md`): the rule the launcher
 * already lists a project's commands by, so deleting the skill's folder takes its page away. A
 * tool with no skill text (the scheduler) is the project's when one of the project's hook lines
 * runs it.
 */
export const PICKED_PACKAGES: readonly string[] = ['@openagt/skill-tickets', '@openagt/skill-queue', '@openagt/skill-orchestration', '@openagt/agent-scheduler']

/** Every name OpenAgent brings itself. */
export const OWN_PACKAGE_NAMES: readonly string[] = [...BUILT_IN_PACKAGES, ...PICKED_PACKAGES]

/** One of OpenAgent's packages, resolved, with the skill it is when it is one. */
interface OwnPackage extends ProjectPackage {
  /** The `name` in the front matter of the package's `SKILL.md`; absent for a package that is no skill. */
  skill?: string
  /** Whether a project has it only once it picked it. */
  picked: boolean
}

let resolved: Promise<OwnPackage[]> | undefined

/** Every package OpenAgent brings, resolved from its own install, once; one that is not installed is skipped. */
export function builtInPackages(): Promise<ProjectPackage[]> {
  return (resolved ??= resolveOwn())
}

async function resolveOwn(): Promise<OwnPackage[]> {
  const require = createRequire(import.meta.url)
  const packages: OwnPackage[] = []
  for (const name of OWN_PACKAGE_NAMES) {
    let manifestPath: string
    try {
      manifestPath = require.resolve(`${name}/package.json`)
    } catch {
      continue
    }
    const dir = await realpath(dirname(manifestPath)).catch(() => undefined)
    const manifest = dir ? await readManifest(join(dir, 'package.json')) : undefined
    if (!dir || !manifest) continue
    const skill = /^name:[ \t]*([a-z0-9][a-z0-9-]*)[ \t]*$/m.exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => ''))?.[1] ?? '')?.[1]
    packages.push({ name, dir, manifest, picked: PICKED_PACKAGES.includes(name), ...(skill !== undefined ? { skill } : {}) })
  }
  return packages
}

/**
 * The packages OpenAgent brings to the project at `root`: the ones every project has, and
 * each picked one the project has by its rule (see {@link PICKED_PACKAGES}). Read off the
 * project's files each time, so a skill written or deleted a moment ago counts at once.
 */
export async function builtInPackagesOf(root: string): Promise<ProjectPackage[]> {
  const packages: ProjectPackage[] = []
  let lines: string[] | undefined
  for (const pkg of await (resolved ??= resolveOwn())) {
    if (pkg.picked) {
      if (pkg.skill !== undefined ? !(await holdsSkill(root, pkg.skill)) : !runsOneOf((lines ??= await hookLines(root)), pkg)) continue
    }
    packages.push(pkg)
  }
  return packages
}

/** Whether the project holds the text of the skill `name`, in one of the folders the coding agents read. */
async function holdsSkill(root: string, name: string): Promise<boolean> {
  for (const dir of SKILLS_DIRS) if (await stat(join(root, dir, name, 'SKILL.md')).then(s => s.isFile(), () => false)) return true
  return false
}

/** Every line of the project's hooks file. */
async function hookLines(root: string): Promise<string[]> {
  const hooks = await readProjectHooks(root).catch(() => undefined)
  if (!hooks) return []
  return [...hooks.open, ...hooks.close, hooks.start, hooks.resume, hooks.check].filter((line): line is string => typeof line === 'string')
}

/** Whether one of `lines` runs the package: see `lineRuns`. */
function runsOneOf(lines: readonly string[], pkg: ProjectPackage): boolean {
  const tool = { name: pkg.name, commands: Object.keys(packageBins(pkg.name, pkg.manifest.bin, pkg.dir)) }
  return lines.some(line => lineRuns(line, tool))
}

/** The project's own installed packages, less the names OpenAgent brings itself. */
export async function ownPackages(root: string): Promise<ProjectPackage[]> {
  return (await projectPackages(root)).filter(pkg => !OWN_PACKAGE_NAMES.includes(pkg.name))
}

/**
 * The services of the packages every project has: a package declares
 * `"openagent": { "service": "<command>" }`, and `<command> serve` runs for as long as OpenAgent
 * runs (`package-services.ts`). Only those packages: a service is this computer's, and a package
 * a project picked is that project's.
 */
export async function builtInServices(): Promise<ProvidedCommand[]> {
  return declaring((await (resolved ??= resolveOwn())).filter(pkg => !pkg.picked), 'service')
}

/** The directories the commands of OpenAgent's packages sit in: what a hook line's PATH gains after the project's own installed tools. */
export async function builtInBinDirs(): Promise<string[]> {
  const dirs = new Set<string>()
  for (const { name, dir, manifest } of await builtInPackages()) {
    for (const bin of Object.values(packageBins(name, manifest.bin, dir))) dirs.add(dirname(bin))
  }
  return [...dirs]
}

/** What provides `kind` in the project at `root`: a package the project installed for it, else one OpenAgent brings to this project. */
export async function lookupProvided(root: string, kind: string): Promise<ProvidedCommandLookup> {
  return lookupProvidedCommand(root, kind, await builtInPackagesOf(root), OWN_PACKAGE_NAMES)
}

/** {@link lookupProvided}'s command, for a caller that only needs to run it. */
export async function providedCommand(root: string, kind: string): Promise<ProvidedCommand | undefined> {
  return (await lookupProvided(root, kind)).command
}

/** Whether `command` comes from a package OpenAgent brings: one the project did not install. */
export function isBuiltIn(command: ProvidedCommand): boolean {
  return OWN_PACKAGE_NAMES.includes(command.package)
}

/**
 * Have every package that writes hook lines write its own into the project at `root`: a package
 * declares `"openagent": { "hooks": "<command>" }`, and `<command> init`, run in the project,
 * writes its lines into the project's hooks file, keeping every line already there. The project's
 * own packages are asked, then the ones OpenAgent brings to it. Answers one line per package
 * that could not write, in words.
 */
export async function writeHookLines(root: string): Promise<string[]> {
  const packages = [...(await ownPackages(root)), ...(await builtInPackagesOf(root))]
  const failed: string[] = []
  for (const command of declaring(packages, 'hooks')) {
    const result = await runPackageCommand(root, command, ['init'])
    if (!result.ok) failed.push(`${command.package}: ${result.error}`)
  }
  return failed
}

/**
 * Have every package that declares a clean-up remove what it left in the project at `root`: a
 * package declares `"openagent": { "cleanup": "<command>" }`, and `<command> cleanup`, run in the
 * project, answers `{ ok: true, removed, kept }`. The project's own packages are asked, then
 * every package OpenAgent brings, also one this project no longer has (what it left stays its
 * own to remove), each whatever the one before answered. A package that refuses, fails or answers
 * something else is one line in `failed`, in words.
 */
export async function runCleanups(root: string): Promise<CleanupReport> {
  const packages = [...(await ownPackages(root)), ...(await builtInPackages())]
  const report: CleanupReport = { removed: [], kept: [], failed: [] }
  for (const command of declaring(packages, 'cleanup')) {
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
