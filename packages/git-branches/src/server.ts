import { DATA_BRANCH, errorMessage, nodeGitRunner, originDefaultBranch, type GitRunner } from '@openagt/agent-data'
import { START_FROM, isBranchName, type StartFrom } from '@openagt/hooks'
import { act, read, type RpcHost } from '@openagt/hooks/rpc'
import type { RunFound } from '@openagt/hooks'
import { isSafeAgentId } from './branch-names.js'
import { bringBranch } from './bring.js'
import { checkoutDir, reclaimAgent, refusalLine } from './agent-checkout.js'
import { bringRefusalLine, mergeRefusalLine, pushRefusalLine } from './cli.js'
import { readFolderBehind, updateFolder } from './folder-behind.js'
import { readHandoff, sessionCopies, workAt, type Handoff } from './handoff.js'
import { mergeBranch } from './merge.js'
import { branchesOnOrigin } from './origin-branches.js'
import { originGit } from './origin-git.js'
import { pushBranchByName } from './push.js'
import { currentBranch, worktreeSize } from './worktree.js'

// git-branches' server part (`@openagt/hooks/rpc`): what its places in the dashboard read and do.
// The bar above an ended run's message box reads what the run's branch holds (`handoff`) and
// offers its next steps: Commit (said to the run, which commits its own work), Publish branch,
// Merge on this machine, a copy's work brought back to its folder, uncommitted work discarded.
// The session's menu offers Remove worktree for a checkout the run kept. The row above the box
// says, and in the launcher picks, the branch a run starts from; and a project's folder behind its
// remote is brought up. Every talk with a remote goes as an account of OpenAgent's
// (`RpcHost.gitAccess`), never the person's own login.

export type { Handoff, HandoffCommit, HandoffFile } from './handoff.js'
export type { StartFrom } from '@openagt/hooks'

/** What a press answered: done, with what it did in a few words, or why not, in words for the person. */
export type Pressed = { ok: true; said?: string } | { ok: false; error: string }

/** Whether the page named a run: an id is a path segment in every read here, so nothing that climbs out of a folder is one. */
function isRunId(id: unknown): id is string {
  return typeof id === 'string' && isSafeAgentId(id)
}

/** Whether a run's record says it works: its card says `running` while its process does. */
function isWorking(status: string | undefined): boolean {
  return status === 'running' || status === 'working'
}

/** The ended run a press acts on, as its host finds it; why the press is refused otherwise: no run by that id, or one still writing its branch. */
async function endedRun(host: RpcHost, agentId: unknown): Promise<{ run: RunFound | undefined } | { refused: Pressed }> {
  if (!isRunId(agentId)) return { refused: { ok: false, error: 'Unknown session.' } }
  const run = await host.run(agentId)
  return isWorking(run?.record?.status) ? { refused: { ok: false, error: 'That session is still going; stop it first.' } } : { run }
}

/** What the bar says of a run's work, and of a copy's (`repo`, by its name in the session's folder): what its branch holds. */
export const handoff = read(async (host: RpcHost, { agentId, repo }: { agentId: string; repo?: string }): Promise<Handoff | null> => {
  if (!isRunId(agentId)) return null
  const at = await workAt(host.root, agentId, await host.run(agentId), repo)
  return (at && (await readHandoff(at).catch(() => undefined))) ?? null
})

/** The names of the session's copies of repos, in its folder: each has a row of its own in the panel above the box. */
export const copies = read(async (_host: RpcHost, { agentId }: { agentId: string }): Promise<string[]> => (isRunId(agentId) ? sessionCopies(agentId) : []))

/** What the Commit press says to the run: it commits its own work, in its own words. */
export const COMMIT_ASK = 'Commit your work.'

/**
 * Ask the run to commit what it left uncommitted: the agent commits, not the dashboard. It knows
 * what it changed and writes the message, and nothing is committed on its behalf.
 */
