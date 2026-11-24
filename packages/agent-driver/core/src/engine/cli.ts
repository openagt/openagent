import { PLUGINS_WITHOUT_ENV, PROFILE_ENV, Refused, UsageError, errorMessage, inRepo, nodeGitRunner, parseCommandArgs, runCommandLine, sessionsHomeOf, PROJECT_SKILLS_ENV, helpRows, helpText, type Command, type GitRunner } from '@openagt/agent-data'
import { UnknownAgent, agentNames, codingAgents } from '../agents.js'
import { projectRoot, sessionRepos } from '@openagt/git-branches'
import { GIT_ACCOUNT_ENV, detachResume, detachRun, profileLoginFor, readyToRun, resumeProject, runProject, type SpawnedResume } from './runner.js'
import type { RunOutcome, RunRequest } from './run.js'
import { anyPick, handedDownSettings, profileNamed, runProfile, sessionPicksNamed } from './profile.js'
import { hasImage, isImageName } from '../images.js'
import { isPublish, NO_PUBLISH, PUBLISH_LEVELS } from './records.js'

/**
 * The command line: JSON on stdout, one line for a person on stderr, and the exit code says how
 * it went — 0 for a result, 1 for a refusal or a failure, 2 for a command that could not be read.
 * The same contract as the skills' commands, so a person and a dashboard read it the same way.
 */

export const USAGE = `usage: agent-runner <command>

${helpRows([
  ['run <prompt> [--model <id>] [--effort <level>] [--driver <agent>] [<option>…]', `one run of <prompt> in its own checkout, now, recorded; on the coding agent --driver names among those of OpenAgent's distribution (claude-code, codex), else its first, on the coding agent's own default model unless --model names one`],
  ['run --detach <prompt>', `the same run in its own process, answered at once with its id`],
  ['run --resume <id> [<text>] [--answer <label>] [--publish <commit|branch|pr|merge|nothing>]', `continue an ended run: the same record, its session resumed; the text as the next prompt, or the answer to the question it ended on; with --publish, the run takes its work that far from here on, or, with nothing, only as far as its prompts ask; at its record's level without it`],
  ['run --detach --resume <id> …', `the same continuing in its own process, answered at once`],
  ['run --resume <id> … --by <who>', `kept on the run's record with the time, until its next resume: a scheduler's row that resumed it, which counts the run as its own`],
  ['check [--driver <agent>]', `whether a run can start here: the coding agent's CLI installed and logged in, and its warnings; what this computer's host answers before a Start`],
  'Options of run:',
  ['--publish <commit|branch|pr|merge>', 'with --publish, the agent is told, in one sentence after the prompt, how far to take its work when it finishes: commit it, and from there push its branch, open its pull request, or set the request to merge once its checks pass; without it the prompt goes as written, and nothing is committed or published unless the prompt asks'],
  ['--attach <text>', `with --attach, the agent is handed <text> with the prompt, after it and before the --publish sentence, and with no later message; the run's record keeps it apart from the prompt, which alone names the run`],
  ['--image <name>', `with --image, once per image, the prompt (a resume's text too) goes with the image this computer keeps under <name> in its image store (~/.openagent-images, or $XDG_CONFIG_HOME/openagent-images), and the agent looks at it with the prompt alone; the run's record names it`],
  ['--base <ref>', `with --base, the run's branch starts from <ref> instead of origin's default branch; refs/remotes/origin/<branch> is that branch as origin has it, fetched first`],
  ['--pr-base <branch>', `with --pr-base, the --publish sentence names <branch> as the branch its pull request goes into, instead of origin's default branch`],
  ['--branch <name>', `with --branch, the run works on <name>, a branch that exists, such as a person's pull request's, instead of a fresh one`],
  ['--for <thread>', `with --for, the run's record names what it was started for, a thread's address on the git host, so the next call there finds it`],
  ['--repos <folders>', `with --repos, each git repository among <folders>, one per line, is copied into the session's folder (below)`],
])}

${helpText(`In the sessions home (~/.openagent-sessions, or $XDG_CONFIG_HOME/openagent-sessions) a run has no project: it works in a folder of its own there, <home>/<id>, with no git, kept when it ends; its record is kept with the other sessions' in the personal folder, and --base, --pr-base and --branch are refused, as is --publish with no --repos. Each repo given with --repos is a clone in it, <home>/<id>/<repo's folder name>, on a new branch agent-<id>, its origin the repo's own (none when the repo has none); the run's record names them, and a resumed run goes on with the same ones. A run in a project given --repos has the same folder for the copies alone, its own work being in its checkout of the project, and its prompt is followed by where the copies are. The --publish sentence names the copies too: one level holds for the project and for each copy the agent changed.`)}

