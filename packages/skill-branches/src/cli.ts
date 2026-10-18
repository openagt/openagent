import { parseArgs } from 'node:util'
import { basename, resolve } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { nodeGitRunner, checkoutRoot, gitReason, type GitRunner } from '@openagt/agent-data'
import { agentBranchName, agentIdFromWorktreeDir, isSafeAgentId, sessionNameOf } from './branch-names.js'
import {
  branchPushed,
  currentBranch,
  isWorktreeRoot,
  nameBranch,
  projectRoot,
  type NameBranchRefusal,
  worktreeBranch,
  worktreeClean,
  worktreeDirEntries,
  worktreePath,
  worktreeSize,
} from './worktree.js'
import { createCheckout, attachCheckout } from './checkout.js'
import { reconcileBranchLinks } from './branch-links.js'
import { discardWorktree, reclaimWorktree, type ReclaimOutcome, type ReclaimRefusal } from './reclaim.js'
import { pushBranchByName, pushCheckout, type PushOutcome } from './push.js'
import { mergeBranch, type MergeOutcome } from './merge.js'
import { readBranchStates } from './branch-state.js'
import { readBranchesAhead } from './branch-ahead.js'
import { cleanup } from './cleanup.js'

/**
 * The command line over the package (#1725): the same functions a caller's code calls, for an agent
 * (and a person) in a shell. One implementation, every surface a caller.
 *
 * The contract: JSON on stdout, one line for a person on stderr, and the exit code says how it
 * went — 0 for a result, 1 for a refusal or a git failure, 2 for a command that could not be
 * read. A refusal is a rule saying no (a dirty tree, a name that is not a session name); it is
 * reported on stdout as `{ ok: false, reason }` so a caller parsing the output learns why, and
 * on stderr so a person does.
 *
 * Where the project is comes from the working directory: for every command that acts on the
 * project (`create`, `attach`, `show`, `ahead`, `list`, `remove`, `prune`, and `push --branch`) it is
 * the checkout whose `.branches/` the working directory is under, else the checkout itself — so
 * the same command works from inside an agent's checkout; the commands that act on one checkout
 * (`name`, `status`, a bare `push`) act on the one the working directory is in.
 *
 * Git only (#1820): what the project's git host does with a pushed branch, the pull request and its
 * merge, is the git host package's own command; this one never names it.
 */

export const USAGE = `usage: branches <command>

  create <id> [--base <ref>]   a checkout for agent <id>, on a fresh branch agent-<id>
  attach <id> <branch> [--base <ref>]
                               a checkout for agent <id>, on an existing branch; one that is gone starts again from <ref>
  name <name>                  rename this checkout's branch to agent-<name>; prints the name it got
  status [path]                the checkout's branch, whether it is clean, whether it is on the remote
  show [--from <commit>] <branch>...
                               what each branch holds and where it stands: its commits and files beyond the base, whether it is pushed, merged, and what its checkout left uncommitted;
                               measured from <commit>, the one the branches started from, in place of the default branch; a full commit id in place of a branch is read as a branch that ends there
  ahead [--from <commit>] <branch>...
                               how many commits of its own each branch has beyond the base, whether it is pushed or was and is gone from origin, whether it is merged, how many paths its checkout left uncommitted: no file lists, every branch in one read
  push [--branch <b>]          push this checkout's branch, or branch <b>, to origin; a dirty checkout is refused
  merge <branch>               merge branch <branch> into the default branch, in the project's folder, then delete it; a conflict changes nothing and names the files
  list [--sizes]               every agent checkout under .branches/
  remove <id> [--from <commit>] reclaim agent <id>'s checkout, once its branch holds everything in it; the branch stays, nothing is pushed;
                               <commit> is the one its branch started from, in place of the default branch
         [--discard]           ... or drop it whatever it holds, uncommitted work included; the branch stays
  prune                        remove, for every checkout
  cleanup                      remove what this tool left in the project: prune, then .branches/ and the rules hiding this tool's files from git once no checkout is left;
                               a checkout with uncommitted work stays, and every branch with work on it; the command a dashboard asks for when a project is removed with its files

JSON on stdout. Exit code 1 for a refusal or a git failure (the reason on stderr), 2 for a usage error.`