export const commit = act(async (host: RpcHost, { agentId }: { agentId: string }): Promise<Pressed> => {
  if (!isRunId(agentId)) return { ok: false, error: 'Unknown session.' }
  try {
    await host.say(agentId, { kind: 'message', text: COMMIT_ASK })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Could not ask the agent to commit: ${errorMessage(err)}` }
  }
})

/**
 * Publish the run's branch, or a copy's: pushed to origin under the clean rule (what is pushed is
 * what is committed), as an account of OpenAgent's. A branch only origin has is already there.
 */
export const push = act(async (host: RpcHost, { agentId, repo }: { agentId: string; repo?: string }): Promise<Pressed> => {
  const ended = await endedRun(host, agentId)
  if ('refused' in ended) return ended.refused
  const at = await workAt(host.root, agentId, ended.run, repo)
  if (at?.branch === undefined) return { ok: false, error: 'This session recorded no branch to push.' }
  const git = await originGit(at.cwd, host.gitAccess)
  if (!git) return { ok: false, error: 'OpenAgent has no account to push this branch as: add one in Permissions.' }
  const pushed = await pushBranchByName(at.cwd, at.branch, git)
  return pushed.ok ? { ok: true, said: 'Pushed.' } : { ok: false, error: `Could not push the branch: ${pushRefusalLine(at.branch, pushed)}` }
})

/**
 * Merge the run's branch into the project's default branch, on this machine: how the work reaches
 * the project's own folder where there is no remote to push to. The branch goes once its work is
 * in, and the run's record keeps its last commit and the commit its work began at, so what it
 * changed is still read.
 */
export const merge = act(async (host: RpcHost, { agentId }: { agentId: string }): Promise<Pressed> => {
  const ended = await endedRun(host, agentId)
  if ('refused' in ended) return ended.refused
  const branch = ended.run?.record?.branch
  if (branch === undefined) return { ok: false, error: 'This session recorded no branch to merge.' }
  const merged = await mergeBranch(host.root, branch)
  if (!merged.ok) return { ok: false, error: `Could not merge the branch: ${mergeRefusalLine(merged)}` }
  if (!merged.deleted) return { ok: true }
  try {
    await host.landed(agentId, { commit: merged.commit, from: merged.from })
    return { ok: true }
  } catch (err) {
    // The merge is in whatever the record says; a record that could not be written is said, since the page reads the record.
    return { ok: false, error: `Merged into ${merged.into}, but ${errorMessage(err)}` }
  }
})

/**
 * Bring a copy of a repo with no remote back to the folder it was copied from: its branch added
 * there, and with `merge` merged into that folder's default branch. The copy's own default branch
 * then holds the work, so its row reads it as merged.
 */
export const bring = act(async (host: RpcHost, { agentId, repo, merge: andMerge }: { agentId: string; repo: string; merge?: boolean }): Promise<Pressed> => {
  const ended = await endedRun(host, agentId)
  if ('refused' in ended) return ended.refused
  const at = await workAt(host.root, agentId, undefined, repo)
  if (at?.branch === undefined) return { ok: false, error: 'This copy is on no branch to bring.' }
  const brought = await bringBranch(at.cwd, at.branch, andMerge ? { merge: true } : {})
  return brought.ok ? { ok: true } : { ok: false, error: `${andMerge ? 'Could not merge the branch' : 'Could not add the branch'}: ${bringRefusalLine(brought)}` }
})

/**
 * Discard what the run's checkout, or a copy, left uncommitted: its changed files put back as the
 * branch has them, the new ones deleted. The branch and its commits stay. A person's call, asked
 * first: nothing of it can be brought back.
 */
export const discard = act(async (host: RpcHost, { agentId, repo }: { agentId: string; repo?: string }): Promise<Pressed> => {
  const ended = await endedRun(host, agentId)
  if ('refused' in ended) return ended.refused
  const checkout = repo === undefined ? await checkoutDir(host.root, agentId) : (await workAt(host.root, agentId, undefined, repo))?.cwd
  if (checkout === undefined) return { ok: false, error: 'This session has no checkout left to discard changes in.' }
  const git = nodeGitRunner()
  try {
    await git(['reset', '--quiet', '--hard', 'HEAD'], checkout)
    await git(['clean', '--quiet', '-fd'], checkout)
    return { ok: true, said: 'Discarded the uncommitted changes.' }
  } catch (err) {
    return { ok: false, error: `Could not discard the changes: ${errorMessage(err)}` }
  }
})

/** The checkout a finished run kept, for Remove worktree: whether there is one, and its size on disk. A working run's is in use, and offers none. */
export const checkout = read(async (host: RpcHost, { agentId }: { agentId: string }): Promise<{ kept: boolean; sizeBytes?: number }> => {
  const ended = await endedRun(host, agentId)
  if ('refused' in ended) return { kept: false }
  const dir = await checkoutDir(host.root, agentId)
  if (dir === undefined) return { kept: false }
  const sizeBytes = await worktreeSize(dir).catch(() => undefined)
  return { kept: true, ...(sizeBytes !== undefined ? { sizeBytes } : {}) }
})

/**
 * Remove the checkout a finished run kept (#752): only what is committed may go, by the rule the
 * run's own clean-up goes by; its branch stays on this machine, nothing pushed, and goes with it
 * only when it holds nothing of its own. Refused while the run works: Stop ends a run.
 */
export const removeCheckout = act(async (host: RpcHost, { agentId }: { agentId: string }): Promise<Pressed> => {
  const ended = await endedRun(host, agentId)
  if ('refused' in ended) return ended.refused
  const removed = await reclaimAgent(host.root, agentId, nodeGitRunner(), ended.run?.record?.baseCommit).catch((err: unknown) => ({ ok: false as const, reason: 'failed' as const, detail: errorMessage(err) }))
  if (removed.ok) return { ok: true, said: 'Removed the worktree.' }
  return { ok: false, error: `Could not remove the worktree: ${'detail' in removed ? removed.detail : refusalLine(agentId, removed)}` }
})

/** Where the project's runs can start from: its main branch, the branch its folder is on, and the pick every next run starts from. */
export interface StartPlaces {
  /** Origin's default branch, by its short name. */
  main: string
  /** The branch the project's folder is on. */
  local: string
  /** The pick every next run starts from; none for the main branch. */
  pick?: StartFrom
}

/**
 * Where the project's runs can start from, read locally, never fetched; `null` where there is no
 * pick to make: a project with no remote, or a folder on no branch, starts where it is.
 */
export const startPlaces = read(async (host: RpcHost, _input: object): Promise<StartPlaces | null> => {
  const project = await host.project()
  if (!project) return null
  const [main, local, picks] = await Promise.all([originDefaultBranch(host.root), currentBranch(host.root), host.settings.get(START_FROM)])
  if (main === undefined || local === undefined) return null
  const pick = picks[project.id]
  return { main: main.slice('origin/'.length), local, ...(pick ? { pick } : {}) }
})

/**
 * The branches a run can start from besides the main branch and the folder's, read live from
 * origin each time the menu opens: all of origin's but its main branch, which the menu lists
 * first, and the branch that holds the runs' records, which is no code to start from. `branches`
 * is absent where origin could not be read.
 */
export const startBranches = read(async (host: RpcHost, _input: object): Promise<{ branches?: string[] }> => {
  const git = await originGit(host.root, host.gitAccess)
  const [listed, main] = await Promise.all([git ? branchesOnOrigin(host.root, git) : undefined, originDefaultBranch(host.root)])
  if (!listed) return {}
  return { branches: listed.filter(branch => branch !== DATA_BRANCH && `origin/${branch}` !== main) }
})

/** Pick where every next run of the project started on this computer starts from; none: the main branch. */
export const pickStart = act(async (host: RpcHost, { pick }: { pick?: StartFrom }): Promise<Pressed> => {
  const project = await host.project()
  if (!project) return { ok: false, error: 'A session with no project starts from no branch.' }
  if (pick !== undefined && !(pick.kind === 'local' || (pick.kind === 'published' && isBranchName(pick.branch)))) return { ok: false, error: 'That is no branch to start from.' }
  const { [project.id]: _was, ...others } = await host.settings.get(START_FROM)
  await host.settings.set(START_FROM, pick ? { ...others, [project.id]: pick.kind === 'local' ? { kind: 'local' } : { kind: 'published', branch: pick.branch } } : others)
  return { ok: true }
})

/**
 * Where a session started and works, as its record can vouch for it: `from`, the branch it was
 * told, by name, or origin's default branch, by the name it has in the project's clone, for a run
 * that made its own branch and was told none; nothing for a run given a branch that exists, which
 * began on another run's work, or one from before these were written down. `on`, the branch it
 * works on now, which its agent renames.
 */
export const startedFrom = read(async (host: RpcHost, { agentId }: { agentId: string }): Promise<{ from?: string; on?: string }> => {
  if (!isRunId(agentId)) return {}
  const record = (await host.run(agentId))?.record
  const on = record?.branch !== undefined ? { on: record.branch } : {}
  if (record?.base !== undefined) return { from: record.base.replace(/^(refs\/remotes\/)?origin\//, ''), ...on }
  if (record?.baseCommit === undefined) return on
  const main = (await originDefaultBranch(host.root).catch(() => undefined))?.slice('origin/'.length)
  return { ...(main !== undefined ? { from: main } : {}), ...on }
})

/** Bring the project's folder up to its remote's main branch: a fast-forward, or git's refusal in its words. */
export const updateProjectFolder = act(async (host: RpcHost, _input: object): Promise<Pressed> => {
  const updated = await updateFolder(host.root)
  return updated.ok ? { ok: true, said: 'The folder is up to date.' } : { ok: false, error: `The folder could not be updated. git said: ${updated.error}` }
})

/** How far the project's folder is behind its remote's main branch, fetched first as an account of OpenAgent's; nothing when it is not. */
export async function folderBehindOf(dir: string, reach: RpcHost['gitAccess'] | undefined, git: GitRunner = nodeGitRunner()) {
  return readFolderBehind(dir, { git, origin: await originGit(dir, reach, git) })
}
