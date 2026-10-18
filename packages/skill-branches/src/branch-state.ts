import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { basename } from 'node:path'
import { agentIdFromWorktreeDir, sessionNameOf } from './branch-names.js'
import { repoHasRemote, worktreeBranch, worktreeDirEntries } from './worktree.js'

/**
 * What a branch holds and where it stands (#1774): the caller's read of a finished agent's
 * work, for the run page's handoff and the "never pushed" queue. Git facts only, read from the
 * project's repository, so the answer is the same whether or not the agent's checkout still
 * exists: the commits the branch has beyond the project's default branch, the files they
 * changed, whether the remote has the tip, whether the default branch already contains it, and
 * the uncommitted paths of the checkout that is on the branch, when one is. The pull request is
 * the caller's own question, asked of the git host, never here.
 *
 * A caller that knows the commit a branch was made at names it (`from`), and the commits and the
 * files are measured so that they are the branch's own ({@link measuredFrom}): from that commit
 * for a branch made from another branch, which holds, beyond the default branch, that branch's
 * work as well as its own, and for a branch the default branch already contains, which holds
 * nothing beyond it and still did its work. A full commit id asked in place of a branch is read as
 * a branch whose tip it is: what a branch held, for a caller that kept its last commit after the
 * branch went.
 *
 * Forgiving throughout: a branch that is gone answers `exists: false` with empty lists, a
 * project without a remote answers `hasRemote: false`, and a git read that fails reads as empty.
 */

/** One commit a branch holds beyond the base. */
export interface BranchCommit {
  sha: string
  subject: string
}

/** One file a branch changed against the base. */
export interface BranchFile {
  path: string
  insertions: number
  deletions: number
  /** A binary file, where line counts mean nothing. */
  binary: boolean
}

export interface BranchState {
  branch: string
  /** The name the agent gave its work: the branch minus this package's prefix. Absent for a branch the package did not mint, and for a checkout still on the branch it was created on. */
  name?: string
  /** The branch exists in the repository. Gone: every list below is empty. */
  exists: boolean
  /** What it is measured against: the commit the caller named or the default branch (the remote's, else a local `main` or `master`), whichever tells the branch's own work. Absent when none was found. */
  base?: string
  /** The branch's own commits beyond the base, newest first. */
  commits: BranchCommit[]
  /** What it changed since it left the base. */
  files: BranchFile[]
  /** The repository has a remote. */
  hasRemote: boolean
  /** `origin` has the branch at this same tip. */
  pushed: boolean
  /** The base already contains the branch. */
  merged: boolean
  /** The uncommitted paths of the checkout under `.branches/` that is on this branch; absent when no checkout is. */
  pendingFiles?: string[]
}

/** A subject can hold anything, so the fields are unit-separated rather than space-split. */
const SEP = String.fromCharCode(31)

/**
 * The state of each branch named, in that order. One read of the checkouts serves them all.
 * `from` is the commit they were made at, when the caller knows it; one this machine does not
 * have is no base, and the default branch is.
 */
export async function readBranchStates(repo: string, branches: readonly string[], git: GitRunner = nodeGitRunner(), from?: string): Promise<BranchState[]> {
  const ask = soft(git, repo)
  const [hasRemote, base, checkouts, start] = await Promise.all([repoHasRemote(repo, git), detectBase(ask), checkoutsByBranch(repo, git), from !== undefined ? commitOf(ask, from) : undefined])
  const states: BranchState[] = []
  for (const branch of branches) states.push(await readOne(repo, branch, { git, ask, hasRemote, base, from: start, checkouts }))
  return states
}

interface Reads {
  git: GitRunner
  ask: (args: string[]) => Promise<string>
  hasRemote: boolean
  /** The project's default branch. */
  base: string | undefined
  /** The commit the caller says the branches started from, when this machine has it. */
  from: string | undefined
  checkouts: Map<string, string>
}

/** A full commit id: what a caller asks in place of a branch that is gone. */
const COMMIT_ID = /^[0-9a-f]{40}$/

/** The commit `rev` names, when this machine has it. */
export async function commitOf(ask: (args: string[]) => Promise<string>, rev: string): Promise<string | undefined> {
  return (await ask(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])).trim() || undefined
}