/** The streams and the working directory a run of the CLI sees. */
export interface CliIo {
  cwd: string
  stdout: (line: string) => void
  stderr: (line: string) => void
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
export async function runCli(argv: string[], io: CliIo, git: GitRunner = nodeGitRunner()): Promise<number> {
  const [command, ...rest] = argv
  const run = command && Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined
  if (!run) {
    io.stderr(USAGE)
    return 2
  }
  try {
    io.stdout(JSON.stringify(await run(rest, io.cwd, git)))
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
    const detail = gitReason(err)
    io.stdout(JSON.stringify({ ok: false, reason: 'git-failed', detail }))
    io.stderr(detail)
    return 1
  }
}

type Command = (args: string[], cwd: string, git: GitRunner) => Promise<unknown>

const COMMANDS: Record<string, Command> = {
  async create(args, cwd, git) {
    const { positionals, values } = parse(args, { base: { type: 'string' } }, 1)
    const agentId = agentIdArg(positionals[0]!)
    const repo = await project(cwd, git)
    return { ok: true, ...(await createCheckout(repo, { agentId, ...(values.base ? { base: values.base } : {}) }, git)) }
  },

  async attach(args, cwd, git) {
    const { positionals, values } = parse(args, { base: { type: 'string' } }, 2)
    const [agentId, branch] = [agentIdArg(positionals[0]!), positionals[1]!]
    const repo = await project(cwd, git)
    return { ok: true, ...(await attachCheckout(repo, { agentId, branch, ...(values.base ? { base: values.base } : {}) }, git)) }
  },

  async name(args, cwd, git) {
    const { positionals } = parse(args, {}, 1)
    const name = positionals[0]!
    const checkout = await inRepo(() => checkoutRoot(cwd, git))
    const outcome = await nameBranch(checkout, name, git)
    if (!outcome.ok) throw new Refused(outcome, NAME_REFUSALS[outcome.reason](name, checkout))
    // The `.branches/<name>` link follows the rename now, not at the next reconcile.
    await reconcileBranchLinks(await projectRoot(checkout, git), { git })
    return outcome
  },

  async status(args, cwd, git) {
    const { positionals } = parse(args, {}, 0, 1)
    const path = positionals[0] ? resolve(cwd, positionals[0]) : await inRepo(() => checkoutRoot(cwd, git))
    if (!(await isWorktreeRoot(path, git))) throw new Refused({ ok: false, reason: 'not-a-worktree', path }, `${path} is not a git worktree`)
    const branch = await currentBranch(path, git)
    const clean = await worktreeClean(path, git)
    const onRemote = branch ? await branchPushed(await projectRoot(path, git), branch, git) : false
    return { ok: true, path, ...(branch ? { branch } : {}), clean, onRemote }
  },

  async show(args, cwd, git) {
    const { values, positionals } = parse(args, { from: { type: 'string' } }, 1, Infinity)
    if (values.from !== undefined && !values.from.trim()) throw new Usage('--from names a commit')
    const repo = await project(cwd, git)
    return readBranchStates(repo, positionals, git, values.from)
  },

  async ahead(args, cwd, git) {
    const { values, positionals } = parse(args, { from: { type: 'string' } }, 1, Infinity)
    if (values.from !== undefined && !values.from.trim()) throw new Usage('--from names a commit')
    const repo = await project(cwd, git)
    return readBranchesAhead(repo, positionals, git, values.from)
  },

  async push(args, cwd, git) {
    const { values } = parse(args, { branch: { type: 'string' } }, 0)
    if (values.branch !== undefined) {
      if (!values.branch.trim()) throw new Usage('--branch names a branch')
      const outcome = await pushBranchByName(await project(cwd, git), values.branch, git)
      if (!outcome.ok) throw new Refused(outcome, pushRefusalLine(values.branch, outcome))
      return outcome
    }
    const checkout = await inRepo(() => checkoutRoot(cwd, git))
    const outcome = await pushCheckout(checkout, git)
    if (!outcome.ok) throw new Refused(outcome, pushRefusalLine(checkout, outcome))
    return outcome
  },

  async merge(args, cwd, git) {
    const { positionals } = parse(args, {}, 1)
    const repo = await project(cwd, git)
    const outcome = await mergeBranch(repo, positionals[0]!, git)
    if (!outcome.ok) throw new Refused(outcome, mergeRefusalLine(outcome))
    // A link named after a branch that just went is stale from this moment.
    if (outcome.deleted) await reconcileBranchLinks(repo, { git })
    return outcome
  },

  async list(args, cwd, git) {
    const { values } = parse(args, { sizes: { type: 'boolean' } }, 0)
    const repo = await project(cwd, git)
    const rows = []
    for (const entry of await worktreeDirEntries(repo)) {
      const branch = await worktreeBranch(entry.path, git)
      const sizeBytes = values.sizes ? await worktreeSize(entry.path) : undefined
      const name = sessionNameOf(branch, entry.agentId)
      rows.push({ ...entry, ...(branch ? { branch } : {}), ...(name ? { name } : {}), ...(sizeBytes === undefined ? {} : { sizeBytes }) })
    }
    return rows
  },

  async remove(args, cwd, git) {
    const { positionals, values } = parse(args, { discard: { type: 'boolean' }, from: { type: 'string' } }, 1)
    if (values.from !== undefined && !values.from.trim()) throw new Usage('--from names a commit')
    const agentId = agentIdArg(positionals[0]!)
    const repo = await project(cwd, git)
    const outcome = values.discard ? await discard(repo, agentId, git) : await reclaim(repo, agentId, git, values.from)
    if (!outcome.ok) throw new Refused(outcome, refusalLine(agentId, outcome))
    // A link named after a branch that just went with its checkout is stale from this moment.
    await reconcileBranchLinks(repo, { git })
    return outcome
  },

  async prune(args, cwd, git) {
    parse(args, {}, 0)
    const repo = await project(cwd, git)
    const removed: string[] = []
    const skipped: { agentId: string; reason: string; detail: string }[] = []
    for (const { agentId } of await worktreeDirEntries(repo)) {
      const outcome = await reclaim(repo, agentId, git)
      if (outcome.ok) removed.push(agentId)
      else skipped.push({ agentId, reason: outcome.reason, detail: refusalLine(agentId, outcome) })
    }
    // Once for the whole pass: a reconcile reads every checkout that is left.
    if (removed.length) await reconcileBranchLinks(repo, { git })
    return { ok: true, removed, skipped }
  },

  async cleanup(args, cwd, git) {
    parse(args, {}, 0)
    const repo = await project(cwd, git)
    return cleanup(repo, agentId => reclaim(repo, agentId, git).then(outcome => (outcome.ok ? undefined : refusalLine(agentId, outcome))), git)
  },
}

/** A refusal `remove` and `prune` can add to the reclaim rule's own: there is no such checkout. */
type RemoveRefusal = { ok: false; reason: 'no-checkout'; agentId: string }

/**
 * One agent's checkout under the reclaim rule; a missing checkout is its own refusal. The
 * argument may be the session name a rename link carries rather than the id, so the birth
 * branch is read off the checkout's own directory, never off the argument (#1757): a link's
 * name is the branch the agent chose, and that one is not the birth branch.
 */
async function reclaim(repo: string, agentId: string, git: GitRunner, from?: string): Promise<ReclaimOutcome | RemoveRefusal> {
  const path = worktreePath(repo, agentId)
  if (!(await stat(path).then(s => s.isDirectory(), () => false))) return { ok: false, reason: 'no-checkout', agentId }
  const checkout = await realpath(path)
  return reclaimWorktree(repo, checkout, { birthBranch: agentBranchName(agentIdFromWorktreeDir(basename(checkout))), ...(from !== undefined ? { from } : {}), git })
}

/** One agent's checkout dropped whatever it holds; a missing checkout is its own refusal. */
async function discard(repo: string, agentId: string, git: GitRunner): Promise<ReclaimOutcome | RemoveRefusal> {
  const path = worktreePath(repo, agentId)
  if (!(await stat(path).then(s => s.isDirectory(), () => false))) return { ok: false, reason: 'no-checkout', agentId }
  return discardWorktree(repo, await realpath(path), { git })
}

/** Why a checkout stayed, as one line for a person. */
function refusalLine(agentId: string, outcome: (ReclaimOutcome & { ok: false }) | RemoveRefusal): string {
  const reason: ReclaimRefusal | 'no-checkout' = outcome.reason
  switch (reason) {
    case 'no-checkout':
      return `no checkout for agent ${agentId}`
    case 'not-a-worktree':
      return `agent ${agentId}'s directory is not a git worktree; left alone`
    case 'no-branch':
      return `agent ${agentId}'s checkout is on no branch; kept`
    case 'dirty':
      return `${branchOf(outcome)} has uncommitted work; the checkout was kept`
  }
}

const branchOf = (outcome: object): string => String((outcome as { branch?: string }).branch)

/** Why a branch was not pushed, as one line for a person. */
function mergeRefusalLine(outcome: MergeOutcome & { ok: false }): string {
  switch (outcome.reason) {
    case 'no-branch':
      return `no branch ${outcome.branch} on this machine`
    case 'no-default-branch':
      return 'the project has no main branch to merge into'
    case 'not-on-default':
      return `the project's folder is on ${outcome.current ?? 'no branch'}, not on ${outcome.into}; switch it to ${outcome.into}, then merge`
    case 'dirty':
      return `${outcome.branch} has uncommitted work; commit or delete it, then merge`
    case 'conflict':
      return `${outcome.branch} does not merge cleanly into ${outcome.into}: it conflicts in ${outcome.files.join(', ')}; nothing was changed`
    case 'merge-failed':
      return `${outcome.branch} could not be merged into ${outcome.into}: ${outcome.detail}`
  }
}

function pushRefusalLine(subject: string, outcome: PushOutcome & { ok: false }): string {
  switch (outcome.reason) {
    case 'not-a-worktree':
      return `${subject} is not a git worktree`
    case 'no-branch':
      return outcome.branch !== undefined ? `no branch ${outcome.branch}, here or on origin` : `${subject} is on no branch`
    case 'dirty':
      return `${outcome.branch} has uncommitted work; commit or delete it, then push`
    case 'push-failed':
      return `${outcome.branch} could not be pushed: ${outcome.detail ?? 'the push did not land'}`
  }
}

const NAME_REFUSALS: Record<NameBranchRefusal, (name: string, checkout: string) => string> = {
  'invalid-name': name => `${name} is not a session name: use [a-z0-9-]+`,
  'not-a-worktree': (_, checkout) => `${checkout} is not a git worktree`,
  'no-branch': (_, checkout) => `${checkout} is on no branch`,
  'not-an-agent-branch': (_, checkout) => `${checkout} is not on an agent branch; only agent-* branches are renamed`,
}

/** An agent id is path-safe, or the command has nothing to name a checkout with. */
function agentIdArg(agentId: string): string {
  if (!isSafeAgentId(agentId)) throw new Refused({ ok: false, reason: 'invalid-id', agentId }, `${agentId} is not an agent id`)
  return agentId
}

/** The project the working directory belongs to. */
async function project(cwd: string, git: GitRunner): Promise<string> {
  return inRepo(() => projectRoot(cwd, git))
}

/**
 * Outside a repo, the commands have nothing to act on: said as a refusal, not a git failure.
 * Only git's own "not a git repository" reads as that; a timeout, a missing git, or a corrupt
 * repo stays the failure it is.
 */
async function inRepo<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (err) {
    if (!/not a git repository/i.test(err instanceof Error ? err.message : String(err))) throw err
    throw new Refused({ ok: false, reason: 'not-a-repo' }, 'not inside a git repository')
  }
}

type Options = Record<string, { type: 'string' | 'boolean' }>

/** `parseArgs` with the positional count checked: too few or too many is a usage error. */
function parse<O extends Options>(args: string[], options: O, min: number, max: number = min) {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: true, strict: true })
    if (parsed.positionals.length < min || parsed.positionals.length > max) throw new Usage(`expected ${max === min ? min : max === Infinity ? `at least ${min}` : `${min} to ${max}`} argument(s), got ${parsed.positionals.length}`)
    return parsed
  } catch (err) {
    throw err instanceof Usage ? err : new Usage(err instanceof Error ? err.message : String(err))
  }
}
