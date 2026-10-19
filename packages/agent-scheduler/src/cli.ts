import { parseArgs } from 'node:util'
import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { projectRoot } from '@openagt/skill-branches'
import { driverFor } from '@openagt/agent-runner'
import { runNow, schedulerStatus, startScheduler, stopScheduler, tickProject } from './scheduler.js'
import { initHooks } from './init.js'
import { cleanup } from './cleanup.js'
import { PUBLISH_PICKS, agentInForce, isSwitchedOn, readState, updateState, withAgent, withAgents, withModel, withoutCommand, withoutListed, withPace, withPublish, withSwitch, type PublishPick, type State } from './state.js'
import { parseInterval, parseTimeOfDay, sinceNow, takesTimeOfDay } from './pace.js'
import { AGENTS, AGENT_LABELS, AGENT_SKILLS_DIR, DEFAULT_AGENT, MAX_AGENTS, WRITE_LINE_TIMEOUT_MS, isAgent, isAgents } from './names.js'
import { ableAgents, homeAgent, readSchedule, type ScheduledCommand } from './schedule.js'
import { addAutomation, editAutomation, removeAutomation, savedAutomation, tryCheck, type AddRefusal, type ChangedSince, type NotAnAutomation } from './automation.js'
import type { NewAutomation } from './automation-file.js'
import { lineContext, writeLine } from './write-line.js'

/**
 * The command line: JSON on stdout, one line for a person on stderr, and the exit code says how
 * it went — 0 for a result, 1 for a refusal or a failure, 2 for a command that could not be read.
 * The same contract as the skills' commands, so a person and a dashboard read it the same way.
 */

