import { Refused, UsageError, errorMessage, nodeGitRunner, parseCommandArgs, runCommandLine, type Command, type Failure, type GitRunner } from '@openagt/agent-data'
import { hasBrew, installCommand, nodeGhRunner, type GhRunner } from './gh.js'
import { listRequests } from './requests.js'
import { openRequest, type OpenOutcome } from './open.js'
import { mergeRequest, type WatchStarter } from './merge.js'
import { spawnMergeWatch, watchAndMerge } from './merge-watch.js'
import { GIT_HOST_NAME, homeUrlFor } from './home.js'
import { MAX_PEOPLE, peopleByEmail } from './people.js'
import { createRepository, offerRepository, type CreateOffer, type CreateOutcome } from './create.js'
import { publicProfile, type ProfileFetch } from './profile.js'
import { listRepos } from './repos.js'
import { listReplies } from './replies.js'
import { DIARY_ENV, byline, writeComment } from './comment.js'
import { readFileSync } from 'node:fs'
import { HOST, accountDir, accountsRoot, asAccount, forgetAccount, ghState, gitConfig, installedAccounts, isGithubLogin, loginUnderWay, picksPath, stopLogin, readFacts, runEnv, runsAccount, settleAdded, startLogin, takeToken, useForRuns, type LoggingIn } from './accounts.js'
import { jobFiles, jobState, startJob, type JobState } from './job.js'
import { accountNamed, factsOfToken, tokenOf, workingGh } from './working-account.js'

/**
 * The command line over the package (#1820): the same functions for an agent in a shell, and for
 * OpenAgent and the scheduler, which run this command as the project's git host provider,
 * declared in package.json as `"openagent": { "git-host": "github" }`. One implementation, every
 * surface a caller. It answers as every OpenAgent command does (`runCommandLine`).
 *
 * Every command acts on the repository the working directory is in: `gh` finds the repository
 * and its remote from there, as it does for a person.
 *
 * The commands that talk to GitHub work as one of OpenAgent's own accounts, never as the
 * person's `gh`: inside a run, the account the run was given; elsewhere, the account runs use.
 * With none, they are refused, and say where one is added.
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
  open [--branch <b>] --title <t> [--body <text>] [--base <b>] [--draft] [--merge]
                               open the pull request of branch <b> (default: the current branch; it must be on the remote already); an open one is answered as it is; --base names the branch it
                               goes into (default: the repository's default branch); --merge lands it on green.
                               An account that cannot write to the project pushes to its fork: git remote set-url --push origin <fork>; open and replies then take that fork's
                               pull requests as this machine's
  merge <number>               land pull request <number>: a draft is marked ready, then the merge is armed as --merge arms it
  watch <number>               wait for pull request <number>'s checks and merge it once they pass; what --merge starts where the repository has no auto-merge
  home                         the project's page on GitHub, from its origin remote
  profile <login>              a GitHub user's public profile, read with no login: { login, name, avatar } (a picture's https address); what a person copies
                               into OpenAgent as their own name and picture
  repos [--user <login>] [--owner <name>]
                               the repositories of <name>, a GitHub user or organization (default: the account itself), as the account <login> (default:
                               the account runs use) sees them, its private ones too: { login, owner, repos: [{ address, url, private, pushedAt, description }] },
                               the newest pushed first, at most 300
  people <email>...            the GitHub accounts behind the project's commit emails: [{ email, login, avatar }], one per email a commit of the
                               repository's is signed with by an account, or that is GitHub's own address for one (at most 20 asked at once); any other email is left out
  accounts [--host <host>]     OpenAgent's own GitHub accounts and the one its runs use: { host, name, requestWord, logo, tool, installed,
                               install, accounts: [{ login, runs, ok, avatar }], loggingIn? }; a host other than github.com is refused (not-mine)
  use <login>                  OpenAgent's runs use <login> from now on, one of its accounts
  login                        add an account to OpenAgent, logged in in the browser: { code, url }, the code typed at url; gh waits on for the yes.
  stop-login                   give up the login under way: its gh stops waiting, nothing of it is kept.
                               The account is OpenAgent's own: the person's gh, git and keychain stay as they are
  install                      put gh on this computer with no admin: Homebrew where it is, else GitHub's build into ~/.local/bin; answers once it
                               started, and accounts says installing until it ended, then installFailed if it did
  env [--user <login>]         the environment a run gets to work as <login> (default: the account runs use): { env }, its gh folder, its token for gh and
                               for git, its name on commits; refused (no-account) when OpenAgent has no account
  git-config [--user <login>]  the git settings that make git push and fetch as <login> (default: the account runs use), asking gh for its login when git needs it:
                               { login, host, config: [[key, value]] }; no secret in them, so they may be kept in a repository's own config
  token --user <login>         <login>'s token as OpenAgent keeps it, checked with GitHub to be that account's: { login, token }; what OpenAgent copies to a
                               server of the person's, which then uses the same login, never a new one
  take                         add the login whose token is on standard input as one of OpenAgent's accounts: { login }
  forget <login>               OpenAgent forgets <login>; the token is not ended, and goes on working wherever else it is
  create [--check]             create a private repository for a project with no origin, named <account>/<folder>, set it as origin and push;
                               --check only says which repository that would be

JSON on stdout. Exit code 1 for a refusal or a failure (the reason on stderr), 2 for a usage error.`

/** The streams and the working directory a run of the CLI sees. */
export interface CliIo {
  cwd: string
  stdout: (line: string) => void
  stderr: (line: string) => void
}

