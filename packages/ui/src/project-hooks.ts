import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, delimiter, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { distributionBinDirs } from './distribution-packages.js'
import { errorMessage } from './error-message.js'
import { OPENAGENT_DIR } from './openagent-dir.js'

/**
 * A project's hooks (#1774): the shell lines a project's own `.openagent/hooks.yml` names to
 * run when the dashboard opens and when it closes: the scheduler's, which starts and stops with
 * the dashboard, until it does so as a module of its own (`app.lifecycle`, #2394's step 6). The
 * daemon calls no tool by name: it runs whatever the file says, in the project, with the commands
 * of the packages OpenAgent brings and then the project's installed tools on the PATH, so a line
 * reaches its tool with nothing fetched from npm. Per user, since `.openagent/` is ignored: a hook
 * is this machine's, and a teammate's pull changes nothing. Runs start through this computer's
 * host (`run.host`, #2394), never through a line.
 *
 * Optional, best-effort and bounded: no file means nothing runs, a broken file is a warning, a
 * line that fails or hangs is logged and the next line still runs, and nothing here ever throws to
 * the daemon.
 */

/** The hooks file, under the project's ignored `.openagent/`. */
export const PROJECT_HOOKS_FILE = `${OPENAGENT_DIR}/hooks.yml`

/** How long one line may run before it is killed and logged as timed out. */
export const HOOK_TIMEOUT_MS = 60_000

/** When a project's hooks run: `open` when the dashboard starts (and when the project is added while it runs), `close` when it stops. */
export type HookKind = 'open' | 'close'

export interface ProjectHooks {
  open: string[]
  close: string[]
}

const HOOK_KINDS: readonly HookKind[] = ['open', 'close']

/**
 * Read a project's hooks. A missing file is no hooks. A file that cannot be parsed or has the
 * wrong shape is reported through `onWarn`, prefixed "ignoring", and counts as no hooks.
 */
export async function readProjectHooks(cwd: string, onWarn?: (message: string) => void): Promise<ProjectHooks> {
  let raw: string
  try {
    raw = await readFile(join(cwd, PROJECT_HOOKS_FILE), 'utf8')
  } catch {
    return { open: [], close: [] }
  }
  try {
    return parseProjectHooks(raw)
  } catch (err) {
    onWarn?.(`ignoring ${errorMessage(err)}`)
    return { open: [], close: [] }
  }
}

/**
 * Parse the hooks file: a YAML map whose keys are `open` and `close`, each a list of shell lines.
 * An empty document is no hooks. Anything else throws, so the reader can warn: a wrong key is
 * refused rather than ignored, because a misspelled `open` would otherwise be a hook that
 * silently never runs.
 */
export function parseProjectHooks(raw: string, source = PROJECT_HOOKS_FILE): ProjectHooks {
  let data: unknown
  try {
    data = parseYaml(raw)
  } catch (err) {
    // The parser's message runs to several lines with a caret drawing; the first line says what is wrong.
    throw new Error(`${source}: ${errorMessage(err).split('\n')[0]}`)
  }
  const hooks: ProjectHooks = { open: [], close: [] }
  if (data == null) return hooks
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error(`${source} must be a YAML map; the keys are open and close`)
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!(HOOK_KINDS as readonly string[]).includes(key)) throw new Error(`${source}: unknown key "${key}"; the keys are open and close`)
    if (value == null) continue
    if (!Array.isArray(value) || !value.every(line => typeof line === 'string' && line.trim() !== '')) {
      throw new Error(`${source}: "${key}" must be a list of shell lines`)
    }
    hooks[key as HookKind] = value.map(line => line.trim())
  }
  return hooks
}

export interface RunHooksOptions {
  /** Where each line's outcome and the tool's stderr go; default nowhere. */
  log?: (line: string) => void
  /** How long one line may run; default {@link HOOK_TIMEOUT_MS}. */
  timeoutMs?: number
  /** The environment the lines run with; default the daemon's own. */
  env?: NodeJS.ProcessEnv
  /** The lines to run, of the ones the file holds; every line when absent. */
  only?: readonly string[]
}

/**
 * Run a project's `open` or `close` lines, in order, each through `sh -c` with the project's
 * root as working directory. A line that exits non-zero, times out or cannot start is logged and
 * the next line still runs; the lines' stderr is logged too, since a tool's one line for a person
 * goes there. Never throws.
 */
export async function runProjectHooks(cwd: string, kind: HookKind, opts: RunHooksOptions = {}): Promise<void> {
  const log = opts.log ?? (() => {})
  const hooks = await readProjectHooks(cwd, message => log(`[openagent] ${kind} hook (${basename(cwd)}): ${message}`))
  for (const line of hooks[kind]) {
    if (opts.only && !opts.only.includes(line)) continue
    const outcome = await runLine(cwd, line, opts.timeoutMs ?? HOOK_TIMEOUT_MS, opts.env ?? process.env)
    log(`[openagent] ${kind} hook (${basename(cwd)}): ${line}: ${outcome.summary}`)
    for (const said of outcome.stderr.split('\n').map(s => s.trimEnd()).filter(Boolean)) log(`[openagent]   ${said}`)
  }
}

/**
 * The environment a line runs with: the PATH led by the commands of the packages OpenAgent
 * brings, then the project's installed tools. So a tool of OpenAgent's named in a line is always
 * OpenAgent's copy, the one its pages and its data go through too, any other tool is the
 * project's, and nothing is a package fetched by name.
 */
async function hookEnv(cwd: string, env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  return { ...env, PATH: [...(await distributionBinDirs()), join(cwd, 'node_modules', '.bin'), env['PATH']].filter(Boolean).join(delimiter) }
}

/** One line through the shell: how it ended, in words, and what it said on stderr. */
async function runLine(cwd: string, line: string, timeoutMs: number, baseEnv: NodeJS.ProcessEnv): Promise<{ summary: string; stderr: string }> {
  const env = await hookEnv(cwd, baseEnv)
  return new Promise(resolve => {
    let stderr = ''
    let settled = false
    const done = (summary: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ summary, stderr })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('sh', ['-c', line], { cwd, env, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (err) {
      done(`could not start: ${errorMessage(err)}`)
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done(`timed out after ${Math.round(timeoutMs / 1000)}s`)
    }, timeoutMs)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', err => done(`could not start: ${errorMessage(err)}`))
    child.once('close', (code, signal) => done(signal ? `killed by ${signal}` : `exit ${code ?? 0}`))
  })
}