export const USAGE = `usage: agent-scheduler <command>

  tick                          pull agent-data, sweep, read the commands the project's skills schedule, start what is due, each a run of agent-runner
  init                          this tool's lines in the dashboard's .openagent/hooks.yml, so it runs while the dashboard is open; a line already there is kept
  start [--keep-alive]          the scheduler on, ticking every minute in its own process
  stop [--unless-keep-alive]    the scheduler off; runs in flight go to the end; with the flag a keep-alive scheduler is left running
  status                        the state file, whether the scheduler's process is alive, and the schedule as the project's files say it now
  model <id>                    the model a scheduled run on Claude Code starts on, where neither its command's skill nor you name another (this user)
  model <command> <id|skill>    the model this machine's runs of a scheduled command start on, by the id its coding agent knows it by, the command quoted
                                when it has a word after it; kept with the agent the command runs on here, and holding only while it runs on that agent;
                                skill for the model its skill names again, else the scheduler's own on Claude Code and the agent's own default on Codex,
                                taken for any name
  agent <command> <claude-code|codex|skill>
                                the coding agent this machine's runs of a scheduled command are on; refused for an agent whose own skills folder does not
                                hold the command's skill (.claude/skills for Claude Code, .agents/skills for Codex); skill for the agent its skill is made
                                for again, taken for any name; the command quoted when it has a word after it. The model picked for the command
                                goes with either: a model is one agent's.
                                Only Claude's quota can be read: a run on Codex starts without that question
  offset <points>               how far past the spend boundary a run may still start (this user)
  switch <command> <on|off>     whether a scheduled command runs on this machine, the command as status names it (quoted when it has a word after it); every one starts off, and off is taken for any name
  publish <command> <nothing|commit|branch|pr|merge>
                                how far this machine's runs of a scheduled command publish; commit until picked.
                                Refused, like a command's agent and model, for a row that resumes runs: each goes on with its own
  pace <command> <skill|work|N<m|h|d|w|mo>> [HH:MM]
                                how often at most a scheduled command starts on this machine: an interval (15m, 6h, 2d, 2w, 1mo; 1 to 9999), with a time of day
                                for days, weeks or months (2d 10:00, this machine's time); work for whenever its check finds work; skill for the skill's own pace again, taken for any name
  agents <command> <skill|N>    how many runs of a scheduled command may be in flight at once: this machine starts another only while fewer than N are in flight
                                on any machine; a whole number from 1 to ${MAX_AGENTS}; skill for the skill's own number again, taken for any name
  add <name> --prompt <text> [--every <N<m|h|d|w|mo>>] [--when <shell line>] [--waits-for <line>] [--private]
                                a person's own automation, saved as a command skill of the project: the prompt is the skill's text, and its schedule a pace (--every),
                                a check (--when, a shell line that prints what is new; it may read $LAST_RUN), or both; --waits-for says in one plain line what the check
                                waits for. The file is yours to commit: its command starts no run before it is on the commit a run's checkout starts from.
                                With --private it is kept on this machine alone, in this tool's own folder: nothing to commit, nobody else gets the row, and it
                                can start at once: a run is named by the automation's name and handed the prompt. The prompt is in each run's record, which
                                is shared where the project shares its records.
                                Refused for a name a skill of the project, or an automation kept on this machine, already has
  show <name>                   an automation saved with add, as it stands: its prompt, its pace, its check, its file, whether it is kept on this machine alone,
                                and its version, a name for what the file says now.
                                Refused, like edit and remove, for anything whose file does not read as add writes one: a skill of the project,
                                or an automation changed by hand since; those are edited and removed by hand
  edit <name> [--prompt <text>] [--every <N<m|h|d|w|mo>>] [--when <shell line>] [--waits-for <line>] [--was <version>]
                                save an automation again under its name: what is given takes the place of what its file said, what is left out stays,
                                and --every, --when or --waits-for given empty (--when=) takes that part out; what a check waits for goes out with the check.
                                Its past runs, its switch and your picks for it stay. A shared one is a change of yours to commit: a run is told the new
                                prompt only once the change is on the commit a run's checkout starts from. With --was, the version show answered, it is
                                refused when the file was changed since: a form opened a while ago writes over no change made by hand
  remove <name>                 delete an automation's file, and what this machine held for it: its switch, its pace, its number of agents, its coding agent, its model, its publish pick.
                                Nothing is committed: the deletion of a shared one is yours to commit, and everyone else keeps the command until it reaches them.
                                What was never committed cannot be brought back: all of one kept on this machine, and a shared one's file or its last changes.
                                The records of its past runs stay
  now <command>                 start one run of a scheduled command now, whatever its switch, its pace and the quota left: a person asked for it. A command with a check
                                starts only when the check finds work (it has 10 seconds); how many at once, where a run's checkout starts and whether the
                                coding agent can start hold as on a tick. It needs no scheduler running. Not ready within 20 seconds, it starts nothing
  try --when <shell line>       run a check once, as a tick would, asking what is new since a day ago: what it printed and whether an agent would start; nothing is saved or started;
                                it has 20 seconds, less than a tick gives a check
  write-line --words <plain words> [--agent <claude-code|codex>]
                                a shell line for --when, written from what it waits for said in plain words, by one session of the coding agent (Claude Code
                                unless named) with no tools: a fraction of a cent. The line is only printed, as {line}, or {none} with why no line can do it;
                                nothing is run or saved. It has ${WRITE_LINE_TIMEOUT_MS / 1000} seconds
  cleanup                       remove what this tool left in the project: the state file and the scheduler's log, then .agent-scheduler/ and the rule hiding it from git once it is empty
                                (the automations kept on this machine are your own writing and stay);
                                refused while the state names a scheduler that is alive; the command a dashboard asks for when a project is removed with its files

JSON on stdout. Exit code 1 for a refusal or a failure (the reason on stderr), 2 for a usage error.`

export interface CliIo {
  cwd: string
  stdout: (line: string) => void
  stderr: (line: string) => void
}

export type CliRefusal = { ok: false; reason: string; [key: string]: unknown }

class Refused extends Error {
  constructor(readonly outcome: CliRefusal, readonly line: string) {
    super(line)
  }
}

class Usage extends Error {}

