import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import { parseArgs } from 'node:util'
import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { carriedSkills, GROUPS, SKILL_NAMES } from './catalogue.js'
import { applyChange, commitChange, isKnown, type Change, type Changed } from './change.js'
import { held, readProject, type ProjectState, type Standing } from './project.js'
import { askList, askYesNo, type Row, type Terminal } from './prompt.js'

/**
 * `npx @openagt/init`: one command gives a project its skills (#2023).
 *
 * In a terminal, with no command, it is a conversation: the skills as a list with ticks, the ticked
 * ones written and the unticked deleted, then "Commit these files now?" and "Open the dashboard?".
 * Run again, the ticks show what the project has now. With a command it asks nothing and prints
 * one JSON document, like the skills' own commands, for scripts: exit code 0 for a result, 1 for a
 * refusal, 2 for a command line that cannot be read.
 *
 * It writes text files and nothing else: no `package.json`, no install, never a push.
 */

export const USAGE = `usage: npx @openagt/init [command]

  (no command)            in a terminal: the skills as a list with ticks. Enter writes the ticked ones
                          and deletes the unticked, then asks "Commit these files now?" and
                          "Open the dashboard?". Run it again to add or remove a skill later.
  add <name>…             write these skills, asking nothing; one the project already holds is left
                          as it is; \`scheduler\` also starts the scheduler with the dashboard, on this machine
  remove <name>…          delete these skills, asking nothing; \`scheduler\` also takes the scheduler out
                          of the dashboard's start, on this machine, and stops it
  update [<name>…]        write again every skill that has a newer text; a skill named is written again
                          whatever it holds now, a text changed by hand included
  list                    what the project has, and what there is to add

  --commit                with add, remove and update: commit the files they wrote or deleted, those
                          alone, on the branch you are on. Nothing is ever pushed.

A skill is one file, .agents/skills/<name>/SKILL.md, with a link at .claude/skills/<name>: tracked
files of your project, read by Codex and Claude Code. With a command: JSON on stdout, exit code 1
for a refusal (the reason on stderr), 2 for a usage error.`

/** The streams, the working directory and the terminal a run of the CLI sees. */
export interface CliIo {
  cwd: string
  stdout: (line: string) => void
  stderr: (line: string) => void
  /** The terminal a person is at; absent when the command is run by a script or a pipe. */
  terminal?: Terminal
  /** Start the dashboard in `cwd` and wait for it to end: its exit code. `npx @openagt/start` when absent. */
  openDashboard?: (cwd: string) => Promise<number>
}

/** A refusal: a rule said no, and the caller learns which. */
export type CliRefusal = { ok: false; reason: string; [key: string]: unknown }

class Refused extends Error {
  constructor(
    readonly outcome: CliRefusal,
    readonly line: string,
  ) {
    super(line)
  }
}

/** Thrown inside a command for an argument that cannot be read: usage on stderr, exit 2. */
class Usage extends Error {}

/** Thrown inside the conversation when the person leaves at a question (Ctrl-C): nothing more is done, exit 130. */
class Left extends Error {}

/** Run the CLI: `argv` is everything after the program name. Resolves to the exit code. */
export async function runCli(argv: string[], io: CliIo, git: GitRunner = nodeGitRunner()): Promise<number> {
  const [command, ...rest] = argv
  if (command === undefined) {
    if (!io.terminal) {
      io.stderr(`not a terminal: the list with ticks needs one. In a script, use add, remove, update or list.\n\n${USAGE}`)
      return 2
    }
    try {
      return await converse(io, io.terminal, git)
    } catch (err) {
      if (err instanceof Left) return 130
      io.terminal.output.write(`\n${err instanceof Error ? err.message : String(err)}\n`)
      return 1
    }
  }
  const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined
  if (!run) {
    io.stderr(USAGE)
    return command === '--help' || command === '-h' ? 0 : 2
  }
  try {
    io.stdout(JSON.stringify(await run(rest, io, git)))
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
    // Anything else is said in one line, never as a stack: a file where a folder should be, a folder that cannot be written.
    io.stderr(err instanceof Error ? err.message : String(err))
    return 1
  }
}

type Command = (args: string[], io: CliIo, git: GitRunner) => Promise<unknown>

