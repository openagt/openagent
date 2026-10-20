import { parseArgs } from 'node:util'
import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { nodeGhRunner, type GhRunner } from './gh.js'
import { listRequests } from './requests.js'
import { openRequest, type OpenOutcome } from './open.js'
import { mergeRequest } from './merge.js'
import { watchAndMerge } from './merge-watch.js'
import { GIT_HOST_NAME, homeUrlFor } from './home.js'
import { createRepository, offerRepository, type CreateOffer, type CreateOutcome } from './create.js'
import { signedIn } from './me.js'
import { listReplies } from './replies.js'
import { DIARY_ENV, byline, writeComment } from './comment.js'

/**
 * The command line over the package (#1820): the same functions for an agent in a shell, and for
 * OpenAgent and the scheduler, which run this command as the project's git host provider,
 * declared in package.json as `"openagent": { "git-host": "github" }`. One implementation, every
 * surface a caller.
 *
 * The contract, the same as the other skills' commands: JSON on stdout, one line for a person on
 * stderr, and the exit code says how it went — 0 for a result, 1 for a refusal or a failure, 2 for
 * a command that could not be read. A refusal is reported on stdout as `{ ok: false, reason }` so
 * a caller parsing the output learns why, and on stderr so a person does.
 *
 * Every command acts on the repository the working directory is in: `gh` finds the repository
 * and its remote from there, as it does for a person.
 */

export const USAGE = `usage: github <command>

  requests [--branch <b>] [--state open|merged|all] [--since <iso>]
                               the project's pull requests, newest first: number, url, state, title, draft, branch, head, createdAt, mergedAt, mergeCommit
  replies                      what came on the open pull requests this machine's agents opened, since each agent ended: maintainers' comments
                               and reviews, checks that turned red, a conflict once the base branch moved; [{ run, text }], one per run, read
                               from the project's run records; the check of a scheduler's row that resumes runs
  comment <number> --body <text>
                               post a comment on pull request <number>: its id and url. It opens with the coding agent's logo, the model and the effort, as the agent's
                               run record says (found through AGENT_DIARY, which its runner sets), else the line 🤖 automated; a hidden mark after the text, so replies never counts it
  open [--branch <b>] --title <t> [--body <text>] [--draft] [--merge]
                               open the pull request of branch <b> (default: the current branch; it must be on the remote already); an open one is answered as it is; --merge lands it on green
  merge <number>               land pull request <number>: a draft is marked ready, then the merge is armed as --merge arms it
  watch <number>               wait for pull request <number>'s checks and merge it once they pass; what --merge starts where the repository has no auto-merge
  home                         the project's page on GitHub, from its origin remote
  me                           who is signed in to GitHub through gh: login, name, avatar (a picture's https address)
  create [--check]             create a private repository for a project with no origin, named <account>/<folder>, set it as origin and push;
                               --check only says which repository that would be

JSON on stdout. Exit code 1 for a refusal or a failure (the reason on stderr), 2 for a usage error.`

/** The streams and the working directory a run of the CLI sees. */
export interface CliIo {
  cwd: string
  stdout: (line: string) => void
  stderr: (line: string) => void
}

/** What a run of the CLI may be given instead of the real gh and git: for tests. */
export interface CliDeps {
  gh?: GhRunner
  git?: GitRunner
  /** Start the merge watcher for a request; the default starts this package's own process. */
  watch?: (repo: string, number: number) => Promise<void>
  /** The environment the command runs in; the default is this process's. */
  env?: NodeJS.ProcessEnv
}

/** A refusal: a rule said no, and the caller learns which. */
export type CliRefusal = { ok: false; reason: string; [key: string]: unknown }

/** Thrown inside a command to end it with a refusal. */
class Refused extends Error {
  constructor(readonly outcome: CliRefusal, readonly line: string) {
    super(line)
  }
}

/** Thrown inside a command for an argument that cannot be read: usage on stderr, exit 2. */
class Usage extends Error {}

/** Run the CLI: `argv` is everything after the program name. Resolves to the exit code. */
export async function runCli(argv: string[], io: CliIo, deps: CliDeps = {}): Promise<number> {
  const [command, ...rest] = argv
  const run = command && Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined
  if (!run) {
    io.stderr(USAGE)
    return 2
  }
  const context: Context = { cwd: io.cwd, gh: deps.gh ?? nodeGhRunner(), git: deps.git ?? nodeGitRunner(), ...(deps.watch ? { watch: deps.watch } : {}), env: deps.env ?? process.env, stderr: io.stderr }
  try {
    io.stdout(JSON.stringify(await run(rest, context)))
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
    io.stdout(JSON.stringify({ ok: false, reason: 'git-host-failed', detail }))
    io.stderr(detail)
    return 1
  }
}

interface Context {
  cwd: string
  gh: GhRunner
  git: GitRunner
  watch?: (repo: string, number: number) => Promise<void>
  env: NodeJS.ProcessEnv
  stderr: (line: string) => void
}

type Command = (args: string[], ctx: Context) => Promise<unknown>