export async function runCli(argv: string[], io: CliIo, git: GitRunner = nodeGitRunner()): Promise<number> {
  const [command, ...rest] = argv
  const run = command && Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined
  if (!run) {
    io.stderr(USAGE)
    return 2
  }
  try {
    const result = await run(rest, io, git)
    io.stdout(JSON.stringify(result))
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

type Command = (args: string[], io: CliIo, git: GitRunner) => Promise<unknown>

const COMMANDS: Record<string, Command> = {
  async tick(args, io, git) {
    parse(args, {}, 0)
    const repo = await project(io.cwd, git)
    const record = await tickProject(repo, { git, log: io.stderr })
    return { ok: true, ...record }
  },

  async init(args, io, git) {
    parse(args, {}, 0)
    const repo = await project(io.cwd, git)
    const outcome = await initHooks(repo)
    if (outcome.ok) return outcome
    const line = outcome.reason === 'no-dashboard' ? 'no .openagent/ here: add the project in the dashboard first' : `${outcome.file}: ${outcome.detail ?? 'unreadable'}`
    throw new Refused(outcome, line)
  },

  async start(args, io, git) {
    const { values } = parse(args, { foreground: { type: 'boolean' }, 'keep-alive': { type: 'boolean' } }, 0)
    const repo = await project(io.cwd, git)
    const state = await startScheduler(repo, {
      ...(values.foreground ? { foreground: true } : {}),
      ...(values['keep-alive'] ? { keepAlive: true } : {}),
      log: io.stderr,
    })
    return { ok: true, ...state }
  },

  async stop(args, io, git) {
    const { values } = parse(args, { 'unless-keep-alive': { type: 'boolean' } }, 0)
    const repo = await project(io.cwd, git)
    const state = await stopScheduler(repo, { ...(values['unless-keep-alive'] ? { unlessKeepAlive: true } : {}) })
    if (state.kept) io.stderr('keep-alive is on, the scheduler keeps running')
    return { ok: true, ...state }
  },

  async status(args, io, git) {
    parse(args, {}, 0)
    const repo = await project(io.cwd, git)
    return { ok: true, ...(await schedulerStatus(repo)) }
  },

  async model(args, io, git) {
    const { positionals } = parse(args, {}, 1, 2)
    const repo = await project(io.cwd, git)
    if (positionals.length === 1) {
      // One word is the scheduler's own model. A command's name, or `skill`, is a model's id forgotten: taken as an id it would be every row's model.
      const word = positionals[0]!
      if (word === 'skill' || (await readSchedule(repo)).commands.some(c => c.name === word || c.name.split(' ')[0] === word)) throw new Usage(`${word} is no model: a command's model is set with model <command> <id|skill>`)
      return { ok: true, ...(await updateState(repo, s => ({ ...s, model: word }), git)) }
    }
    const [name, to] = positionals as [string, string]
    // Taking a model back needs no scheduled command: one left for a skill that is gone can always be taken back.
    if (to === 'skill') return { ok: true, ...(await updateState(repo, s => withModel(s, name, undefined), git)) }
    if (!to.trim()) throw new Usage('a model is the id its coding agent knows it by')
    const command = await scheduled(repo, name)
    resumesOwn(command, 'model')
    // A model is one agent's: the pick is kept with the agent the command runs on here, and holds only while it does.
    return { ok: true, ...(await updateState(repo, s => withModel(s, name, { agent: agentInForce(s, command), model: to }), git)) }
  },

  async agent(args, io, git) {
    const { positionals } = parse(args, {}, 2)
    const [name, to] = positionals as [string, string]
    if (to !== 'skill' && !isAgent(to)) throw new Usage(`${to} is none of skill, ${AGENTS.join(', ')}`)
    const repo = await project(io.cwd, git)
    // Taking an agent back needs no scheduled command: one left for a skill that is gone can always be taken back.
    if (to === 'skill') return { ok: true, ...(await updateState(repo, s => withAgent(s, name, undefined), git)) }
    const command = await scheduled(repo, name)
    resumesOwn(command, 'coding agent')
    if (!ableAgents(command).includes(to)) throw new Refused({ ok: false, reason: 'no-skill-there', command: name, agent: to }, `${AGENT_LABELS[to]} reads a project's skills from ${AGENT_SKILLS_DIR[to]}, and the skill of ${name} is only under ${command.dirs.join(' and ')}`)
    // The agent the command is made for is no pick to keep: the command then follows its skill again. The model picked for the command goes either way: a model is one agent's.
    return { ok: true, ...(await updateState(repo, s => withAgent(s, name, to === homeAgent(command) ? undefined : to), git)) }
  },

  async offset(args, io, git) {
    const { positionals } = parse(args, {}, 1)
    const points = Number(positionals[0])
    if (!Number.isFinite(points)) throw new Usage(`${positionals[0]} is not a number of percentage points`)
    const repo = await project(io.cwd, git)
    return { ok: true, ...(await updateState(repo, s => ({ ...s, spendOffset: points }), git)) }
  },

  async switch(args, io, git) {
    const { positionals } = parse(args, {}, 2)
    const [name, to] = positionals as [string, string]
    if (to !== 'on' && to !== 'off') throw new Usage(`${to} is neither on nor off`)
    const repo = await project(io.cwd, git)
    // Off needs no scheduled command: a switch left on for a skill that is gone can always be taken back.
    if (to === 'on') await scheduled(repo, name)
    // Switched on, a time of day counts from now: a row ticked after its time waits for the next one, as when the time was picked.
    // A command already on is left as it is, so asking twice does not put a missed time off.
    // The switch keeps when it was switched on: a check of a command that never started asks what is new since then.
    const now = new Date()
    return { ok: true, ...(await updateState(repo, s => (to === 'off' ? withSwitch(s, name, undefined) : isSwitchedOn(s, name) ? s : withPace(withSwitch(s, name, now.toISOString()), name, sinceNow(s.paces?.[name], now))), git)) }
  },

  async publish(args, io, git) {
    const { positionals } = parse(args, {}, 2)
    const [name, to] = positionals as [string, string]
    if (!(PUBLISH_PICKS as readonly string[]).includes(to)) throw new Usage(`${to} is none of ${PUBLISH_PICKS.join(', ')}`)
    const repo = await project(io.cwd, git)
    resumesOwn(await scheduled(repo, name), 'publish level')
    return { ok: true, ...(await updateState(repo, s => withPublish(s, name, to as PublishPick), git)) }
  },

  async pace(args, io, git) {
    const { positionals } = parse(args, {}, 2, 3)
    const [name, to, at] = positionals as [string, string, string | undefined]
    const interval = parseInterval(to)
    if (to !== 'skill' && to !== 'work' && !interval) throw new Usage(`${to} is none of skill, work, or an interval like 15m, 6h, 2d, 2w, 1mo`)
    const time = at === undefined ? undefined : parseTimeOfDay(at)
    if (at !== undefined && !time) throw new Usage(`${at} is no time of day like 10:00`)
    if (time && !(interval && takesTimeOfDay(interval))) throw new Usage('a time of day goes with days, weeks or months')
    const repo = await project(io.cwd, git)
    // Taking a pace back needs no scheduled command: one left for a skill that is gone can always be taken back.
    if (to === 'skill') return { ok: true, ...(await updateState(repo, s => withPace(s, name, undefined), git)) }
    const command = await scheduled(repo, name)
    if (to === 'work' && command.when === undefined) throw new Refused({ ok: false, reason: 'no-check', command: name }, `${name} has no check, so nothing would say when there is work`)
    const every = interval?.text
    return {
      ok: true,
      ...(await updateState(
        repo,
        s => {
          if (every === undefined) return withPace(s, name, { work: true })
          // The same pace picked again is the same pick: when it was made stays, so a time that was missed is still due.
          const before = s.paces?.[name]
          const same = typeof before === 'object' && before !== null && 'every' in before && before.every === every && before.at === time?.text && typeof before.since === 'string'
          return withPace(s, name, { every, ...(time ? { at: time.text } : {}), since: same ? before.since : new Date().toISOString() })
        },
        git,
      )),
    }
  },

  async agents(args, io, git) {
    const { positionals } = parse(args, {}, 2)
    const [name, to] = positionals as [string, string]
    const count = /^\d+$/.test(to) ? Number(to) : undefined
    if (to !== 'skill' && !isAgents(count)) throw new Usage(`${to} is neither skill nor a whole number from 1 to ${MAX_AGENTS}`)
    const repo = await project(io.cwd, git)
    // Taking a number back needs no scheduled command: one left for a skill that is gone can always be taken back.
    if (to !== 'skill') await scheduled(repo, name)
    return { ok: true, ...(await updateState(repo, s => withAgents(s, name, count), git)) }
  },

  async add(args, io, git) {
    const { positionals, values } = parse(args, { prompt: { type: 'string' }, every: { type: 'string' }, when: { type: 'string' }, 'waits-for': { type: 'string' }, private: { type: 'boolean' } }, 1)
    if (values.prompt === undefined) throw new Usage('add needs --prompt, what the agent is told')
    const repo = await project(io.cwd, git)
    const outcome = await addAutomation(repo, typed(positionals[0]!, values.prompt, values), git, values.private ? { onThisMachine: true } : {})
    if (outcome.ok) {
      // A new command starts off, at its own pace, on this machine: nothing a command of that name left behind here decides for it.
      await forget(repo, s => withoutCommand(s, outcome.command), git)
      return outcome
    }
    throw new Refused(outcome, refusal(outcome))
  },

  async show(args, io, git) {
    const { positionals } = parse(args, {}, 1)
    const found = await savedAutomation(await project(io.cwd, git), positionals[0]!)
    if ('reason' in found) throw new Refused(found, refusal(found))
    return { ok: true, ...found.automation, file: found.file, version: found.version, ...(found.onThisMachine ? { onThisMachine: true } : {}) }
  },

  async edit(args, io, git) {
    const { positionals, values } = parse(args, { prompt: { type: 'string' }, every: { type: 'string' }, when: { type: 'string' }, 'waits-for': { type: 'string' }, was: { type: 'string' } }, 1)
    if (values.prompt === undefined && values.every === undefined && values.when === undefined && values['waits-for'] === undefined) throw new Usage('edit needs what to change: --prompt, --every, --when or --waits-for')
    // A flag left out leaves that part as the file says it; a schedule flag given empty takes its part out.
    const part = (typed: string | undefined): string | null | undefined => (typed === undefined ? undefined : typed.trim() === '' ? null : typed)
    const outcome = await editAutomation(await project(io.cwd, git), positionals[0]!, { prompt: values.prompt, every: part(values.every), when: part(values.when), waitsFor: part(values['waits-for']) }, git, values.was !== undefined ? { was: values.was } : {})
    if (outcome.ok) return outcome
    throw new Refused(outcome, refusal(outcome))
  },

  async remove(args, io, git) {
    const { positionals } = parse(args, {}, 1)
    const repo = await project(io.cwd, git)
    const outcome = await removeAutomation(repo, positionals[0]!, git)
    if (!outcome.ok) throw new Refused(outcome, refusal(outcome))
    // What this machine held for the command goes with it, and the last tick's record stops naming it, so a dashboard stops listing it at once.
    await forget(repo, s => withoutListed(withoutCommand(s, outcome.command), outcome.command), git)
    return outcome
  },

  async now(args, io, git) {
    const { positionals } = parse(args, {}, 1)
    const repo = await project(io.cwd, git)
    const command = await scheduled(repo, positionals[0]!)
    const started = await runNow(repo, command, { git, log: io.stderr })
    if (started.ok) return { ok: true, command: command.name, run: started.run.id }
    throw new Refused({ ok: false, reason: 'not-started', command: command.name, outcome: started.outcome }, started.outcome)
  },

  async try(args, io, git) {
    const { values } = parse(args, { when: { type: 'string' } }, 0)
    if (values.when === undefined || !values.when.trim()) throw new Usage('try needs --when, the shell line to run')
    const repo = await project(io.cwd, git)
    return { ok: true, ...(await tryCheck(repo, values.when.trim(), new Date())) }
  },

  async 'write-line'(args, io, git) {
    const { values } = parse(args, { words: { type: 'string' }, agent: { type: 'string' } }, 0)
    const words = values.words?.trim()
    if (!words) throw new Usage('write-line needs --words, what the line waits for in plain words')
    const agent = values.agent ?? DEFAULT_AGENT
    if (!isAgent(agent)) throw new Usage(`--agent is one of ${AGENTS.join(', ')}`)
    const repo = await project(io.cwd, git)
    // None of the person's own setup: the session answers in words, and what it would load is only cost.
    const driver = driverFor(agent, 'write-line', { memory: false, connectors: false, skills: false })
    const written = await writeLine(driver, words, await lineContext(repo, git))
    if ('failed' in written) throw new Refused({ ok: false, reason: 'not-written', detail: written.failed }, `the line was not written: ${written.failed}`)
    return { ok: true, ...written }
  },

  async cleanup(args, io, git) {
    parse(args, {}, 0)
    const outcome = await cleanup(await project(io.cwd, git), { git })
    if (outcome.ok) return outcome
    throw new Refused(outcome, `the scheduler is running here (pid ${outcome.pid}): stop it first with npx @openagt/agent-scheduler@0.1 stop`)
  },
}

/** Take something out of the state, writing it only when it held that: a save of a dashboard's own may be writing the state at this moment, and a project with no state gets none for nothing. */
async function forget(repo: string, without: (state: State) => State, git: GitRunner): Promise<void> {
  const state = await readState(repo)
  if (without(state) !== state) await updateState(repo, without, git)
}

/** An automation as the command line was given it: its name, its prompt, and the schedule flags that were typed. */
function typed(name: string, prompt: string, values: { every?: string | undefined; when?: string | undefined; 'waits-for'?: string | undefined }): NewAutomation {
  return { name, prompt, ...(values.every !== undefined ? { every: values.every } : {}), ...(values.when !== undefined ? { when: values.when } : {}), ...(values['waits-for'] !== undefined ? { waitsFor: values['waits-for'] } : {}) }
}

/** Why an automation was not saved, shown or removed, as one line for a person. */
function refusal(outcome: AddRefusal | NotAnAutomation | ChangedSince): string {
  if (outcome.reason === 'taken') return `that name is taken: ${outcome.folder}`
  if (outcome.reason === 'no-prompt') return 'the prompt is empty'
  if (outcome.reason === 'bad-schedule') return `it cannot run as written: ${outcome.detail}`
  return outcome.detail
}

/** The scheduled command of that name; refused where no skill of the project schedules it, with why when its skill's schedule cannot be read. */
async function scheduled(repo: string, name: string): Promise<ScheduledCommand> {
  const schedule = await readSchedule(repo)
  const command = schedule.commands.find(c => c.name === name)
  if (command) return command
  const skill = name.split(' ')[0]!
  const unreadable = schedule.unreadable.find(u => u.skill === skill)
  if (unreadable?.own) throw new Refused({ ok: false, reason: 'unlisted-automation', automation: skill, detail: unreadable.reason }, `the automation ${skill}, kept on this machine, is not listed: ${unreadable.reason}`)
  if (unreadable) throw new Refused({ ok: false, reason: 'unreadable-schedule', skill, detail: unreadable.reason }, `the schedule of ${skill} cannot be read: ${unreadable.reason}`)
  throw new Refused({ ok: false, reason: 'not-scheduled', command: name }, `no skill of this project schedules ${name}`)
}

/** Refused for a row that resumes: each run it resumes goes on with its own coding agent, model and publish level, as its record names them. */
function resumesOwn(command: ScheduledCommand, what: string): void {
  if (command.resumes) throw new Refused({ ok: false, reason: 'resumes', command: command.name }, `${command.name} resumes runs, and each goes on with the ${what} its own record names`)
}

/** The project the working directory belongs to, even from inside a checkout under `.branches/`. */
async function project(cwd: string, git: GitRunner): Promise<string> {
  try {
    return await projectRoot(cwd, git)
  } catch (err) {
    if (!/not a git repository/i.test(err instanceof Error ? err.message : String(err))) throw err
    throw new Refused({ ok: false, reason: 'not-a-repo' }, 'not inside a git repository')
  }
}

type Options = Record<string, { type: 'string' | 'boolean' }>

function parse<O extends Options>(args: string[], options: O, min: number, max: number = min) {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: true, strict: true })
    if (parsed.positionals.length < min || parsed.positionals.length > max) {
      throw new Usage(`expected ${max === min ? min : `${min} to ${max}`} argument(s), got ${parsed.positionals.length}`)
    }
    return parsed
  } catch (err) {
    throw err instanceof Usage ? err : new Usage(err instanceof Error ? err.message : String(err))
  }
}