/** The names after a command, and whether `--commit` was among them. */
function parse(args: string[], needsName: boolean): { names: string[]; commit: boolean } {
  let parsed
  try {
    parsed = parseArgs({ args, options: { commit: { type: 'boolean' } }, allowPositionals: true })
  } catch (err) {
    throw new Usage(err instanceof Error ? err.message : String(err))
  }
  if (needsName && parsed.positionals.length === 0) throw new Usage('name at least one skill')
  const unknown = parsed.positionals.find(name => !isKnown(name))
  if (unknown !== undefined) throw new Refused({ ok: false, reason: 'unknown-skill', name: unknown }, `no skill ${unknown}: the skills are ${SKILL_NAMES.join(', ')}`)
  return { names: [...new Set(parsed.positionals)], commit: parsed.values.commit === true }
}

/** Apply a change asked by name, commit it when asked to, and answer what happened. */
async function changeByName(io: CliIo, git: GitRunner, change: Change, commit: boolean): Promise<unknown> {
  const changed = await applyChange(io.cwd, change, git)
  if (changed.scheduler && 'error' in changed.scheduler) throw new Refused({ ok: false, reason: 'scheduler', ...changed }, `the scheduler could not be switched: ${changed.scheduler.error}`)
  if (!commit) return { ok: true, ...changed }
  const committed = await commitChange(io.cwd, changed, git)
  if (!committed.ok) throw new Refused({ ok: false, reason: 'commit', ...changed }, `the files are written, but the commit failed: ${committed.error}`)
  return { ok: true, ...changed, ...(committed.commit ? { commit: committed.commit } : {}) }
}

const COMMANDS: Record<string, Command> = {
  async add(args, io, git) {
    const { names, commit } = parse(args, true)
    // A skill the project already holds is left as it is, a text changed by hand included: `update <name>` writes over one.
    const has = held(await readProject(io.cwd, git))
    const already = names.filter(name => has.includes(name))
    const changed = (await changeByName(io, git, { write: names.filter(name => !has.includes(name)) }, commit)) as object
    return { ...changed, already }
  },

  async remove(args, io, git) {
    const { names, commit } = parse(args, true)
    return changeByName(io, git, { remove: names }, commit)
  },

  async update(args, io, git) {
    const { names, commit } = parse(args, false)
    const state = await readProject(io.cwd, git)
    const missing = names.find(name => !held(state).includes(name))
    if (missing !== undefined) throw new Refused({ ok: false, reason: 'not-here', name: missing }, `this project does not have ${missing}: add it first`)
    const write = names.length > 0 ? names : state.skills.filter(skill => skill.standing === 'newer').map(skill => skill.name)
    return changeByName(io, git, { write }, commit)
  },

  async list(args, io, git) {
    if (args.length > 0) throw new Usage('list takes no argument')
    const state = await readProject(io.cwd, git)
    return { ok: true, ...state }
  },
}

/** What stands beside a skill's name in the list when its text is not simply the one `init` carries. */
const NOTES: Partial<Record<Standing, string>> = {
  newer: 'a newer text is there',
  changed: 'changed by hand',
  own: 'your own text',
}

/** The rows of the list: each group's title and its skills. */
async function rows(state: ProjectState): Promise<Row[]> {
  const carried = await carriedSkills()
  const standing = new Map(state.skills.map(skill => [skill.name, skill.standing]))
  const width = Math.max(...SKILL_NAMES.map(name => name.length))
  const list: Row[] = []
  for (const group of GROUPS) {
    list.push({ label: group.title })
    for (const name of group.skills) {
      const note = NOTES[standing.get(name) ?? 'absent']
      list.push({ name, label: name.padEnd(width), hint: `${note ? `(${note}) ` : ''}${carried.get(name)!.description}` })
    }
  }
  return list
}

/** What is ticked when the list opens: what the project has; in a project with nothing yet, the default picks. */
function ticks(state: ProjectState): string[] {
  const has = held(state)
  if (has.length > 0) return has
  return GROUPS.filter(group => group.ticked).flatMap(group => group.skills)
}