const COMMANDS: Record<string, Command> = {
  async requests(args, { cwd, gh }) {
    const { values } = parse(args, { branch: { type: 'string' }, state: { type: 'string' }, since: { type: 'string' } }, 0)
    const state = values.state ?? 'all'
    if (state !== 'open' && state !== 'merged' && state !== 'all') throw new Usage(`--state is open, merged or all, not ${state}`)
    try {
      return await listRequests(cwd, { ...(values.branch ? { branch: values.branch } : {}), state, ...(values.since ? { since: values.since } : {}) }, gh)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Refused({ ok: false, reason: 'git-host-failed', detail }, `the pull requests could not be read: ${detail}`)
    }
  },

  async replies(args, { cwd, gh }) {
    parse(args, {}, 0)
    try {
      return await listReplies(cwd, { gh })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Refused({ ok: false, reason: 'git-host-failed', detail }, `the pull requests could not be read: ${detail}`)
    }
  },

  async comment(args, { cwd, gh, env }) {
    const { values, positionals } = parse(args, { body: { type: 'string' } }, 1)
    if (values.body === undefined || !values.body.trim()) throw new Usage('--body is required: the text of the comment')
    const number = numberArg(positionals[0]!)
    try {
      return { ok: true, ...(await writeComment(cwd, number, values.body, await byline(env[DIARY_ENV]), gh)) }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Refused({ ok: false, reason: 'git-host-failed', detail }, `the comment could not be written: ${detail}`)
    }
  },

  async open(args, { cwd, gh, git, watch }) {
    const { values } = parse(args, { branch: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, merge: { type: 'boolean' }, draft: { type: 'boolean' } }, 0)
    if (!values.title?.trim()) throw new Usage('--title is required: one line naming what the change does')
    if (values.branch !== undefined && !values.branch.trim()) throw new Usage('--branch names a branch')
    const outcome = await openRequest(cwd, {
      ...(values.branch ? { branch: values.branch } : {}),
      title: values.title.trim(),
      ...(values.body !== undefined ? { body: values.body } : {}),
      ...(values.merge ? { merge: true } : {}),
      ...(values.draft ? { draft: true } : {}),
      gh,
      git,
      ...(watch ? { watch } : {}),
    })
    if (!outcome.ok) throw new Refused(outcome, openRefusalLine(cwd, outcome))
    return outcome
  },

  async merge(args, { cwd, gh, watch }) {
    const number = numberArg(parse(args, {}, 1).positionals[0]!)
    const outcome = await mergeRequest(cwd, number, { gh, ...(watch ? { watch } : {}) })
    if (outcome.outcome === 'not-open') throw new Refused({ ok: false, reason: 'not-open', number, state: outcome.state }, `pull request ${number} is ${outcome.state.toLowerCase()}, not open`)
    if (outcome.outcome === 'failed') throw new Refused({ ok: false, reason: 'merge-failed', number, detail: outcome.error }, `pull request ${number} could not be landed: ${outcome.error}`)
    return { ok: true, number, outcome: outcome.outcome }
  },

  async watch(args, { cwd, gh, stderr }) {
    const number = numberArg(parse(args, {}, 1).positionals[0]!)
    const outcome = await watchAndMerge(cwd, number, { gh, log: stderr })
    return { ok: outcome.outcome === 'merged', number, ...outcome }
  },

  async create(args, { cwd, gh, git }) {
    const { values } = parse(args, { check: { type: 'boolean' } }, 0)
    const outcome = values.check ? await offerRepository(cwd, { gh, git }) : await createRepository(cwd, { gh, git })
    if (!outcome.ok) throw new Refused(outcome, createRefusalLine(outcome))
    return { ...outcome, name: GIT_HOST_NAME }
  },

  async home(args, { cwd, git }) {
    parse(args, {}, 0)
    const url = await homeUrlFor(cwd, git)
    if (!url) throw new Refused({ ok: false, reason: 'no-remote' }, 'no origin remote on GitHub')
    return { ok: true, url, name: GIT_HOST_NAME }
  },

  async me(args, { cwd, gh }) {
    parse(args, {}, 0)
    const outcome = await signedIn(cwd, gh)
    if (!outcome.ok) throw new Refused(outcome, `nobody is signed in to GitHub through gh: ${outcome.detail}`)
    return outcome
  },
}

/** Why no repository was created, as one line for a person. */
function createRefusalLine(outcome: (CreateOffer | CreateOutcome) & { ok: false }): string {
  switch (outcome.reason) {
    case 'has-remote':
      return 'this project already has an origin remote'
    case 'not-logged-in':
      return `GitHub could not be reached as you: ${outcome.detail}`
    case 'create-failed':
      return `the repository could not be created: ${outcome.detail}`
  }
}

/** Why a request was not opened, as one line for a person. */
function openRefusalLine(cwd: string, outcome: OpenOutcome & { ok: false }): string {
  switch (outcome.reason) {
    case 'no-branch':
      return `${cwd} is on no branch; name one with --branch`
    case 'open-failed':
      return `the pull request for ${outcome.branch} could not be opened: ${outcome.detail}`
    case 'merge-failed':
      return `pull request ${outcome.request.number} is open, but its merge could not be armed: ${outcome.detail}`
  }
}

function numberArg(arg: string): number {
  const number = Number(arg)
  if (!Number.isInteger(number) || number <= 0) throw new Usage(`${arg} is not a pull request number`)
  return number
}

type Options = Record<string, { type: 'string' | 'boolean' }>

/** `parseArgs` with the positional count checked: too few or too many is a usage error. */
function parse<O extends Options>(args: string[], options: O, min: number, max: number = min) {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: true, strict: true })
    if (parsed.positionals.length < min || parsed.positionals.length > max) throw new Usage(`expected ${max === min ? min : `${min} to ${max}`} argument(s), got ${parsed.positionals.length}`)
    return parsed
  } catch (err) {
    throw err instanceof Usage ? err : new Usage(err instanceof Error ? err.message : String(err))
  }
}
