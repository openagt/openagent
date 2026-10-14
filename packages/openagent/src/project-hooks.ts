import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, delimiter, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { builtInBinDirs } from './built-in.js'
import { errorMessage } from './error-message.js'
import { OPENAGENT_DIR } from './openagent-dir.js'

/**
 * A project's hooks (#1774): the shell lines a project's own `.openagent/hooks.yml` names to
 * run when the dashboard opens and when it closes, the two lines that start a run and continue
 * one, and the line that says whether a run can start here at all. The daemon calls no tool by
 * name: it runs whatever the file says, in the project, with the commands of the packages
 * OpenAgent brings and then the project's installed tools on the PATH, so a line reaches its tool with nothing fetched from npm. Per
 * user, since `.openagent/` is ignored: a hook is this machine's, and a teammate's pull
 * changes nothing.
 *
 * Optional, best-effort and bounded: no file means nothing runs, a broken file is a warning, an
 * `open` or `close` line that fails or hangs is logged and the next line still runs, and nothing
 * here ever throws to the daemon.
 */

/** The hooks file, under the project's ignored `.openagent/`. */
export const PROJECT_HOOKS_FILE = `${OPENAGENT_DIR}/hooks.yml`

/** How long one line may run before it is killed and logged as timed out. */
export const HOOK_TIMEOUT_MS = 60_000

/** When a project's hooks run: `open` when the dashboard starts (and when the project is added while it runs), `close` when it stops. */
export type HookKind = 'open' | 'close'

/**
 * The two lines a person's click runs to start or continue a run: `start` begins a run from a
 * prompt, `resume` continues an ended one with a text or an answer. One line each, since each
 * answers one document on stdout.
 */
export type RunHookKind = 'start' | 'resume'

/** The one-shell-line hooks: the two run lines, and `check`, which the launcher runs to say before a Start what would stop the run. */
type OneLineHookKind = RunHookKind | 'check'

export interface ProjectHooks {
  open: string[]
  close: string[]
  start?: string
  resume?: string
  check?: string
}

const HOOK_KINDS: readonly HookKind[] = ['open', 'close']
const ONE_LINE_HOOK_KINDS: readonly OneLineHookKind[] = ['start', 'resume', 'check']

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
 * Parse the hooks file: a YAML map whose keys are `open` and `close`, each a list of shell lines,
 * and `start`, `resume` and `check`, each one shell line. An empty document is no hooks. Anything else throws, so the reader can warn: a wrong key is
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
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error(`${source} must be a YAML map; the keys are open, close, start, resume and check`)
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const isOneLine = (ONE_LINE_HOOK_KINDS as readonly string[]).includes(key)
    if (!isOneLine && !(HOOK_KINDS as readonly string[]).includes(key)) throw new Error(`${source}: unknown key "${key}"; the keys are open, close, start, resume and check`)
    if (value == null) continue
    if (isOneLine) {
      if (typeof value !== 'string' || value.trim() === '') throw new Error(`${source}: "${key}" must be one shell line`)
      hooks[key as OneLineHookKind] = value.trim()
      continue
    }
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

/** What a `start` line is given: the prompt, the coding agent, model, publish level and branch to start from when the person picked them, and the follow-up when there is one. */
export interface StartHookInput {
  prompt: string
  driver?: string
  model?: string
  /** How hard the model may think, by the coding agent's own names. */
  effort?: string
  /** A fresh agent's prompt once the run ends done with a pull request; the merge waits for it. */
  then?: string
  /** How far the run takes its work when its agent finishes: `commit`, `branch`, `pr` or `merge`. */
  publish?: string
  /** The branch the run's own branch starts from; origin's default branch when absent. */
  base?: string
  /**
   * Whether the run is given a short name by a small model (the person's setting). `false` reaches
   * the run's own tool through the environment rather than the line, so no project's `hooks.yml`
   * has to carry it; absent means named, which is what every run was before the setting existed.
   */
  nameRun?: boolean
}

/**
 * Whether a `start` line passes the branch to start from on: it mentions `$BASE` or `${BASE`. A
 * line is written once and kept, so one written before the pick existed, or a person's own, may
 * not; the launcher then offers no pick, rather than one the line would drop.
 */
