import { parseArgs } from 'node:util'
import { nodeGitRunner, runPackageCommand, type GitRunner } from '@openagt/agent-data'
import { liftSkillRules, projectRoot } from '@openagt/skill-branches'
import { findRun } from '@openagt/skill-logs'
import { DRIVER_NAMES, detachResume, detachRun, isDriverName, readyToRun, resumeProject, runProject } from './runner.js'
import { initHooks } from './init.js'
import { cleanup } from './cleanup.js'
import { everyBasicSkill } from './basic-skills.js'
import { isPublish, NO_PUBLISH, PUBLISH_LEVELS } from './records.js'
import { gitHostCommand } from './git-host.js'

/**
 * The command line: JSON on stdout, one line for a person on stderr, and the exit code says how
 * it went — 0 for a result, 1 for a refusal or a failure, 2 for a command that could not be read.
 * The same contract as the skills' commands, so a person and a dashboard read it the same way.
 */

export const USAGE = `usage: agent-runner <command>

  run <prompt> [--model <id>] [--effort <level>] [--driver <claude-code|codex>] [--then <prompt>] [--publish <commit|branch|pr|merge>] [--attach <text>] [--parent <id>] [--base <ref>]
                                one run of <prompt> in its own checkout, now, recorded; on Claude Code unless --driver says Codex,
                                on the coding agent's own default model unless --model names one;
                                with --then, once it ends done with a pull request, a fresh agent on its branch gets that prompt and the run's id, and the merge waits for it;
                                with --publish, the agent is told, in one sentence after the prompt, how far to take its work when it finishes: commit it, and from there push its branch,
                                open its pull request, or set the request to merge once its checks pass; without it the prompt goes as written, and nothing is committed or published unless the prompt asks;
                                with --attach, the agent is handed <text> with the prompt, after it and before the --publish sentence, and with no later message; the run's record keeps it apart from the prompt, which alone names the run;
                                with --parent, the run <id> is told when this one ends: which run, how it ended, its last words, as its next prompt;
                                with --base, the run's branch starts from <ref> instead of origin's default branch
  run --detach <prompt>         the same run in its own process, answered at once with its id: what a dashboard's start hook runs
  run --resume <id> [<text>] [--answer <label>] [--publish <commit|branch|pr|merge|nothing>]
                                continue an ended run: the same record, its session resumed; the text as the next prompt, or the answer to the question it ended on;
                                with --publish, the run takes its work that far from here on, or, with nothing, only as far as its prompts ask; at its record's level without it
  run --detach --resume <id> …  the same continuing in its own process, answered at once: what a dashboard's resume hook runs
  run --resume <id> … --by <who>
                                kept on the run's record with the time, until its next resume: a scheduler's row that resumed it, which counts the run as its own
  check [--driver <claude-code|codex>]
                                whether a run can start here: the coding agent's CLI installed and logged in, and its warnings; what a dashboard's check hook runs
  git-host <command> [<arg>…]   run a command of the project's git host, whichever package is it, and print what it printed: a skill's check reads
                                pull requests with no host named (git-host replies); refused where the project has no git host
  init                          this tool's lines in the dashboard's .openagent/hooks.yml, so its Start works; a line already there is kept
  cleanup                       remove what this tool left in the project: the runs' locks and stderr files, then .agent-runner/ and the rule hiding it from git once it is empty;
                                config.yml is yours and stays; refused while a run's process is alive; the command a dashboard asks for when a project is removed with its files

When a run ends waiting on a question, or ends done with a pull request it did not have, the \`ended:\` line in the
project's .agent-runner/config.yml runs, if there is one, in the project's root, with MESSAGE (one line for a person),
RUN_ID, STATUS, QUESTION and PR_URL in its environment. The file is this machine's: keep it out of git (this tool hides
.agent-runner/ from git once a run has started here). A run's coding agent loads the person's own setup, as when
started by hand; in the same file, each part is left out with its own line under \`personal:\`, so a run does the same
job on every machine:
  personal:
    memory: off       Claude Code's auto-memory; Codex's memories
    connectors: off   your claude.ai connectors; Codex's apps and plugins
    skills: off       Claude Code: your user settings (effort, model, hooks, a login through apiKeyHelper or env), the skills
                      synced from your claude.ai account, ~/.claude/CLAUDE.md, ~/.claude/skills.
                      Codex: ~/.codex/AGENTS.md, ~/.codex/skills, ~/.codex/config.toml (with a model provider or
                      login set there) and its memories, so Codex's memory stays on only with skills on too (\`check\` warns).
                      Codex loads skills in ~/.agents/skills either way; with skills off, \`check --driver codex\` warns about them.

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
  async run(args, io, git) {
    const { positionals, values } = parse(args, { id: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' }, resume: { type: 'string' }, answer: { type: 'string' }, detach: { type: 'boolean' }, mark: { type: 'boolean' }, driver: { type: 'string' }, then: { type: 'string' }, publish: { type: 'string' }, attach: { type: 'string' }, started: { type: 'string' }, parent: { type: 'string' }, base: { type: 'string' }, by: { type: 'string' } }, 0, 1)
    const repo = await project(io.cwd, git)
    const driver = values.driver
    if (driver !== undefined && !isDriverName(driver)) throw new Usage(`unknown driver "${driver}"; the drivers are ${DRIVER_NAMES.join(' and ')}`)
    const publish = isPublish(values.publish) ? values.publish : undefined
    // A resume may also take the run's level away: from there on its prompts go as written.
    const noLevel = values.resume !== undefined && values.publish === NO_PUBLISH
    if (values.publish !== undefined && publish === undefined && !noLevel) throw new Usage(`unknown publish level "${values.publish}"; the levels are ${PUBLISH_LEVELS.join(', ')}${values.resume !== undefined ? `, or ${NO_PUBLISH}` : ''}`)
    if (values.resume !== undefined) {
      if (driver !== undefined) throw new Usage('--resume takes no --driver: a run continues on the coding agent its record names')
      if (values.id !== undefined) throw new Usage('--resume takes no --id: a run continues under its own')
      if (values.then !== undefined) throw new Usage('--resume takes no --then: a run continues with the follow-up its record names')
      if (values.attach !== undefined) throw new Usage('--resume takes no --attach: a text is handed over with a run\'s first prompt only')
      if (values.started !== undefined) throw new Usage('--resume takes no --started: a run continues from the start its record names')
      if (values.parent !== undefined) throw new Usage('--resume takes no --parent: a run continues for the parent its record names')
      if (values.base !== undefined) throw new Usage('--resume takes no --base: a run continues on its own branch')
      if (positionals[0] === undefined && values.answer === undefined) throw new Usage('a text or --answer is needed to resume a run')
    }
    if (values.by !== undefined && (values.resume === undefined || !values.by.trim())) throw new Usage('--by names who resumes a run, with --resume')
    if (values.then !== undefined && !values.then.trim()) throw new Usage('--then needs a prompt')
    if (values.attach !== undefined && !values.attach.trim()) throw new Usage('--attach needs a text')
    if (values.started !== undefined && (values.id === undefined || Number.isNaN(Date.parse(values.started)))) throw new Usage('--started is the time a run spawned with --id was asked for, like 2026-10-09T10:00:00.000Z')
    // A parent this project has no record of is refused while someone is still listening; a run
    // spawned with its id was asked about already.
    if (values.parent !== undefined && values.id === undefined && !(await findRun(repo, values.parent))) {
      throw new Refused({ ok: false, reason: 'no-parent', parent: values.parent }, `no run ${values.parent} in this project`)
    }
    // A person's run is refused before it spends a checkout when its coding agent cannot start;
    // a scheduler asks the same before it marks, and a resumed run's agent already ran once here.
    if (values.resume === undefined && values.id === undefined) {
      const ready = await readyToRun(repo, driver ?? 'claude-code')
      if (ready.problems.length > 0) throw new Refused({ ok: false, reason: 'not-ready', ...ready }, ready.problems.join(' '))
    }
    const named = { ...(values.then !== undefined ? { then: values.then.trim() } : {}), ...(publish !== undefined ? { publish } : {}), ...(values.attach !== undefined ? { attached: values.attach } : {}), ...(values.parent !== undefined ? { parent: values.parent } : {}), ...(values.base !== undefined ? { base: values.base } : {}) }
    if (values.detach && values.resume !== undefined) {
      const resumed = await detachResume(repo, {
        id: values.resume,
        ...(positionals[0] !== undefined ? { text: positionals[0] } : {}),
        ...(values.answer !== undefined ? { answer: values.answer } : {}),
        ...(values.model !== undefined ? { model: values.model } : {}),
        ...(values.effort !== undefined ? { effort: values.effort } : {}),
        ...(values.by !== undefined ? { by: values.by } : {}),
        ...(publish !== undefined ? { publish } : noLevel ? { publish: NO_PUBLISH } : {}),
      })
      return { ok: true, detached: true, ...resumed }
    }
    if (values.detach) {
      if (positionals[0] === undefined) throw new Usage('expected 1 argument(s), got 0')
      if (values.id !== undefined) throw new Usage('--detach takes no --id: the run\'s id is minted and answered')
      const started = await detachRun(repo, { prompt: positionals[0], ...(values.model !== undefined ? { model: values.model } : {}), ...(values.effort !== undefined ? { effort: values.effort } : {}), ...(driver !== undefined ? { driver } : {}), ...named })
      return { ok: true, detached: true, ...started }
    }
    if (values.resume !== undefined) {
      const outcome = await resumeProject(repo, {
        id: values.resume,
        ...(positionals[0] !== undefined ? { text: positionals[0] } : {}),
        ...(values.answer !== undefined ? { answer: values.answer } : {}),
        ...(values.model !== undefined ? { model: values.model } : {}),
        ...(values.effort !== undefined ? { effort: values.effort } : {}),
        ...(values.by !== undefined ? { by: values.by } : {}),
        ...(publish !== undefined ? { publish } : noLevel ? { publish: NO_PUBLISH } : {}),
        log: io.stderr,
      })
      return { ok: outcome.status === 'done' || outcome.status === 'waiting', ...outcome }
    }
    if (positionals[0] === undefined) throw new Usage('expected 1 argument(s), got 0')
    const outcome = await runProject(repo, {
      prompt: positionals[0],
      ...(values.id !== undefined ? { id: values.id } : {}),
      ...(values.started !== undefined ? { startedAt: new Date(values.started).toISOString() } : {}),
      ...(values.mark ? { mark: true } : {}),
      ...(values.model !== undefined ? { model: values.model } : {}),
      ...(values.effort !== undefined ? { effort: values.effort } : {}),
      ...(driver !== undefined ? { driver } : {}),
      ...named,
      log: io.stderr,
    })
    return { ok: outcome.status === 'done' || outcome.status === 'waiting', ...outcome }
  },

  async check(args, io, git) {
    const { values } = parse(args, { driver: { type: 'string' } }, 0)
    const driver = values.driver ?? 'claude-code'
    if (!isDriverName(driver)) throw new Usage(`unknown driver "${driver}"; the drivers are ${DRIVER_NAMES.join(' and ')}`)
    const repo = await project(io.cwd, git)
    return { ok: true, ...(await readyToRun(repo, driver)) }
  },

  async 'git-host'(args, io, git) {
    // What follows is the git host's own command line, read by it, not here.
    if (args.length === 0) throw new Usage('git-host needs the command to run')
    const repo = await project(io.cwd, git)
    const command = await gitHostCommand(repo)
    if (!command) throw new Refused({ ok: false, reason: 'no-git-host' }, 'this project has no git host package')
    const result = await runPackageCommand(repo, command, args)
    if (!result.ok) throw new Refused({ ok: false, reason: 'git-host', detail: result.error }, result.error)
    return result.output
  },

  async init(args, io, git) {
    parse(args, {}, 0)
    const repo = await project(io.cwd, git)
    const outcome = await initHooks(repo)
    if (outcome.ok) return outcome
    const line = outcome.reason === 'no-dashboard' ? 'no .openagent/ here: add the project in the dashboard first' : `${outcome.file}: ${outcome.detail ?? 'unreadable'}`
    throw new Refused(outcome, line)
  },

  async cleanup(args, io, git) {
    parse(args, {}, 0)
    const repo = await project(io.cwd, git)
    const outcome = await cleanup(repo, { git })
    if (outcome.ok) {
      // The rules that hid the basic skills' links: this tool had them linked, so it takes them back.
      await liftSkillRules(repo, await everyBasicSkill(), git)
      return outcome
    }
    throw new Refused(outcome, `a run is still working here (${outcome.runs.join(', ')}): stop it first`)
  },
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

/**
 * The arguments with every text made safe for the reader of options: a text may open with a dash
 * (`- fix the tests`, an answer that is a list), and a line of a project's hook file hands it
 * over as it was typed. An argument that is one of the command's own flags, alone or with `=` and
 * a value, is a flag; a flag that takes a text takes the next argument whole, whatever it opens
 * with, unless that is another of the command's flags, which leaves it with no text for the
 * reader to refuse. One word behind a dash that is no flag of the command (`--help`, a flag
 * misspelled) is left for the reader to refuse too: nobody's prompt is that. Everything else is a
 * text, handed over after `--`.
 */
export function withTextsApart(args: readonly string[], options: Options): string[] {
  const flags: string[] = []
  const texts: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      texts.push(...args.slice(i + 1))
      break
    }
    const option = ownFlag(arg, options)
    if (!option) (/^--?[A-Za-z][\w-]*$/.test(arg) ? flags : texts).push(arg)
    else if (option.type === 'string' && !arg.includes('=') && i + 1 < args.length && !ownFlag(args[i + 1]!, options)) flags.push(`${arg}=${args[++i]}`)
    else flags.push(arg)
  }
  return [...flags, '--', ...texts]
}

/** The command's own flag an argument is, alone (`--model`) or with `=` and a value; nothing for any other argument. */
function ownFlag(arg: string, options: Options): Options[string] | undefined {
  const name = /^--([a-z][a-z-]*)(=[\s\S]*)?$/.exec(arg)?.[1]
  return name !== undefined && Object.hasOwn(options, name) ? options[name] : undefined
}

function parse<O extends Options>(args: string[], options: O, min: number, max: number = min) {
  try {
    const parsed = parseArgs({ args: withTextsApart(args, options), options, allowPositionals: true, strict: true })
    if (parsed.positionals.length < min || parsed.positionals.length > max) {
      throw new Usage(`expected ${max === min ? min : `${min} to ${max}`} argument(s), got ${parsed.positionals.length}`)
    }
    return parsed
  } catch (err) {
    throw err instanceof Usage ? err : new Usage(err instanceof Error ? err.message : String(err))
  }
}