${helpText(`A run is on a profile (a name and a saved set of run options, kept with the person in their folder), the one OPENAGENT_PROFILE names, else Default; its options are the run's where the session picked none: at the git host its login, unless OPENAGENT_GIT_ACCOUNT names the pick for that session, on Claude and Codex the accounts it names that this computer has, the plugins it goes without and the project's own skills it names. The record keeps the profile and the login, and a resumed run goes on with them, on the profile as it stands then. An account this computer cannot use at the git host stops the run before it starts, naming it.`)}

${helpText(`A session's picks, for that run alone: OPENAGENT_PLUGINS_WITHOUT names enabled plugins it goes without, their names separated by commas, so it gets none of their skills and none of their steps: set to nothing, none of them; unset, its profile's; OPENAGENT_PROJECT_SKILLS says which of the project's own skills (.agents/skills/<name>, .claude/skills/<name>) stay in its checkout: all, none, or their names separated by commas, the others left out of that checkout by git's sparse checkout, nothing committed; unset, its profile's, and all when that names none. The record keeps the picks, and a resumed run goes on with them.`)}

${helpText(`A run's coding agent loads the person's own setup, as when started by hand; in the project's .agent-runner/config.yml, each part is left out with its own line under \`personal:\`, so a run does the same job on every machine. The file is this machine's: keep it out of git (this tool hides .agent-runner/ from git once a run has started here).`)}
${helpRows([
  ['personal:', ''],
  ['  memory: off', `Claude Code's auto-memory; Codex's memories`],
  ['  connectors: off', `your claude.ai connectors; Codex's apps and plugins`],
  ['  skills: off', `Claude Code: your user settings (effort, model, hooks, a login through apiKeyHelper or env), the skills synced from your claude.ai account, ~/.claude/CLAUDE.md, ~/.claude/skills.\nCodex: ~/.codex/AGENTS.md, ~/.codex/skills, ~/.codex/config.toml (with a model provider or login set there) and its memories, so Codex's memory stays on only with skills on too (\`check\` warns).\nCodex loads skills in ~/.agents/skills either way; with skills off, \`check --driver codex\` warns about them.`],
])}