async function readOne(repo: string, branch: string, reads: Reads): Promise<BranchState> {
  const { ask, hasRemote, base } = reads
  const tip = (await commitOf(ask, `refs/heads/${branch}`)) ?? (COMMIT_ID.test(branch) ? await commitOf(ask, branch) : undefined)
  // Whether it is merged is always the default branch's answer; what its own commits and files
  // are measured from is decided below, once the tip is known.
  const checkout = reads.checkouts.get(branch)
  const pending = checkout ? await pendingFiles(reads.git, checkout) : {}
  const name = sessionNameOf(branch, checkout ? agentIdFromWorktreeDir(basename(checkout)) : undefined)
  const named = name ? { name } : {}
  if (!tip) return { branch, ...named, exists: false, commits: [], files: [], hasRemote, pushed: false, merged: false, ...pending }
  const from = await measuredFrom(ask, tip, reads.from, base)
  // `base..branch` is the branch's own commits; `base...branch` is the change since it left the
  // base, whatever the base did since. Each spelling answers its own question.
  const [commitsOut, numstatOut, remoteTip, mergedOut] = await Promise.all([
    from ? ask(['log', '--format=%H%x1f%s', `${from}..${tip}`]) : Promise.resolve(''),
    from ? ask(['diff', '--numstat', `${from}...${tip}`]) : Promise.resolve(''),
    hasRemote ? ask(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]) : Promise.resolve(''),
    base ? ask(['branch', '--list', '--merged', base, branch]) : Promise.resolve(''),
  ])
  return {
    branch,
    ...named,
    exists: true,
    ...(from ? { base: from } : {}),
    commits: parseCommits(commitsOut),
    files: parseNumstat(numstatOut),
    hasRemote,
    pushed: remoteTip.trim() === tip,
    merged: mergedOut.trim().length > 0,
    ...pending,
  }
}

/**
 * What a branch's own commits and files are measured from. With no commit named, the default
 * branch. With one, the default branch still, while the branch left it at or after that commit
 * and is not in it yet: what the branch took in from the default branch since, by a merge or a
 * rebase, is then not counted as its own. The named commit otherwise: for a branch the default
 * branch already contains, where nothing would be left to count, and for a branch that left the
 * default branch before that commit, which is one made from another branch.
 */
async function measuredFrom(ask: (args: string[]) => Promise<string>, tip: string, from: string | undefined, base: string | undefined): Promise<string | undefined> {
  if (!from || !base) return from ?? base
  const forkBase = (await ask(['merge-base', base, tip])).trim()
  if (!forkBase || forkBase === tip) return from
  const forkFrom = (await ask(['merge-base', from, tip])).trim()
  return forkFrom && (await ask(['merge-base', forkFrom, forkBase])).trim() === forkFrom ? base : from
}

/** `git` that resolves to '' instead of rejecting, for reads where "no answer" is a fine answer. */
function soft(git: GitRunner, cwd: string): (args: string[]) => Promise<string> {
  return args => git(args, cwd).catch(() => '')
}

/** The project's default branch: what the remote points HEAD at, else the first local conventional one. */
export async function detectBase(ask: (args: string[]) => Promise<string>): Promise<string | undefined> {
  const head = (await ask(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
  if (head) return head
  for (const name of ['main', 'master']) {
    if ((await ask(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).trim()) return name
  }
  return undefined
}

/** Each checkout under `.branches/` that git knows, by the branch it is on. */
async function checkoutsByBranch(repo: string, git: GitRunner): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const entry of await worktreeDirEntries(repo)) {
    const branch = await worktreeBranch(entry.path, git)
    if (branch && !map.has(branch)) map.set(branch, entry.path)
  }
  return map
}

/** The uncommitted paths of a checkout, as a spreadable field; absent when git could not answer. */
async function pendingFiles(git: GitRunner, checkout: string): Promise<{ pendingFiles?: string[] }> {
  const status = await git(['status', '--porcelain'], checkout).catch(() => undefined)
  return status === undefined ? {} : { pendingFiles: parsePorcelain(status) }
}

/** Parse `git log --format=%H%x1f%s`. */
export function parseCommits(out: string): BranchCommit[] {
  return out
    .split('\n')
    .filter(line => line.includes(SEP))
    .map(line => {
      const [sha = '', subject = ''] = line.split(SEP)
      return { sha, subject }
    })
}

/** Parse `git diff --numstat`: `<added>\t<removed>\t<path>`, `-` for a binary file. */
export function parseNumstat(out: string): BranchFile[] {
  const files: BranchFile[] = []
  for (const line of out.split('\n')) {
    const [added, removed, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (!path || added === undefined || removed === undefined) continue
    const binary = added === '-' || removed === '-'
    files.push({ path, insertions: binary ? 0 : Number(added) || 0, deletions: binary ? 0 : Number(removed) || 0, binary })
  }
  return files
}

/** The paths of `git status --porcelain`: a rename reads as its new path, a quoted path unquoted. */
export function parsePorcelain(out: string): string[] {
  const paths: string[] = []
  for (const line of out.split('\n')) {
    if (line.length < 4) continue
    let path = line.slice(3)
    const arrow = path.indexOf(' -> ')
    if (arrow !== -1) path = path.slice(arrow + 4)
    if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
    if (path) paths.push(path)
  }
  return paths
}
