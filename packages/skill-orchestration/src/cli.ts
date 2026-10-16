import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { nodeGitRunner } from '@openagt/agent-data'
import { projectRoot } from '@openagt/skill-branches'
import { isPidAlive, readyToRun, spawnRun, withdrawMarker, writeMarker } from '@openagt/agent-runner'
import { parseSettings, readSettings, writeSettings } from './settings.js'
import { cleanup } from './cleanup.js'
import { runCommand } from './check.js'
import { Refused, landSubagent, listSubagents, nextTasks, readSubagent, retrySubagent, savePlan, showPlan, startSubagent, stopSubagent, type Started, type SubagentDeps } from './subagents.js'

/**
 * The `orchestration` command: JSON on stdout, one line for a person on stderr, and the exit code
 * says how it went — 0 for a result, 1 for a refusal or a failure, 2 for a command line that
 * could not be read.
 */

export const USAGE = `usage: orchestration <command>

  plan <file>       save the file as your plan; answers the \`tasks\` it was read as and the \`question\` to ask
                    the person; refused when the file is no task list
  plan              your saved plan, its tasks, its question, and whether the person approved it
  start --task <id> start a subagent on that task of your plan, on a branch started from yours, on the coding
                    agent and model the person set for the task's level; answers its id at once; refused until
                    the person approved your saved plan, for a task of any uncertainty, for one whose \`Needs:\`
                    tasks are not landed, and while as many of your subagents run as the person allows
  next              every task of your plan and where it stands — landed, running, ended and not landed, waiting
                    for another task, yours to do, or startable — and how many more subagents may run at once
  retry <id> "<feedback>"
                    another subagent on the task that one did, on a branch started from yours, told what to do
                    differently; refused while that subagent is running, and by every rule start holds to
  settings          the person's settings for subagents on this machine
  settings <json>   save them whole: {"simple": {"driver", "model"}, "hard": {...}, "atOnce": <n>}, each optional
  list              your subagents, newest first
  read <id>         one subagent: how it stands, its branch, and its last reply as \`result\`
  stop <id>         stop a subagent that is running
  land <id>         merge an ended subagent's branch into yours, run the \`Check:\` line of the task it did, and
                    the plan's own check when that was the last task, then delete that branch; a check that
                    fails is refused with its output, and the merge and the branch stay
  cleanup           remove what this package left in the project: the settings file, then .orchestration/ and the rule hiding it from git once it is empty;
                    the command a dashboard asks for when a project is removed with its files

JSON on stdout. Exit code 1 for a refusal or a failure (\`reason\` in the JSON, why on stderr), 2 for a usage error.`

export interface CliIo {
  cwd: string
  env: NodeJS.ProcessEnv
  stdout: (line: string) => void
  stderr: (line: string) => void
}

class Usage extends Error {}

export async function runCli(argv: string[], io: CliIo, given: Partial<SubagentDeps> = {}): Promise<number> {
  const deps: SubagentDeps = { git: nodeGitRunner(), host: hostname(), isAlive: isPidAlive, stop: pid => void process.kill(pid, 'SIGTERM'), ready: readyToRun, now: () => new Date(), mark: writeMarker, unmark: withdrawMarker, spawn: spawnRun, run: runCommand, ...given }
  const [command, ...rest] = argv
  const run = command && Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined
  if (!run) {
    io.stderr(USAGE)
    return 2
  }
  try {
    io.stdout(JSON.stringify(await run(rest, io, deps)))
    return 0
  } catch (err) {
    if (err instanceof Usage) {
      io.stderr(`${err.message}\n\n${USAGE}`)
      return 2
    }
    if (err instanceof Refused) {
      io.stdout(JSON.stringify(err.outcome))
      io.stderr(err.line)
      return 1
    }
    const detail = err instanceof Error ? err.message : String(err)
    io.stdout(JSON.stringify({ ok: false, reason: 'failed', detail }))
    io.stderr(detail)
    return 1
  }
}

type Command = (args: string[], io: CliIo, deps: SubagentDeps) => Promise<unknown>

