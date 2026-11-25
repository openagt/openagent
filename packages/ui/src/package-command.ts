import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * A package as the shell has it (a distribution's, #2394): its package.json and its commands, and
 * how one of its commands is run in a project, its JSON output read.
 */

/** The fields of a package.json this module reads; anything else is ignored. */
export interface PackageManifest {
  name?: unknown
  version?: unknown
  /** What the package says it is, in a sentence or two. */
  description?: unknown
  exports?: unknown
  bin?: unknown
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
