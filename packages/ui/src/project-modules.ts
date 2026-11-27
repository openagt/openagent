import { realpath, stat } from 'node:fs/promises'
import { callerEnv } from '@openagt/hooks'
import { currentCaller } from './team/caller.js'
import { dirname, join, normalize, sep } from 'node:path'
import { packageBins, runPackageCommand, type PackageCommandResult, type ProjectPackage } from './package-command.js'
import { computerPackages, packagesOf, projectsPackages } from './distribution-packages.js'

/**
 * A package that adds UI (#1774): its browser part, named by its `exports["./dashboard"]`, and
 * optionally its server part, named by `exports["./server"]`. Any package of the distribution
 * that exports `./dashboard` is a module, whoever wrote it.
 */
export interface ProjectModule {
  /** The package's name. */
  package: string
  /** The package's version, when its package.json says one. */
  version?: string
  /** The directory the module's browser part sits in, symlinks resolved: the only directory served for it. */
  dir: string
  /** The module's browser part's file name inside {@link dir}. */
  entry: string
  /** The package's commands, by name, as absolute paths: what the module may run, in this project or, for one of the computer's, in none. */
  bins: Record<string, string>
  /**
   * The module's server part, an absolute path inside the package, when it has one: the functions
   * its pages read through, each a `read` or an `act` (`@openagt/hooks/rpc`), the reads alone what
   * a computer that lets its server only watch answers of the module.
   */
  server?: string
}

/** The file an `exports[key]` entry names: a plain path, or the first of `conditions` it has. */
function exportedFile(exports: unknown, key: string, conditions: readonly string[]): string | undefined {
  if (!exports || typeof exports !== 'object' || Array.isArray(exports)) return undefined
  const entry = (exports as Record<string, unknown>)[key]
  if (typeof entry === 'string') return entry
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined
  for (const condition of conditions) {
    const target = (entry as Record<string, unknown>)[condition]
    if (typeof target === 'string') return target
  }
  return undefined
}

/** Whether `path` is `dir` itself or inside it; both already normalized. */
function within(dir: string, path: string): boolean {
  return path === dir || path.startsWith(dir + sep)
}

/** The file `target` names inside the package at `pkgDir`, symlinks resolved; undefined when it is no file there. */
async function fileInside(pkgDir: string, target: string | undefined): Promise<string | undefined> {
  if (!target) return undefined
  const file = await realpath(join(pkgDir, target)).catch(() => undefined)
  if (!file || !within(pkgDir, file) || !(await stat(file).then(s => s.isFile()).catch(() => false))) return undefined
  return file
}

/** The module a package is, or undefined when it exports no `./dashboard` to a file inside it. */
export async function readModule({ name, dir: pkgDir, manifest: pkg }: ProjectPackage): Promise<ProjectModule | undefined> {
  const file = await fileInside(pkgDir, exportedFile(pkg.exports, './dashboard', ['browser', 'import', 'default']))
  if (!file) return undefined
  const server = await fileInside(pkgDir, exportedFile(pkg.exports, './server', ['node', 'import', 'default']))
  const bins = packageBins(name, pkg.bin, pkgDir)
  return {
    package: name,
    ...(typeof pkg.version === 'string' ? { version: pkg.version } : {}),
    dir: dirname(file),
    entry: file.slice(dirname(file).length + 1),
    bins,
    ...(server ? { server } : {}),
  }
}

/**
 * The file a module serves at `rel`, a path relative to its module's directory: its module, its
 * stylesheet, a chunk. `undefined` for a path that leaves that directory (symlinks resolved) or
 * names no file, so nothing else of the package, and nothing of the project, is ever served.
 */
export async function moduleFile(module: ProjectModule, rel: string): Promise<string | undefined> {
  if (!rel) return undefined
  const candidate = await realpath(normalize(join(module.dir, rel))).catch(() => undefined)
  if (!candidate || !within(module.dir, candidate)) return undefined
  return (await stat(candidate).then(s => s.isFile()).catch(() => false)) ? candidate : undefined
}