const COMMANDS: Record<string, Command> = {
  async plan(args, io, deps) {
    let parsed
    try {
      parsed = parseArgs({ args, options: {}, allowPositionals: true, strict: true })
    } catch (err) {
      throw new Usage(err instanceof Error ? err.message : String(err))
    }
    const [file, ...more] = parsed.positionals
    if (more.length > 0) throw new Usage(`expected at most 1 argument, got ${parsed.positionals.length}`)
    const repo = await project(io.cwd, deps)
    if (file === undefined) return { ok: true, ...(await showPlan(repo, io.env, deps)) }
    const text = await readFile(resolve(io.cwd, file), 'utf8').catch(() => {
      throw new Refused({ ok: false, reason: 'no-file', file }, `${file} cannot be read`)
    })
    if (!text.trim()) throw new Refused({ ok: false, reason: 'empty', file }, `${file} is empty`)
    return { ok: true, ...(await savePlan(repo, io.env, text, deps)) }
  },

  async start(args, io, deps) {
    const { values } = parse(args, { task: { type: 'string' } }, 0)
    const task = values.task?.trim()
    if (!task) throw new Usage('say which task of your plan to start with --task <id>')
    return said(await startSubagent(await project(io.cwd, deps), io.env, { task }, deps), io)
  },

  async next(args, io, deps) {
    parse(args, {}, 0)
    return { ok: true, ...(await nextTasks(await project(io.cwd, deps), io.env, deps)) }
  },

  async retry(args, io, deps) {
    // The feedback is one argument of the main agent's own words, which may begin with a dash: it
    // is taken as it stands and never read as an option.
    const [id, feedback, ...more] = args
    if (id === undefined || id.startsWith('-') || feedback === undefined || more.length > 0) throw new Usage('expected 2 argument(s): retry <id> "<what to do differently>"')
    if (!feedback.trim()) throw new Usage('say in the second argument what the next subagent should do differently')
    return said(await retrySubagent(await project(io.cwd, deps), io.env, id, feedback.trim(), deps), io)
  },

  async settings(args, io, deps) {
    let parsed
    try {
      parsed = parseArgs({ args, options: {}, allowPositionals: true, strict: true })
    } catch (err) {
      throw new Usage(err instanceof Error ? err.message : String(err))
    }
    const [given, ...more] = parsed.positionals
    if (more.length > 0) throw new Usage(`expected at most 1 argument, got ${parsed.positionals.length}`)
    const repo = await project(io.cwd, deps)
    if (given === undefined) return { ok: true, ...(await readSettings(repo)) }
    let json: unknown
    try {
      json = JSON.parse(given)
    } catch {
      throw new Usage('the settings are not JSON')
    }
    const read = parseSettings(json)
    if (!read.ok) throw new Usage(read.error)
    await writeSettings(repo, read.settings, deps.git)
    return { ok: true, ...read.settings }
  },

  async list(args, io, deps) {
    parse(args, {}, 0)
    return listSubagents(await project(io.cwd, deps), io.env)
  },

  async read(args, io, deps) {
    const { positionals } = parse(args, {}, 1)
    return { ok: true, ...(await readSubagent(await project(io.cwd, deps), io.env, positionals[0]!)) }
  },

  async stop(args, io, deps) {
    const { positionals } = parse(args, {}, 1)
    return { ok: true, ...(await stopSubagent(await project(io.cwd, deps), io.env, positionals[0]!, deps)) }
  },

  async land(args, io, deps) {
    const { positionals } = parse(args, {}, 1)
    return { ok: true, ...(await landSubagent(await project(io.cwd, deps), io.env, positionals[0]!, deps)) }
  },

  async cleanup(args, io, deps) {
    parse(args, {}, 0)
    return cleanup(await project(io.cwd, deps), deps.git)
  },
}

/** A subagent started, with what the agent is told beside it: neither of these stops a start. */
function said(started: Started, io: CliIo): { ok: true } & Started {
  if (started.uncommitted) io.stderr('your checkout has uncommitted changes: the subagent does not have them')
  for (const other of started.sharedFiles ?? []) io.stderr(`${other.id} is running "${other.task}", which owns ${other.files.join(', ')} too: two agents writing one file conflict when you land the second`)
  return { ok: true, ...started }
}

/** The project the working directory belongs to, even from inside a checkout under `.branches/`. */
async function project(cwd: string, deps: SubagentDeps): Promise<string> {
  try {
    return await projectRoot(cwd, deps.git)
  } catch (err) {
    if (!/not a git repository/i.test(err instanceof Error ? err.message : String(err))) throw err
    throw new Refused({ ok: false, reason: 'not-a-repo' }, 'not inside a git repository')
  }
}

type Options = Record<string, { type: 'string' | 'boolean' }>

function parse<O extends Options>(args: string[], options: O, count: number) {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: true, strict: true })
    if (parsed.positionals.length !== count) throw new Usage(`expected ${count} argument(s), got ${parsed.positionals.length}`)
    return parsed
  } catch (err) {
    throw err instanceof Usage ? err : new Usage(err instanceof Error ? err.message : String(err))
  }
}
