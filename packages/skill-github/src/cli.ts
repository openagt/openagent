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
import { readFileSync } from 'node:fs'
import { HOST, ghState, hasBrew, installCommand, jobFiles, jobState, loginUnderWay, picksPath, runEnv, runsAccount, startJob, startLogin, useForRuns, type JobState, type LoggingIn } from './accounts.js'

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
  replies [--since <iso>]      what came on the open issues and pull requests this machine's agents worked on, since each agent ended: maintainers' words
                               that call the agent with /agent, and on an agent's own pull request checks that turned red and a conflict once the base branch moved;
                               [{ run, text }], one per run, read from the project's run records; with --since, also [{ for, text, branch? }] for each open issue or
                               pull request no run was on, where a maintainer called the agent since then: the check of a scheduler's row with each
  comment <number> --body <text>
                               post a comment on issue or pull request <number>: its id and url. It opens with the coding agent's logo, the model and the effort, as the agent's
                               run record says (found through AGENT_DIARY, which its runner sets), else the line 🤖 automated; a hidden mark after the text, so replies never counts it
  open [--branch <b>] --title <t> [--body <text>] [--draft] [--merge]
                               open the pull request of branch <b> (default: the current branch; it must be on the remote already); an open one is answered as it is; --merge lands it on green.
                               An account that cannot write to the project pushes to its fork: git remote set-url --push origin <fork>; open and replies then take that fork's
                               pull requests as this machine's
  merge <number>               land pull request <number>: a draft is marked ready, then the merge is armed as --merge arms it
  watch <number>               wait for pull request <number>'s checks and merge it once they pass; what --merge starts where the repository has no auto-merge
  home                         the project's page on GitHub, from its origin remote
  me                           who is signed in to GitHub through gh: login, name, avatar (a picture's https address)
  accounts [--host <host>]     the GitHub accounts this computer's gh knows and the one OpenAgent's runs use: { host, name, requestWord, logo, tool, installed,
                               install, accounts: [{ login, terminal, runs, ok }], loggingIn? }; a host other than github.com is refused (not-mine)
  use <login>                  OpenAgent's runs use <login> from now on, an account gh knows; the terminal's gh stays on its own
  login                        log another account in to gh in the browser: { code, url }, the code typed at url; gh waits on for the yes, then the terminal's
                               account is made the terminal's again
  install                      put gh on this computer with no admin: Homebrew where it is, else GitHub's build into ~/.local/bin; answers once it
                               started, and accounts says installing until it ended, then installFailed if it did
  env [--user <login>]         the environment a run gets to work as <login> (default: the account runs use): { env }, its token for gh and for git
  token --user <login>         <login>'s token as gh keeps it, checked with GitHub to be that account's: { login, token }; what OpenAgent copies to a
                               server of the person's, which then uses the same login, never a new one
  take                         log in to gh with the token on standard input, beside the accounts gh knows: { login }
  forget <login>               gh forgets <login> on this computer; the token is not ended, and goes on working wherever else it is
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
  /** Whether Homebrew is here; the default asks. */
  hasBrew?: () => Promise<boolean>
  /** Start an install command, going on after the command answers; the default runs it in a shell of its own. */
  shell?: (command: string) => Promise<void>
  /** How the install started last went; the default reads it off its files. */
  installing?: () => JobState | undefined
  /** Start a browser login, the terminal's account given back after; the default runs gh. */
  login?: (terminal: string | undefined) => Promise<LoggingIn>
  /** The browser login under way; the default reads it off its files. */
  underWay?: () => LoggingIn | undefined
  /** What the command was handed on standard input; the default reads the process's. */
  stdin?: () => Promise<string>
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
  const context: Context = {
    cwd: io.cwd,
    gh: deps.gh ?? nodeGhRunner(),
    git: deps.git ?? nodeGitRunner(),
    ...(deps.watch ? { watch: deps.watch } : {}),
    env: deps.env ?? process.env,
    stderr: io.stderr,
    hasBrew: deps.hasBrew ?? (() => hasBrew()),
    shell: deps.shell ?? (command => startJob(jobFiles('install'), command)),
    installing: deps.installing ?? (() => jobState(jobFiles('install'))),
    login: deps.login ?? (terminal => startLogin(terminal)),
    underWay: deps.underWay ?? (() => loginUnderWay()),
    stdin: deps.stdin ?? readStdin,
  }
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
  hasBrew: () => Promise<boolean>
  shell: (command: string) => Promise<void>
  installing: () => JobState | undefined
  login: (terminal: string | undefined) => Promise<LoggingIn>
  underWay: () => LoggingIn | undefined
  stdin: () => Promise<string>
}