/** What a module's command answered: its JSON output, or why there is none. */
export type ModuleCommandResult = PackageCommandResult

/** How many arguments, and how long each, a module may pass: a command line, not a payload. */
const MAX_ARGS = 32
const MAX_ARG_LENGTH = 4096

/**
 * Run one of a module package's own commands in the project, with the given arguments, and read
 * its standard output as JSON. This is how a module reads its data: the same command an agent runs
 * (`npx @openagt/logs@0.1`), so the module and the agent see the same thing and OpenAgent knows neither.
 *
 * `command` picks one of the package's commands; a package with exactly one needs none. The
 * command runs with Node (a package's commands are Node scripts), in `root` (the project's, or
 * the person's home folder for a module of the computer's), never
 * through a shell, bounded in time and output. Refused: a command the package does not have, too
 * many or too long arguments. A command that exits non-zero answers its last stderr line; one that
 * prints no JSON says so.
 */
export async function runModuleCommand(
  root: string,
  module: ProjectModule,
  args: readonly string[],
  command?: string,
  /** What the command reads on standard input. */
  input?: string,
): Promise<ModuleCommandResult> {
  const names = Object.keys(module.bins)
  const name = command ?? (names.length === 1 ? names[0] : undefined)
  const bin = name !== undefined ? module.bins[name] : undefined
  if (bin === undefined)
    return { ok: false, error: command !== undefined ? `${module.package} has no command ${command}` : `${module.package} has ${names.length === 0 ? 'no command' : 'several commands; name one'}` }
  if (args.length > MAX_ARGS || args.some(arg => typeof arg !== 'string' || arg.length > MAX_ARG_LENGTH))
    return { ok: false, error: 'too many or too long arguments' }
  // A command run for a person of a team knows whom for (`callerFromEnv`): what it lists and changes is theirs.
  const caller = currentCaller()
  return runPackageCommand(root, { name: name!, bin }, args, caller ? callerEnv(caller) : undefined, input)
}

/**
 * The modules a project has: the ones among the distribution's packages it has
 * (`distribution-packages.ts`: a plugin's where it is on in the project), each whose package.json
 * exports `./dashboard` to a file that exists inside the package. Sorted by name.
 */
export async function readProjectModules(root: string): Promise<ProjectModule[]> {
  const modules: ProjectModule[] = []
  for (const pkg of await packagesOf(root)) {
    const module = await readModule(pkg)
    if (module) modules.push(module)
  }
  return modules.sort((a, b) => a.package.localeCompare(b.package))
}

/** The one module of this project that `name` names, or undefined. */
export async function findProjectModule(root: string, name: string): Promise<ProjectModule | undefined> {
  return (await readProjectModules(root)).find(module => module.package === name)
}

/**
 * The modules that are this computer's and no project's: the ones among the distribution's
 * packages for the computer (`distribution-packages.ts`). They are there with no project added.
 * Sorted by name.
 */
export async function readComputerModules(): Promise<ProjectModule[]> {
  const modules: ProjectModule[] = []
  for (const pkg of await computerPackages()) {
    const module = await readModule(pkg)
    if (module) modules.push(module)
  }
  return modules.sort((a, b) => a.package.localeCompare(b.package))
}

/** The one module of this computer's that `name` names, or undefined. */
export async function findComputerModule(name: string): Promise<ProjectModule | undefined> {
  return (await readComputerModules()).find(module => module.package === name)
}

/**
 * The module of a package of the distribution a project can have, from the distribution's own
 * copy: the page of another computer's project, on a computer where no project of its own has it.
 * Undefined for any other package.
 */
export async function findBroughtModule(name: string): Promise<ProjectModule | undefined> {
  const pkg = (await projectsPackages()).find(brought => brought.name === name)
  return pkg ? readModule(pkg) : undefined
}