/** The conversation in a terminal. */
async function converse(io: CliIo, terminal: Terminal, git: GitRunner): Promise<number> {
  const say = (line = ''): void => void terminal.output.write(`${line}\n`)
  const state = await readProject(io.cwd, git)
  const has = held(state)
  say(`OpenAgent skills for ${basename(io.cwd)}`)
  say('Every agent OpenAgent starts already gets its default skills, with nothing written here. These are more.')
  if (has.length > 0) say(`This project has ${has.length} of these ${SKILL_NAMES.length}. The ticks show what it has now.`)
  if (state.remote && !state.github) say('This project is not on GitHub: agents push their branch, and you open the request yourself. There is no skill for another git host yet.')
  say()

  const picked = await askList(await rows(state), ticks(state), terminal)
  if (!picked) {
    say('Left as it is.')
    return 0
  }
  const write = SKILL_NAMES.filter(name => picked.has(name) && !has.includes(name))
  const remove = has.filter(name => !picked.has(name))
  const kept = state.skills.filter(skill => picked.has(skill.name) && has.includes(skill.name))
  const newer = kept.filter(skill => skill.standing === 'newer').map(skill => skill.name)
  const byHand = kept.filter(skill => skill.standing === 'changed').map(skill => skill.name)
  say()
  if (newer.length > 0 && (await ask(`${count(newer.length, 'skill has', 'skills have')} a newer text: ${newer.join(', ')}. Update ${newer.length === 1 ? 'it' : 'them'}?`, false, terminal))) write.push(...newer)
  if (byHand.length > 0) say(`Changed by hand, left as ${byHand.length === 1 ? 'it is' : 'they are'}: ${byHand.join(', ')}. \`npx @openagt/init update <name>\` writes the text over yours.`)

  if (write.length === 0 && remove.length === 0) {
    say('Nothing to change.')
    return openDashboard(io, terminal, say)
  }
  const changed = await applyChange(io.cwd, { write, remove }, git)
  report(changed, say)

  if (changed.paths.length > 0) {
    if (!(await readProject(io.cwd, git)).git) {
      say('This folder is not a git repository, so there is nothing to commit. Adding it in the dashboard makes it one.')
    } else if (await ask('Commit these files now?', true, terminal)) {
      const committed = await commitChange(io.cwd, changed, git)
      if (!committed.ok) say(`Not committed: ${committed.error}. The files are in your folder.`)
      else if (committed.committed) say(`Committed as ${committed.commit}, these files alone. Nothing was pushed: push it, or open a pull request where the default branch is protected.`)
      else say('Nothing to commit: git already has these files as they are.')
    } else {
      say('Not committed. The files are in your folder.')
    }
    if (changed.written.length > 0) say('Your agents get these skills once they are on the branch agents start from.')
  }
  return openDashboard(io, terminal, say)
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** A yes or no; a person who leaves at the question (Ctrl-C) ends the conversation where it stands. */
async function ask(question: string, fallback: boolean, terminal: Terminal): Promise<boolean> {
  const answer = await askYesNo(question, fallback, terminal)
  if (answer === undefined) throw new Left()
  return answer
}

/** What a change did, in a few lines for a person. */
function report(changed: Changed, say: (line?: string) => void): void {
  if (changed.written.length > 0) say(`Wrote ${count(changed.written.length, 'skill', 'skills')} in .agents/skills, ${changed.written.length === 1 ? 'linked' : 'each linked'} in .claude/skills: ${changed.written.join(', ')}.`)
  if (changed.removed.length > 0) say(`Deleted ${count(changed.removed.length, 'skill', 'skills')}: ${changed.removed.join(', ')}.`)
  for (const { path, reason } of changed.left) say(`Left as it is: ${path} (${reason}).`)
  const scheduler = changed.scheduler
  if (!scheduler) return
  if ('error' in scheduler) say(`The scheduler could not be switched ${scheduler.on ? 'on' : 'off'}: ${scheduler.error}`)
  else if (scheduler.madeRepository) say('Made this folder a git repository, with an empty first commit, as adding it in the dashboard does.')
  if (!('error' in scheduler) && scheduler.changed) say(scheduler.on ? 'The scheduler starts with the dashboard, on this machine. Every automation starts switched off.' : 'The scheduler no longer starts with the dashboard on this machine.')
}

/** The last question, and the dashboard started in the folder on a yes. */
async function openDashboard(io: CliIo, terminal: Terminal, say: (line?: string) => void): Promise<number> {
  if (!(await ask('Open the dashboard?', true, terminal))) return 0
  say('Starting the dashboard here. Ctrl-C closes it.')
  return (io.openDashboard ?? npxStart)(io.cwd)
}

/** OpenAgent by its full name, in the folder, on this terminal: it offers the folder it was started in as a project. */
function npxStart(cwd: string): Promise<number> {
  return new Promise(resolve => {
    // Through a shell on Windows, where `npx` is a script and not a program.
    const child = spawn('npx', ['--yes', '@openagt/start'], { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('error', err => {
      console.error(`The dashboard could not be started: ${err.message}. Run it yourself: npx @openagt/start`)
      resolve(1)
    })
    child.on('exit', code => resolve(code ?? 0))
  })
}