/** What the commands work with besides the command line: gh, git, and what reaches past this process. */
interface Services {
  gh: GhRunner
  git: GitRunner
  /** Start the merge watcher for a request; the default starts this package's own process. */
  watch: WatchStarter
  /** The environment the command runs in; the default is this process's. */
  env: NodeJS.ProcessEnv
  /** Whether Homebrew is here; the default asks. */
  hasBrew: () => Promise<boolean>
  /** Start an install command, going on after the command answers; the default runs it in a shell of its own. */
  shell: (command: string) => Promise<void>
  /** How the install started last went; the default reads it off its files. */
  installing: () => JobState | undefined
  /** Start a browser login into OpenAgent's accounts' folder; the default runs gh. */
  login: (root: string) => Promise<LoggingIn>
  /** The browser login under way; the default reads it off its files. */
  underWay: () => LoggingIn | undefined
  /** Give up the browser login under way; the default stops its gh. */
  stopLogin: (root: string) => void
  /** What the command was handed on standard input; the default reads the process's. */
  stdin: () => Promise<string>
  /** What reads a public profile from GitHub; the default is `fetch`. */
  fetch: ProfileFetch
}

/** What a run of the CLI may be given instead of the real services: for tests. */
export type CliDeps = Partial<Services>

/** The real services: this process's gh, git, environment, standard input and network. */
function realServices(): Services {
  return {
    gh: nodeGhRunner(),
    git: nodeGitRunner(),
    watch: spawnMergeWatch,
    env: process.env,
    hasBrew,
    shell: command => startJob(jobFiles('install'), command),
    installing: () => jobState(jobFiles('install')),
    login: startLogin,
    underWay: loginUnderWay,
    stopLogin,
    stdin: readStdin,
    fetch,
  }
}

/** What every command is handed: the services, the directory it runs in, and the stream a person reads. */
interface Context extends Services {
  cwd: string
  stderr: (line: string) => void
}

/** Run the CLI: `argv` is everything after the program name. Resolves to the exit code. */
export function runCli(argv: string[], io: CliIo, deps: CliDeps = {}): Promise<number> {
  const context: Context = { ...realServices(), ...deps, cwd: io.cwd, stderr: io.stderr }
  return runCommandLine(argv, io, { usage: USAGE, commands: COMMANDS, failure: GIT_HOST_FAILED }, context)
}

/** A failure no command meant: the git host, or `gh` talking to it, said no in a way no rule names. */
const GIT_HOST_FAILED: Failure = { reason: 'git-host-failed', detail: errorMessage }

/** All of the process's standard input, as text. */
async function readStdin(): Promise<string> {
  let said = ''
  for await (const chunk of process.stdin.setEncoding('utf8')) said += chunk
  return said
}