${helpText('JSON on stdout. Exit code 1 for a refusal or a failure (the reason on stderr), 2 for a usage error.')}`

export interface CliIo {
  cwd: string
  stdout: (line: string) => void
  stderr: (line: string) => void
}

export function runCli(argv: string[], io: CliIo, git: GitRunner = nodeGitRunner()): Promise<number> {
  return runCommandLine(argv, io, { program: 'agent-runner', usage: USAGE, commands: COMMANDS }, io, git)
}

/** The flags of `run`: what a run is asked, how its process is started, and what a resume continues it with. */
const RUN_FLAGS = {
  id: { type: 'string' },
  model: { type: 'string' },
  effort: { type: 'string' },
  resume: { type: 'string' },
  answer: { type: 'string' },
  detach: { type: 'boolean' },
  mark: { type: 'boolean' },
  driver: { type: 'string' },
  publish: { type: 'string' },
  attach: { type: 'string' },
  image: { type: 'string', multiple: true },
  started: { type: 'string' },
  base: { type: 'string' },
  'pr-base': { type: 'string' },
  branch: { type: 'string' },
  for: { type: 'string' },
  by: { type: 'string' },
  repos: { type: 'string' },
} as const

/** `--driver`, refused as a usage error when it names no coding agent of the distribution handed down to this process. */
async function knownAgent(driver: string | undefined): Promise<void> {
  if (driver === undefined) return
  const agents = await codingAgents()
  if (agents.length === 0) throw new UsageError(new UnknownAgent(driver, agents).message)
  if (!agents.some(agent => agent.id === driver)) throw new UsageError(`unknown driver "${driver}"; the drivers are ${agentNames(agents)}`)
}

const COMMANDS: Record<string, Command<[CliIo, GitRunner]>> = {
  async run(args, io, git) {
    const { positionals, values } = parseWithTexts(args, RUN_FLAGS, 0, 1)
    const repo = await project(io.cwd, git)
    const driver = values.driver
    const publish = isPublish(values.publish) ? values.publish : undefined
    // A resume may also take the run's level away: from there on its prompts go as written.
    const noLevel = values.resume !== undefined && values.publish === NO_PUBLISH
    if (values.publish !== undefined && publish === undefined && !noLevel) throw new UsageError(`unknown publish level "${values.publish}"; the levels are ${PUBLISH_LEVELS.join(', ')}${values.resume !== undefined ? `, or ${NO_PUBLISH}` : ''}`)
    if (values.resume !== undefined) {
      if (driver !== undefined) throw new UsageError('--resume takes no --driver: a run continues on the coding agent its record names')
      if (values.id !== undefined) throw new UsageError('--resume takes no --id: a run continues under its own')
      if (values.attach !== undefined) throw new UsageError('--resume takes no --attach: a text is handed over with a run\'s first prompt only')
      if (values.started !== undefined) throw new UsageError('--resume takes no --started: a run continues from the start its record names')
      if (values.base !== undefined) throw new UsageError('--resume takes no --base: a run continues on its own branch')
      if (values['pr-base'] !== undefined) throw new UsageError('--resume takes no --pr-base: a run continues into the branch its record names')
      if (values.branch !== undefined) throw new UsageError('--resume takes no --branch: a run continues on its own branch')
      if (values.for !== undefined) throw new UsageError('--resume takes no --for: a run continues for what its record names')
      if (values.repos !== undefined) throw new UsageError('--resume takes no --repos: a session continues with the repos its record names')
      if (positionals[0] === undefined && values.answer === undefined) throw new UsageError('a text or --answer is needed to resume a run')
    }
    await knownAgent(driver)
    if (values.by !== undefined && (values.resume === undefined || !values.by.trim())) throw new UsageError('--by names who resumes a run, with --resume')
    if (values.branch !== undefined && values.base !== undefined) throw new UsageError('--branch takes no --base: the run works on a branch that exists')
    if (values.branch !== undefined && !values.branch.trim()) throw new UsageError('--branch needs a branch name')
    if (values['pr-base'] !== undefined && !values['pr-base'].trim()) throw new UsageError('--pr-base needs a branch name')
    if (values.for !== undefined && !values.for.trim()) throw new UsageError('--for needs what the run is for')
    const images = values.image ?? []
    const notAnImage = images.find(name => !isImageName(name))
    if (notAnImage !== undefined) throw new UsageError(`--image names an image of the image store, like <sha256>.png: not ${JSON.stringify(notAnImage)}`)
    if (images.length > 0 && values.answer !== undefined) throw new UsageError('--answer takes no --image: images go with a text')
    const missing = (await Promise.all(images.map(async name => ((await hasImage(name)) ? undefined : name)))).find(name => name !== undefined)
    if (missing !== undefined) throw new UsageError(`the image ${missing} is not kept on this computer`)
    if (values.attach !== undefined && !values.attach.trim()) throw new UsageError('--attach needs a text')
    // A session with no project works in a folder with no git: no branch to start from or work on. What it publishes is its
    // copies of repos: a level goes with them, and with a resume, whose record names them.
    const noProject = (await sessionsHomeOf(repo)) !== undefined
    if (noProject) {
      const gitFlag = (['base', 'pr-base', 'branch'] as const).find(flag => values[flag] !== undefined)
      if (gitFlag !== undefined) throw new UsageError(`--${gitFlag} is for a run in a project: a session with no project has no git`)
      if (publish !== undefined && values.repos === undefined && values.resume === undefined) throw new UsageError('--publish needs --repos in a session with no project: its copies of repos are what it publishes')
    }
    // The repos a session has as context, in a project or with none, one folder per line, each copied into the session's folder.
    const folders = (values.repos ?? '').split('\n').map(line => line.trim()).filter(Boolean)
    const repos = folders.length > 0 ? await sessionRepos(folders, git).catch((err: unknown) => {
      const line = errorMessage(err)
      throw new Refused({ ok: false, reason: 'not-a-repo', detail: line }, line)
    }) : undefined
    if (values.started !== undefined && (values.id === undefined || Number.isNaN(Date.parse(values.started)))) throw new UsageError('--started is the time a run spawned with --id was asked for, like 2026-10-09T10:00:00.000Z')
    // The account at the git host picked for this session, by whoever started the run: in the environment ({@link GIT_ACCOUNT_ENV}).
    const gitAccount = process.env[GIT_ACCOUNT_ENV]?.trim() || undefined
    if (gitAccount !== undefined && values.resume !== undefined) throw new UsageError(`${GIT_ACCOUNT_ENV} is for a new run: a run continues as the account its record names`)
    // The profile the run is on, by its id, in the environment too ({@link PROFILE_ENV}); a resumed run goes on with the one its record names.
    const profile = fromEnvironment(profileNamed)
    if (process.env[PROFILE_ENV]?.trim() && values.resume !== undefined) throw new UsageError(`${PROFILE_ENV} is for a new run: a run continues on the profile its record names`)
    // The session's picks, in the environment the same way; a resumed run goes on with the ones its record keeps.
    const picks = fromEnvironment(sessionPicksNamed)
    if (anyPick(picks) && values.resume !== undefined) throw new UsageError(`${PLUGINS_WITHOUT_ENV} and ${PROJECT_SKILLS_ENV} are for a new run: a run continues with the picks its record names`)
    if (picks.project !== undefined && noProject) throw new UsageError(`${PROJECT_SKILLS_ENV} is for a run in a project: a session with no project has no project skills`)
    // A person's run is refused before it spends a checkout when its coding agent cannot start;
    // a scheduler asks the same before it marks, and a resumed run's agent already ran once here.
    if (values.resume === undefined && values.id === undefined) {
      // The session's account, or its profile's: an account this computer cannot use stops the run here, naming it.
      const login = gitAccount ?? (await profileLoginFor(repo, await runProfile(profile, await handedDownSettings(), io.stderr)))
      const ready = await readyToRun(repo, driver, login !== undefined ? { login } : {})
      if (ready.problems.length > 0) throw new Refused({ ok: false, reason: 'not-ready', ...ready }, ready.problems.join(' '))
    }

    if (values.resume !== undefined) {
      const resume: SpawnedResume = {
        id: values.resume,
        ...(positionals[0] !== undefined ? { text: positionals[0] } : {}),
        ...(values.answer !== undefined ? { answer: values.answer } : {}),
        ...(images.length > 0 ? { images } : {}),
        ...(values.model !== undefined ? { model: values.model } : {}),
        ...(values.effort !== undefined ? { effort: values.effort } : {}),
        ...(values.by !== undefined ? { by: values.by } : {}),
        ...(publish !== undefined ? { publish } : noLevel ? { publish: NO_PUBLISH } : {}),
      }
      if (values.detach) return { ok: true, detached: true, ...(await detachResume(repo, resume)) }
      return answered(await resumeProject(repo, { ...resume, log: io.stderr }))
    }
    if (positionals[0] === undefined) throw new UsageError('expected 1 argument(s), got 0')
    // What the run is asked, the same whether it goes on in this process or in one of its own.
    const asked: RunRequest & { driver?: string } = {
      prompt: positionals[0],
      ...(values.model !== undefined ? { model: values.model } : {}),
      ...(values.effort !== undefined ? { effort: values.effort } : {}),
      ...(driver !== undefined ? { driver } : {}),
      ...(publish !== undefined ? { publish } : {}),
      ...(values.attach !== undefined ? { attached: values.attach } : {}),
      ...(images.length > 0 ? { images } : {}),
      ...(values.base !== undefined ? { base: values.base } : {}),
      ...(values['pr-base'] !== undefined ? { prBase: values['pr-base'].trim() } : {}),
      ...(values.branch !== undefined ? { branch: values.branch.trim() } : {}),
      ...(values.for !== undefined ? { for: values.for.trim() } : {}),
      ...(repos !== undefined ? { repos } : {}),
    }
    if (values.detach) {
      if (values.id !== undefined) throw new UsageError('--detach takes no --id: the run\'s id is minted and answered')
      return { ok: true, detached: true, ...(await detachRun(repo, asked)) }
    }
    return answered(
      await runProject(repo, {
        ...asked,
        ...(anyPick(picks) ? { picks } : {}),
        ...(values.id !== undefined ? { id: values.id } : {}),
        ...(values.started !== undefined ? { startedAt: new Date(values.started).toISOString() } : {}),
        ...(values.mark ? { mark: true } : {}),
        ...(gitAccount !== undefined ? { gitAccount } : {}),
        ...(profile !== undefined ? { profile } : {}),
        log: io.stderr,
      }),
    )
  },

  async check(args, io, git) {
    const { values } = parseWithTexts(args, { driver: { type: 'string' } }, 0)
    await knownAgent(values.driver)
    const repo = await project(io.cwd, git)
    return { ok: true, ...(await readyToRun(repo, values.driver)) }
  },
}

/** A run's outcome as `run` answers it: ok when the run ended done, or waiting on a question. */
function answered(outcome: RunOutcome): { ok: boolean } & RunOutcome {
  return { ok: outcome.status === 'done' || outcome.status === 'waiting', ...outcome }
}

/** What `read` reads off the environment; a value it cannot read is a command line that cannot be read. */
function fromEnvironment<T>(read: () => T): T {
  try {
    return read()
  } catch (err) {
    throw new UsageError(errorMessage(err))
  }
}

/**
 * The project the working directory belongs to, even from inside a checkout under `.branches/`;
 * or the sessions home, from it or from a session's folder in it: the runs with no project.
 */
async function project(cwd: string, git: GitRunner): Promise<string> {
  const sessions = await sessionsHomeOf(cwd)
  if (sessions !== undefined) return sessions
  return inRepo(() => projectRoot(cwd, git))
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

/** The command's arguments read strictly, as {@link parseCommandArgs} reads them, each text set apart first by {@link withTextsApart}. */
function parseWithTexts<O extends Options>(args: string[], options: O, min: number, max: number = min) {
  return parseCommandArgs(withTextsApart(args, options), options, min, max)
}
