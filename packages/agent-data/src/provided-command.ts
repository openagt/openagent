import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { errorMessage } from './git.js'

/**
 * Which package provides one kind of OpenAgent's data, and how its command is run (#1774, #1820).
 * A package declares what it provides in its own package.json, `"openagent": { "<kind>": "<command>" }`,
 * naming one of its own commands; OpenAgent and the scheduler name no package: whoever declares
 * the kind provides it. The packages asked are the caller's, a distribution's (#2394): a
 * project's own dependencies provide nothing.
 */

/** Where coding agents read a project's skills: Claude Code's folder, and the shared one Codex reads. */
export const SKILLS_DIRS = ['.claude/skills', '.agents/skills'] as const

/** The fields of a package.json this module reads; anything else is ignored. */
export interface PackageManifest {
  name?: unknown
  version?: unknown
  /** What the package says it is, in a sentence or two. */
  description?: unknown
  exports?: unknown
  bin?: unknown
  openagent?: unknown
}

/** A package, resolved: its directory (symlinks followed) and its package.json. */
export interface ProjectPackage {
  name: string
  dir: string
  manifest: PackageManifest
}

export async function readManifest(path: string): Promise<PackageManifest | undefined> {
  try {
    const data: unknown = JSON.parse(await readFile(path, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as PackageManifest) : undefined
  } catch {
    return undefined
  }
}

/** A package's commands: `bin` as one path (named after the package) or as a name → path map. */
export function packageBins(name: string, bin: unknown, pkgDir: string): Record<string, string> {
  if (typeof bin === 'string') return { [name.replace(/^@[^/]+\//, '')]: join(pkgDir, bin) }
  if (!bin || typeof bin !== 'object' || Array.isArray(bin)) return {}
  const bins: Record<string, string> = {}
  for (const [command, path] of Object.entries(bin)) if (typeof path === 'string') bins[command] = join(pkgDir, path)
  return bins
}

/** The command of a package that provides one kind of OpenAgent's data, by the package's declaration. */
export interface ProvidedCommand {
  /** The package that declares it. */
  package: string
  /** The command's name, one of the package's own commands. */
  name: string
  /** The command's script, an absolute path inside the package. */
  bin: string
  /** The package's folder. */
  dir: string
}

/**
 * What looking a kind up found: its command, or nothing. `problem` is why nothing, when someone
 * has to act: several packages provide the kind. Nobody declaring the kind is no problem: the
 * project has none of that data.
 */
export type ProvidedCommandLookup = { command: ProvidedCommand; problem?: undefined } | { command?: undefined; problem?: string }

/** The `openagent` object of a manifest, when it has one. */
function declaredFor(manifest: PackageManifest, kind: string): unknown {
  const declared = manifest.openagent
  return declared && typeof declared === 'object' && !Array.isArray(declared) ? (declared as Record<string, unknown>)[kind] : undefined
}

/** The commands among `packages` that declare `kind`, each naming one of its package's own commands. */
export function declaring(packages: readonly ProjectPackage[], kind: string): ProvidedCommand[] {
  const providers: ProvidedCommand[] = []
  for (const { name, dir, manifest } of packages) {
    const declared = declaredFor(manifest, kind)
    if (typeof declared !== 'string') continue
    const bin = packageBins(name, manifest.bin, dir)[declared]
    if (bin !== undefined) providers.push({ package: name, name: declared, bin, dir })
  }
  return providers
}

/** What a package's command answered: its JSON output, or why there is none. */
export type PackageCommandResult = { ok: true; output: unknown } | { ok: false; error: string }

/** How long a package's command may run, and how much it may print. */
export const COMMAND_TIMEOUT_MS = 30_000
export const COMMAND_MAX_OUTPUT = 16 * 1024 * 1024

/**
 * Run one package command in the project and read its standard output as JSON: with Node (a
 * package's commands are Node scripts), in the project root, never through a shell, bounded in
 * time and output. A command that exits non-zero answers its last stderr line; one that prints no
 * JSON says so. `more` is what the command is started with beside what this process itself has.
 * `input` is what it reads on standard input: a login handed to it there is on no command line.
 */
export async function runPackageCommand(root: string, command: { name: string; bin: string }, args: readonly string[], more?: NodeJS.ProcessEnv, input?: string): Promise<PackageCommandResult> {
  const { name, bin } = command
  const run = await new Promise<{ failed?: string; stdout: string }>(resolvePromise => {
    const child = execFile(
      process.execPath,
      [bin, ...args],
      { cwd: root, timeout: COMMAND_TIMEOUT_MS, maxBuffer: COMMAND_MAX_OUTPUT, encoding: 'utf8', ...(more ? { env: { ...process.env, ...more } } : {}) },
      (error, stdout, stderr) => {
        if (!error) return resolvePromise({ stdout })
        const said = failureLine(stderr, (error as { code?: unknown }).code)
        const failed =
          (error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
            ? `${name} printed too much`
            : error.killed
              ? `${name} took too long`
              : said || `${name} failed: ${error.message}`
        resolvePromise({ failed, stdout })
      },
    )
    // A command that reads nothing finds its input ended, never waiting for what does not come.
    child.stdin?.on('error', () => {})
    child.stdin?.end(input ?? '')
  })
  if (run.failed !== undefined) return { ok: false, error: run.failed }
  try {
    return { ok: true, output: JSON.parse(run.stdout) as unknown }
  } catch {
    return { ok: false, error: `${name} printed no JSON` }
  }
}

/** What a failed command said, as one line: a refusal's reason is its last line; a wrong command line (exit 2) says what was wrong first, then where the usage is. */
function failureLine(stderr: string, code: unknown): string | undefined {
  const lines = stderr.trim().split('\n')
  return (code === 2 ? lines[0] : lines.at(-1))?.trim()
}

/** The function a package's command script calls, exported beside it: the same command line, the same JSON on `stdout`, the exit code it answers. */
type PackageCli = (argv: string[], io: { cwd: string; stdout(line: string): void; stderr(line: string): void }) => Promise<number>

/** Each package's exported `runCli`, by folder, loaded once; `undefined` for a package that exports none. */
const clis = new Map<string, Promise<PackageCli | undefined>>()

function packageCli({ package: name, dir }: ProvidedCommand): Promise<PackageCli | undefined> {
  let known = clis.get(dir)
  if (!known) {
    known = (async () => {
      // The package by its own name from its own folder: its main export, never another copy found further up.
      const entry = createRequire(join(dir, 'package.json')).resolve(name)
      if (!entry.startsWith(dir + sep)) return undefined
      const loaded = (await import(pathToFileURL(entry).href)) as { runCli?: unknown }
      return typeof loaded.runCli === 'function' ? (loaded.runCli as PackageCli) : undefined
    })().catch(() => undefined)
    clis.set(dir, known)
  }
  return known
}

/**
 * {@link runPackageCommand}, answered inside this process when the package exports the function its
 * command's script calls, `runCli(argv, io)`: no Node is started for it, which is most of what a
 * command costs on a small computer, for a caller that reads every few seconds. A package that
 * exports none is run as its command. Takes neither an environment nor an input: a call that
 * needs either runs the command.
 */
export async function callPackageCommand(root: string, command: ProvidedCommand, args: readonly string[]): Promise<PackageCommandResult> {
  const cli = await packageCli(command)
  if (!cli) return runPackageCommand(root, command, args)
  let stdout = ''
  let stderr = ''
  const code = await cli([...args], {
    cwd: root,
    stdout: line => {
      stdout += `${line}\n`
    },
    stderr: line => {
      stderr += `${line}\n`
    },
  }).catch((err: unknown) => {
    stderr += errorMessage(err)
    return 1
  })
  if (code !== 0) return { ok: false, error: failureLine(stderr, code) || `${command.name} failed` }
  try {
    return { ok: true, output: JSON.parse(stdout) as unknown }
  } catch {
    return { ok: false, error: `${command.name} printed no JSON` }
  }
}