/** A command that talks to GitHub: it works as one of OpenAgent's accounts, its `gh` made so before it runs (`working-account.ts`). */
function asOpenAgent(command: Command<[Context]>): Command<[Context]> {
  return async (args, ctx) => command(args, { ...ctx, gh: await workingGh(ctx) })
}

/** What GitHub answers `ask`; when it cannot, a `git-host-failed` refusal whose line says what could not be done, and why. */
async function gitHostAnswer<T>(what: string, ask: () => Promise<T>): Promise<T> {
  try {
    return await ask()
  } catch (err) {
    const detail = errorMessage(err)
    throw new Refused({ ok: false, reason: 'git-host-failed', detail }, `${what}: ${detail}`)
  }
}

/** What a GitHub token reads as: letters, digits and underscores, nothing a line could break on. */
const TOKEN = /^[A-Za-z0-9_]{20,255}$/

/** The logo OpenAgent draws the host's card with. */
const LOGO = readFileSync(new URL('../assets/github.svg', import.meta.url), 'utf8').trim()

const COMMANDS: Record<string, Command<[Context]>> = {
  requests: asOpenAgent(async (args, { cwd, gh }) => {
    const { values } = parseCommandArgs(args, { branch: { type: 'string' }, state: { type: 'string' }, since: { type: 'string' } }, 0)
    const state = values.state ?? 'all'
    if (state !== 'open' && state !== 'merged' && state !== 'all') throw new UsageError(`--state is open, merged or all, not ${state}`)
    return gitHostAnswer('the pull requests could not be read', () => listRequests(cwd, { ...(values.branch ? { branch: values.branch } : {}), state, ...(values.since ? { since: values.since } : {}) }, gh))
  }),

  replies: asOpenAgent(async (args, { cwd, gh }) => {
    const { values } = parseCommandArgs(args, { since: { type: 'string' } }, 0)
    if (values.since !== undefined && Number.isNaN(Date.parse(values.since))) throw new UsageError(`--since is a time, like 2026-10-09T10:00:00Z, not "${values.since}"`)
    return gitHostAnswer('the pull requests could not be read', () => listReplies(cwd, { gh, ...(values.since !== undefined ? { since: values.since } : {}) }))
  }),

  comment: asOpenAgent(async (args, { cwd, gh, env }) => {
    const { values, positionals } = parseCommandArgs(args, { body: { type: 'string' } }, 1)
    const body = values.body
    if (body === undefined || !body.trim()) throw new UsageError('--body is required: the text of the comment')
    const number = numberArg(positionals[0]!)
    const comment = await gitHostAnswer('the comment could not be written', async () => writeComment(cwd, number, body, await byline(env[DIARY_ENV]), gh))
    return { ok: true, ...comment }
  }),

  open: asOpenAgent(async (args, { cwd, gh, git, watch }) => {
    const { values } = parseCommandArgs(args, { branch: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, base: { type: 'string' }, merge: { type: 'boolean' }, draft: { type: 'boolean' } }, 0)
    if (!values.title?.trim()) throw new UsageError('--title is required: one line naming what the change does')
    if (values.branch !== undefined && !values.branch.trim()) throw new UsageError('--branch names a branch')
    if (values.base !== undefined && !values.base.trim()) throw new UsageError('--base names a branch')
    const outcome = await openRequest(cwd, {
      ...(values.branch ? { branch: values.branch } : {}),
      title: values.title.trim(),
      ...(values.body !== undefined ? { body: values.body } : {}),
      ...(values.base ? { base: values.base.trim() } : {}),
      ...(values.merge ? { merge: true } : {}),
      ...(values.draft ? { draft: true } : {}),
      gh,
      git,
      watch,
    })
    if (!outcome.ok) throw new Refused(outcome, openRefusalLine(cwd, outcome))
    return outcome
  }),

  merge: asOpenAgent(async (args, { cwd, gh, watch }) => {
    const number = numberArg(parseCommandArgs(args, {}, 1).positionals[0]!)
    const outcome = await mergeRequest(cwd, number, { gh, watch })
    if (outcome.outcome === 'not-open') throw new Refused({ ok: false, reason: 'not-open', number, state: outcome.state }, `pull request ${number} is ${outcome.state.toLowerCase()}, not open`)
    if (outcome.outcome === 'failed') throw new Refused({ ok: false, reason: 'merge-failed', number, detail: outcome.error }, `pull request ${number} could not be landed: ${outcome.error}`)
    return { ok: true, number, outcome: outcome.outcome }
  }),

  watch: asOpenAgent(async (args, { cwd, gh, stderr }) => {
    const number = numberArg(parseCommandArgs(args, {}, 1).positionals[0]!)
    const outcome = await watchAndMerge(cwd, number, { gh, log: stderr })
    return { ok: outcome.outcome === 'merged', number, ...outcome }
  }),

  create: asOpenAgent(async (args, { cwd, gh, git }) => {
    const { values } = parseCommandArgs(args, { check: { type: 'boolean' } }, 0)
    const outcome = values.check ? await offerRepository(cwd, { gh, git }) : await createRepository(cwd, { gh, git })
    if (!outcome.ok) throw new Refused(outcome, createRefusalLine(outcome))
    return { ...outcome, name: GIT_HOST_NAME }
  }),

  async home(args, { cwd, git }) {
    parseCommandArgs(args, {}, 0)
    const url = await homeUrlFor(cwd, git)
    if (!url) throw new Refused({ ok: false, reason: 'no-remote' }, 'no origin remote on GitHub')
    return { ok: true, url, name: GIT_HOST_NAME }
  },

  async accounts(args, { cwd, gh, env, hasBrew, underWay, installing }) {
    const { values } = parseCommandArgs(args, { host: { type: 'string' } }, 0)
    if (values.host !== undefined && values.host.toLowerCase() !== HOST) throw new Refused({ ok: false, reason: 'not-mine', host: values.host }, `this package answers for ${HOST}, not ${values.host}`)
    const root = accountsRoot(env)
    await settleAdded(root, gh, cwd).catch(() => undefined)
    const state = await ghState(root, cwd, gh)
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
      // Each one's public picture, so a page shows whose it is with no login asked.
      accounts: accounts.map(a => ({ ...a, runs: a.login === runs, avatar: `https://github.com/${encodeURIComponent(a.login)}.png?size=64` })),
      ...(loggingIn ? { loggingIn } : {}),
      // The install a press started: going on, or why it failed while gh is still not here.
      ...(install?.running ? { installing: true } : !state.installed && install?.failed !== undefined ? { installFailed: install.failed } : {}),
    }
  },

  async use(args, { cwd, gh, env }) {
    const login = parseCommandArgs(args, {}, 1).positionals[0]!
    const accounts = await installedAccounts(accountsRoot(env), cwd, gh)
    try {
      useForRuns(login, accounts, picksPath(env))
    } catch (err) {
      throw new Refused({ ok: false, reason: 'no-account', login }, errorMessage(err))
    }
    return { ok: true, login }
  },

  async login(args, { cwd, gh, env, login }) {
    parseCommandArgs(args, {}, 0)
    const root = accountsRoot(env)
    const state = await ghState(root, cwd, gh)
    if (!state.installed) throw new Refused({ ok: false, reason: 'not-installed' }, 'gh is not on this computer: run github install first')
    try {
      return { ok: true, ...(await login(root)) }
    } catch (err) {
      const detail = errorMessage(err)
      throw new Refused({ ok: false, reason: 'login-failed', detail }, `gh could not start a login: ${detail}`)
    }
  },

  async 'stop-login'(args, { env, stopLogin }) {
    parseCommandArgs(args, {}, 0)
    stopLogin(accountsRoot(env))
    return { ok: true }
  },

  async install(args, { hasBrew, shell }) {
    parseCommandArgs(args, {}, 0)
    const command = installCommand(await hasBrew())
    if (command === undefined) throw new Refused({ ok: false, reason: 'no-build' }, `GitHub makes no gh for this computer (${process.platform} ${process.arch}): install it by hand, https://cli.github.com`)
    try {
      await shell(command)
    } catch (err) {
      const detail = errorMessage(err)
      throw new Refused({ ok: false, reason: 'install-failed', detail, command }, `gh's install could not be started: ${detail}`)
    }
    return { ok: true, started: true, command }
  },

  async env(args, { cwd, gh, env }) {
    const { values } = parseCommandArgs(args, { user: { type: 'string' } }, 0)
    // No account: a run never falls back on the person's own gh.
    const { login, dir } = await accountNamed(values.user, cwd, gh, env)
    return { ok: true, login, env: runEnv(await tokenOf(login, dir, cwd, gh), dir, readFacts(dir), env) }
  },

  async repos(args, { cwd, gh, env }) {
    const { values } = parseCommandArgs(args, { user: { type: 'string' }, owner: { type: 'string' } }, 0)
    if (values.owner !== undefined && !isGithubLogin(values.owner)) throw new Refused({ ok: false, reason: 'no-owner', owner: values.owner }, `${values.owner} is no GitHub user or organization`)
    const { login, dir } = await accountNamed(values.user, cwd, gh, env)
    const owner = values.owner ?? login
    return { ok: true, login, owner, repos: await listRepos(asAccount(gh, dir), cwd, owner) }
  },

  async 'git-config'(args, { cwd, gh, env }) {
    const { values } = parseCommandArgs(args, { user: { type: 'string' } }, 0)
    const { login, dir } = await accountNamed(values.user, cwd, gh, env)
    return { ok: true, login, host: HOST, config: gitConfig(dir) }
  },

  async token(args, { cwd, gh, env }) {
    const { values } = parseCommandArgs(args, { user: { type: 'string' } }, 0)
    const login = values.user
    if (login === undefined) throw new UsageError('token needs --user <login>')
    const root = accountsRoot(env)
    if (!(await installedAccounts(root, cwd, gh)).some(a => a.login === login)) throw new Refused({ ok: false, reason: 'no-account', login }, `OpenAgent has no GitHub account ${login} on this computer`)
    return { ok: true, login, token: await tokenOf(login, accountDir(root, login), cwd, gh) }
  },

  async take(args, { cwd, gh, env, stdin }) {
    parseCommandArgs(args, {}, 0)
    const token = (await stdin()).trim()
    if (!TOKEN.test(token)) throw new Refused({ ok: false, reason: 'no-token' }, 'what was handed over is no GitHub token')
    const facts = await factsOfToken(token, cwd, gh)
    try {
      await takeToken(accountsRoot(env), token, facts, gh, cwd)
    } catch (err) {
      const detail = errorMessage(err)
      throw new Refused({ ok: false, reason: 'login-failed', login: facts.login, detail }, `gh did not take ${facts.login}'s login: ${detail}`)
    }
    return { ok: true, login: facts.login }
  },

  async forget(args, { env }) {
    const login = parseCommandArgs(args, {}, 1).positionals[0]!
    try {
      // Only OpenAgent's copy goes: the token itself goes on working wherever else it is.
      forgetAccount(accountsRoot(env), login, picksPath(env))
    } catch (err) {
      throw new UsageError(errorMessage(err))
    }
    return { ok: true, login }
  },

  people: asOpenAgent(async (args, { cwd, gh }) => {
    const { positionals } = parseCommandArgs(args, {}, 1, MAX_PEOPLE)
    return peopleByEmail(cwd, positionals.filter(email => /^[^\s@]+@[^\s@]+$/.test(email)), gh)
  }),

  async profile(args, { fetch }) {
    const { positionals } = parseCommandArgs(args, {}, 1)
    const login = positionals[0]!
    if (!isGithubLogin(login)) throw new Refused({ ok: false, reason: 'no-user', detail: `${login} is no GitHub login` }, `${login} is no GitHub login`)
    const outcome = await publicProfile(login, fetch)
    if (!outcome.ok) throw new Refused(outcome, outcome.detail)
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
  if (!Number.isInteger(number) || number <= 0) throw new UsageError(`${arg} is not a pull request number`)
  return number
}
