import { errorMessage, nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { DATA_BRANCH } from '@openagt/agent-data/names'
import { AGENT_BRANCH_PREFIX, isAgentBranch } from './branch-names.js'
import { currentBranch, isWorktreeRoot } from './worktree.js'

/**
 * Naming the session (#1725): the agent renames its checkout's branch to `agent-<name>`, saying
 * what the work is. A rename, not a new branch, so the branch the checkout was born on is the
 * branch it ends on and nothing is left behind to clean up.
 */

/** A session name as the agent picks it: the charset the skill asks for. */
export function isSessionName(name: string): boolean {
  return /^[a-z0-9-]+$/.test(name)
}

/** Why {@link nameBranch} left the branch as it was. */
export type NameBranchRefusal =
  /** Not `[a-z0-9-]+`. */
  | 'invalid-name'
  /** The directory is not a git worktree root: nothing was run in it. */
  | 'not-a-worktree'
  /** The checkout is on no branch (detached). */
  | 'no-branch'
  /** The checkout is on a branch the package did not mint — the user's own. */
  | 'not-an-agent-branch'

export type NameBranchOutcome =
  | {
      ok: true
      /** The name the branch ends up with: `agent-<name>`, suffixed when that was taken. */
      branch: string
    }
  | { ok: false; reason: NameBranchRefusal }

/** How often a rename lost to a sibling naming the same thing at the same moment is retried. */
const NAME_ATTEMPTS = 3

/**
 * Rename the checkout's branch to `agent-<name>`. Only a branch the package minted is ever
 * renamed: an agent that somehow runs in the user's own checkout must not rename `main`.
 *
 * A taken name gets a numeric suffix (`agent-<name>-2`, `-3`, …) rather than a refusal: the agent
 * asked for a name, and the caller reads back the one it got. Taken means any local branch or
 * any remote-tracking branch, so the later push does not land on someone else's branch — except
 * the checkout's own branch, pushed or not, which is why asking again for the name the checkout
 * already carries (suffixed or not) changes nothing. Two checkouts naming the same thing at the
 * same moment race on the rename itself; the loser reads the branches again and takes the next
 * free suffix.
 */
export async function nameBranch(path: string, name: string, git: GitRunner = nodeGitRunner()): Promise<NameBranchOutcome> {
  if (!isSessionName(name)) return { ok: false, reason: 'invalid-name' }
  const wanted = `${AGENT_BRANCH_PREFIX}${name}`
  if (!(await isWorktreeRoot(path, git))) return { ok: false, reason: 'not-a-worktree' }
  const current = await currentBranch(path, git)
  if (!current) return { ok: false, reason: 'no-branch' }
  if (!isAgentBranch(current)) return { ok: false, reason: 'not-an-agent-branch' }
  for (let attempt = 1; ; attempt++) {
    const taken = await branchNames(path, git)
    taken.delete(current)
    // The data branch is nobody's session, whether or not this repo has it yet: `name data` gets `-2`.
    taken.add(DATA_BRANCH)
    let branch = wanted
    for (let n = 2; taken.has(branch); n++) branch = `${wanted}-${n}`
    if (branch === current) return { ok: true, branch }
    try {
      await git(['branch', '-m', current, branch], path)
      return { ok: true, branch }
    } catch (err) {
      if (attempt >= NAME_ATTEMPTS || !/already exists/.test(errorMessage(err))) throw err
    }
  }
}

/** Every branch name the repo knows, local and remote-tracking, without the remote's prefix. */
async function branchNames(path: string, git: GitRunner): Promise<Set<string>> {
  const out = await git(['for-each-ref', '--format=%(refname)', 'refs/heads/', 'refs/remotes/'], path)
  const names = new Set<string>()
  for (const ref of out.split('\n')) {
    const heads = ref.match(/^refs\/heads\/(.+)$/)
    if (heads?.[1]) names.add(heads[1])
    const remotes = ref.match(/^refs\/remotes\/[^/]+\/(.+)$/)
    if (remotes?.[1]) names.add(remotes[1])
  }
  return names
}