export function startLineTakesBase(line: string): boolean {
  return /\$\{?BASE\b/.test(line)
}

/** What a `resume` line is given: the run, and the person's text or their answer to the question it ended on. */
export type ResumeHookInput = { runId: string } & ({ text: string } | { answer: string })

/** How a `start` or `resume` line went: the run it named, and the coding agent it said runs it, when it said one. */
export type RunHookResult = { ok: true; id: string; driver?: string } | { ok: false; error: string }

/**
 * Run the project's `start` line: the prompt in `PROMPT`, the picks in `DRIVER`, `MODEL`, `EFFORT`,
 * `PUBLISH` and `BASE` when made, the follow-up in `THEN` when there is one. The line answers one JSON
 * document on stdout whose `id` names the run it started, and whose `driver` may name the coding
 * agent that runs it.
 */
export function runStartHook(cwd: string, input: StartHookInput, opts: Omit<RunHooksOptions, 'log'> = {}): Promise<RunHookResult> {
  return runRunHook(cwd, 'start', {
    PROMPT: input.prompt,
    // Not for the line to pass on: the run's own tool reads it from the environment it is started
    // in, since it is the hook's own child. So turning naming off needs no `hooks.yml` of any
    // project changed, which a setting nobody can act on would not be a setting at all.
    ...(input.nameRun === false ? { OPENAGENT_NAME_RUN: '0' } : {}),
    ...(input.driver !== undefined ? { DRIVER: input.driver } : {}),
    ...(input.model !== undefined ? { MODEL: input.model } : {}),
    ...(input.effort !== undefined ? { EFFORT: input.effort } : {}),
    ...(input.then !== undefined ? { THEN: input.then } : {}),
    ...(input.publish !== undefined ? { PUBLISH: input.publish } : {}),
    ...(input.base !== undefined ? { BASE: input.base } : {}),
  }, opts)
}

/**
 * Run the project's `resume` line: the run in `RUN_ID`, and the person's words in `TEXT` or their
 * answer in `ANSWER`. The line answers like a `start` line, naming the run it continued.
 */
export function runResumeHook(cwd: string, input: ResumeHookInput, opts: Omit<RunHooksOptions, 'log'> = {}): Promise<RunHookResult> {
  return runRunHook(cwd, 'resume', { RUN_ID: input.runId, ...('text' in input ? { TEXT: input.text } : { ANSWER: input.answer }) }, opts)
}

async function runRunHook(cwd: string, kind: RunHookKind, vars: Record<string, string>, opts: Omit<RunHooksOptions, 'log'>): Promise<RunHookResult> {
  let broken: string | undefined
  const hooks = await readProjectHooks(cwd, message => {
    broken = message
  })
  const line = hooks[kind]
  if (line === undefined) return { ok: false, error: broken ?? `this project has no ${kind} hook` }
  const outcome = await runLine(cwd, line, opts.timeoutMs ?? HOOK_TIMEOUT_MS, { ...(opts.env ?? process.env), ...vars }, true)
  let said: unknown
  try {
    said = JSON.parse(outcome.stdout)
  } catch {
    said = undefined
  }
  const { id, driver } = (said && typeof said === 'object' ? said : {}) as Record<string, unknown>
  if (outcome.summary === 'exit 0' && typeof id === 'string' && id !== '') return { ok: true, id, ...(typeof driver === 'string' && driver !== '' ? { driver } : {}) }
  // The tool's one line for a person is its last on stderr; without one, how the line ended.
  const lastSaid = outcome.stderr.split('\n').map(s => s.trim()).filter(Boolean).at(-1)
  return { ok: false, error: `the ${kind} hook: ${lastSaid ?? (outcome.summary === 'exit 0' ? 'it answered no run id' : outcome.summary)}` }
}

/** What stands in the way of a run: problems stop it, warnings do not. One line each, each naming its fix. */
export interface StartReadiness {
  problems: string[]
  warnings: string[]
}

/** How a `check` line went; `noHook` when the project's file names no such line. */
export type CheckHookResult = ({ ok: true } & StartReadiness) | { ok: false; error: string; noHook?: true }

/**
 * Run the project's `check` line: the coding agent the person picked in `DRIVER`, when picked.
 * The line answers one JSON document on stdout with `problems` and `warnings`, lists of lines.
 */
export async function runCheckHook(cwd: string, input: { driver?: string }, opts: Omit<RunHooksOptions, 'log'> = {}): Promise<CheckHookResult> {
  let broken: string | undefined
  const hooks = await readProjectHooks(cwd, message => {
    broken = message
  })
  if (hooks.check === undefined) return broken ? { ok: false, error: broken } : { ok: false, error: 'this project has no check hook', noHook: true }
  const vars = input.driver !== undefined ? { DRIVER: input.driver } : {}
  const outcome = await runLine(cwd, hooks.check, opts.timeoutMs ?? HOOK_TIMEOUT_MS, { ...(opts.env ?? process.env), ...vars }, true)
  let said: unknown
  try {
    said = JSON.parse(outcome.stdout)
  } catch {
    said = undefined
  }
  const lines = (key: string): string[] | undefined => {
    const value = said && typeof said === 'object' ? (said as Record<string, unknown>)[key] : undefined
    return Array.isArray(value) && value.every(line => typeof line === 'string') ? value : undefined
  }
  const problems = lines('problems')
  const warnings = lines('warnings')
  if (outcome.summary === 'exit 0' && problems && warnings) return { ok: true, problems, warnings }
  const lastSaid = outcome.stderr.split('\n').map(s => s.trim()).filter(Boolean).at(-1)
  return { ok: false, error: `the check hook: ${lastSaid ?? (outcome.summary === 'exit 0' ? 'it answered no problems and warnings' : outcome.summary)}` }
}

/**
 * The environment a line runs with: the PATH led by the commands of the packages OpenAgent
 * brings, then the project's installed tools. So a tool of OpenAgent's named in a line is always
 * OpenAgent's copy, the one its pages and its data go through too, any other tool is the
 * project's, and nothing is a package fetched by name.
 */
export async function hookEnv(cwd: string, env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  return { ...env, PATH: [...(await builtInBinDirs()), join(cwd, 'node_modules', '.bin'), env['PATH']].filter(Boolean).join(delimiter) }
}

/** One line through the shell: how it ended, in words, what it said on stderr, and its stdout when asked for. */
async function runLine(cwd: string, line: string, timeoutMs: number, baseEnv: NodeJS.ProcessEnv, readStdout = false): Promise<{ summary: string; stderr: string; stdout: string }> {
  const env = await hookEnv(cwd, baseEnv)
  return new Promise(resolve => {
    let stderr = ''
    let stdout = ''
    let settled = false
    const done = (summary: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ summary, stderr, stdout })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('sh', ['-c', line], { cwd, env, stdio: ['ignore', readStdout ? 'pipe' : 'ignore', 'pipe'] })
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
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.once('error', err => done(`could not start: ${errorMessage(err)}`))
    child.once('close', (code, signal) => done(signal ? `killed by ${signal}` : `exit ${code ?? 0}`))
  })
}
