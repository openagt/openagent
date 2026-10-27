import { realpath, stat } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { packageBins, runPackageCommand, type PackageCommandResult, type ProjectPackage } from '@openagt/agent-data'
import { broughtToProjects, builtInPackagesOf, computerPackages, ownPackages } from './built-in.js'

/**
 * A package that adds to the dashboard (#1774): its browser part, named by its
 * `exports["./dashboard"]`, and optionally its server part, named by `exports["./server"]`.
 * Any dependency of the project that exports `./dashboard` is a module, whoever wrote it, and the
 * packages OpenAgent brings itself come the same way, for the projects that have them
 * (`built-in.ts`). A package that is this computer's is a module of no project: see
 * {@link readComputerModules}.
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
  /** The module's server part, an absolute path inside the package, when it has one. */
  server?: string
  /**
   * The commands that only read, by command name: the first word of the arguments, or `""` for
   * the command with no word (flags only). What a computer that lets its server only watch answers
   * of the module; any other command changes something there, and is refused. The package says
   * them: `"openagent": { "reads": { "<command>": ["list", ""] } }`.
   */
  reads: Record<string, string[]>
}

/** The commands a package says only read, of the ones it has: anything else in its word is dropped. */
function readsOf(openagent: unknown, bins: Record<string, string>): Record<string, string[]> {
  const said = openagent && typeof openagent === 'object' ? (openagent as Record<string, unknown>)['reads'] : undefined
  if (!said || typeof said !== 'object' || Array.isArray(said)) return {}
  const reads: Record<string, string[]> = {}
  for (const [name, words] of Object.entries(said)) {
    if (!Object.hasOwn(bins, name) || !Array.isArray(words)) continue
    reads[name] = words.filter((word): word is string => typeof word === 'string' && !word.startsWith('-'))
  }
  return reads
}

/**
 * Whether running the module's command with these arguments only reads, as its package says
 * ({@link ProjectModule.reads}): its first word is a read, or it has no word and its bare form is
 * one, every argument then being a flag.
 */
export function commandReads(module: Pick<ProjectModule, 'bins' | 'reads'>, args: readonly unknown[], command?: string): boolean {
  const names = Object.keys(module.bins)
  const name = command ?? (names.length === 1 ? names[0] : undefined)
  const words = name !== undefined && Object.hasOwn(module.reads, name) ? module.reads[name]! : []
  if (!args.every(arg => typeof arg === 'string')) return false
  const first = args[0] as string | undefined
  if (first === undefined || first.startsWith('-')) return words.includes('') && (args as string[]).every(arg => arg.startsWith('-'))
  return words.includes(first)
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

/**
 * The modules a project has: each of its dependencies whose package.json exports `./dashboard` to
 * a file that exists inside the package, plus the modules among the packages OpenAgent brings to
 * this project (`built-in.ts`): a skill's page where the project holds the skill's text. Sorted
 * by name.
 */
export async function readProjectModules(root: string): Promise<ProjectModule[]> {
  const modules: ProjectModule[] = []
  for (const pkg of [...(await ownPackages(root)), ...(await builtInPackagesOf(root))]) {
    const module = await readModule(pkg)
    if (module) modules.push(module)
  }
  return modules.sort((a, b) => a.package.localeCompare(b.package))
}

async function readModule({ name, dir: pkgDir, manifest: pkg }: ProjectPackage): Promise<ProjectModule | undefined> {
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
    reads: readsOf(pkg.openagent, bins),
  }
}

/** The one module of this project that `name` names, or undefined. */
export async function findProjectModule(root: string, name: string): Promise<ProjectModule | undefined> {
  return (await readProjectModules(root)).find(module => module.package === name)
}

/**
 * The modules that are this computer's and no project's: the ones among the packages OpenAgent
 * brings for the computer (`built-in.ts`). They are there with no project added. Sorted by name.
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
 * The module of a package OpenAgent brings to projects, from OpenAgent's own copy: the page of
 * another computer's project, on a computer where no project of its own has it. Undefined for any
 * other package.
 */
export async function findBroughtModule(name: string): Promise<ProjectModule | undefined> {
  const pkg = (await broughtToProjects()).find(brought => brought.name === name)
  return pkg ? readModule(pkg) : undefined
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
 * (`npx @openagt/skill-logs@0.1`), so the module and the agent see the same thing and OpenAgent knows neither.
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
  /** What the command is started with, beside what this process itself has. */
  more?: NodeJS.ProcessEnv,
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
  return runPackageCommand(root, { name: name!, bin }, args, more, input)
}