/** All of the process's standard input, as text. */
async function readStdin(): Promise<string> {
  let said = ''
  for await (const chunk of process.stdin.setEncoding('utf8')) said += chunk
  return said
}

/**
 * `login`'s token as gh keeps it, once GitHub said it is that account's: a login gh keeps under
 * one name can be another account's, and nothing must go out as someone else than it says.
 */
async function tokenOf(login: string, cwd: string, gh: GhRunner): Promise<string> {
  let token: string
  try {
    token = (await gh(['auth', 'token', '--hostname', HOST, '--user', login], cwd)).trim()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Refused({ ok: false, reason: 'no-token', login, detail }, `gh gave no token for ${login}: ${detail}`)
  }
  const whose = await whoseToken(token, cwd, gh, login)
  if (whose.toLowerCase() !== login.toLowerCase()) {
    throw new Refused({ ok: false, reason: 'not-that-account', login, whose }, `the login gh keeps for ${login} is ${whose}'s on GitHub: add ${login} again in OpenAgent's Settings › Accounts`)
  }
  return token
}

/** The account GitHub says a token is: `login`, when given, names the account it was asked for. */
async function whoseToken(token: string, cwd: string, gh: GhRunner, login?: string): Promise<string> {
  try {
    return (await gh(['api', 'user', '--jq', '.login'], cwd, { GH_TOKEN: token })).trim()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Refused({ ok: false, reason: 'no-token', ...(login !== undefined ? { login } : {}), detail }, `GitHub did not take ${login !== undefined ? `${login}'s login` : 'the login'}: ${detail}`)
  }
}

/** What a GitHub token reads as: letters, digits and underscores, nothing a line could break on. */
const TOKEN = /^[A-Za-z0-9_]{20,255}$/

/** The logo OpenAgent draws the host's card with. */
const LOGO = readFileSync(new URL('../assets/github.svg', import.meta.url), 'utf8').trim()

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
    const { values } = parse(args, { since: { type: 'string' } }, 0)
    if (values.since !== undefined && Number.isNaN(Date.parse(values.since))) throw new Usage(`--since is a time, like 2026-10-09T10:00:00Z, not "${values.since}"`)
    try {
      return await listReplies(cwd, { gh, ...(values.since !== undefined ? { since: values.since } : {}) })
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

  async accounts(args, { cwd, gh, env, hasBrew, underWay, installing }) {
    const { values } = parse(args, { host: { type: 'string' } }, 0)
    if (values.host !== undefined && values.host.toLowerCase() !== HOST) throw new Refused({ ok: false, reason: 'not-mine', host: values.host }, `this package answers for ${HOST}, not ${values.host}`)
    const state = await ghState(cwd, gh)
    const accounts = state.installed ? state.accounts : []
    const runs = runsAccount(accounts, picksPath(env))
    const loggingIn = state.installed ? underWay() : undefined
    const install = installing()
    const installWith = state.installed ? undefined : installCommand(await hasBrew())
    return {
      ok: true,
      host: HOST,
      name: GIT_HOST_NAME,
      requestWord: 'pull request',
      logo: LOGO,
      tool: 'gh',
      installed: state.installed,
      ...(installWith !== undefined ? { install: installWith } : {}),
      accounts: accounts.map(a => ({ ...a, runs: a.login === runs })),
      ...(loggingIn ? { loggingIn } : {}),
      // The install a press started: going on, or why it failed while gh is still not here.
      ...(install?.running ? { installing: true } : !state.installed && install?.failed !== undefined ? { installFailed: install.failed } : {}),
    }
  },

  async use(args, { cwd, gh, env }) {
    const login = parse(args, {}, 1).positionals[0]!
    const state = await ghState(cwd, gh)
    try {
      useForRuns(login, state.installed ? state.accounts : [], picksPath(env))
    } catch (err) {
      throw new Refused({ ok: false, reason: 'no-account', login }, err instanceof Error ? err.message : String(err))
    }
    return { ok: true, login }
  },

  async login(args, { cwd, gh, login }) {
    parse(args, {}, 0)
    const state = await ghState(cwd, gh)
    if (!state.installed) throw new Refused({ ok: false, reason: 'not-installed' }, 'gh is not on this computer: run github install first')
    try {
      return { ok: true, ...(await login(state.accounts.find(a => a.terminal)?.login)) }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Refused({ ok: false, reason: 'login-failed', detail }, `gh could not start a login: ${detail}`)
    }
  },

  async install(args, { hasBrew, shell }) {
    parse(args, {}, 0)
    const command = installCommand(await hasBrew())
    if (command === undefined) throw new Refused({ ok: false, reason: 'no-build' }, `GitHub makes no gh for this computer (${process.platform} ${process.arch}): install it by hand, https://cli.github.com`)
    try {
      await shell(command)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Refused({ ok: false, reason: 'install-failed', detail, command }, `gh's install could not be started: ${detail}`)
    }
    return { ok: true, started: true, command }
  },

  async env(args, { cwd, gh, env }) {
    const { values } = parse(args, { user: { type: 'string' } }, 0)
    const state = await ghState(cwd, gh)
    const accounts = state.installed ? state.accounts : []
    if (values.user !== undefined && !accounts.some(a => a.login === values.user)) {
      throw new Refused({ ok: false, reason: 'no-account', login: values.user }, `gh knows no account ${values.user} on ${HOST} on this computer: log it in in OpenAgent's Settings › Accounts`)
    }
    const login = values.user ?? runsAccount(accounts, picksPath(env))
    // Nobody logged in: the run works as git and gh would anyway.
    if (login === undefined) return { ok: true, env: {} }
    return { ok: true, login, env: runEnv(await tokenOf(login, cwd, gh), env) }
  },

  async token(args, { cwd, gh }) {
    const { values } = parse(args, { user: { type: 'string' } }, 0)
    const login = values.user
    if (login === undefined) throw new Usage('token needs --user <login>')
    const state = await ghState(cwd, gh)
    if (!(state.installed ? state.accounts : []).some(a => a.login === login)) throw new Refused({ ok: false, reason: 'no-account', login }, `gh knows no account ${login} on ${HOST} on this computer`)
    return { ok: true, login, token: await tokenOf(login, cwd, gh) }
  },

  async take(args, { cwd, gh, stdin }) {
    parse(args, {}, 0)
    const token = (await stdin()).trim()
    if (!TOKEN.test(token)) throw new Refused({ ok: false, reason: 'no-token' }, 'what was handed over is no GitHub token')
    const login = await whoseToken(token, cwd, gh)
    try {
      await gh(['auth', 'login', '--hostname', HOST, '--git-protocol', 'https', '--with-token'], cwd, undefined, token)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Refused({ ok: false, reason: 'login-failed', login, detail }, `gh did not take ${login}'s login: ${detail}`)
    }
    return { ok: true, login }
  },

  async forget(args, { cwd, gh }) {
    const login = parse(args, {}, 1).positionals[0]!
    const state = await ghState(cwd, gh)
    if (!(state.installed ? state.accounts : []).some(a => a.login === login)) return { ok: true, login }
    try {
      // gh only takes it off this computer: the token itself goes on working wherever else it is.
      await gh(['auth', 'logout', '--hostname', HOST, '--user', login], cwd)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Refused({ ok: false, reason: 'logout-failed', login, detail }, `gh did not forget ${login}: ${detail}`)
    }
    // A pick of runs that names it falls back to the terminal's account.
    return { ok: true, login }
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
