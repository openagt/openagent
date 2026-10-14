import type { ModuleReadInput, ModuleServer, ModuleServerHost } from '@openagt/dashboard/module-server'
import { readFileStatuses, type FileGitStatus } from './status.js'
import { CONTEXT_LINES, WHOLE_FILE, readFileChanges, readFileDiff, type FileChange, type FileDiff } from './diff.js'
import { checkoutBranch, defaultBranchName, pendingChanges, readAgentChanges, readAgentCommitChanges, readAgentCommitFileDiff, readAgentCommits, readAgentFileDiff, resolveAgentWork, type AgentChanges, type AgentCommit, type FileMark } from './run.js'

// The Changes module's server part: the reads its browser part makes. A read about a run takes the
// run's id (`agentId`) and reads wherever the run's work is now (`run.ts`); a read without one is
// about the project's own folder.

function runId(input: ModuleReadInput): string | undefined {
  return typeof input.agentId === 'string' ? input.agentId : undefined
}

function pathOf(input: ModuleReadInput): string | undefined {
  return typeof input.path === 'string' ? input.path : undefined
}

function commitId(input: ModuleReadInput): string | undefined {
  return typeof input.commit === 'string' ? input.commit : undefined
}

/** A diff asked for with `whole: true` shows every line of the file, not three around each change. */
function contextOf(input: ModuleReadInput): number {
  return input.whole === true ? WHOLE_FILE : CONTEXT_LINES
}

/** What a run changed, and the branches it is between: the one it is measured from, and its own. */
export type RunChanges = AgentChanges & { from?: string; to?: string }

/** What is changed in the project's own folder and not committed. */
function project(host: ModuleServerHost): Promise<Record<string, FileMark>> {
  return pendingChanges(host.root)
}

/**
 * What a run changed, wherever its work is now, and between which branches: the one its record
 * says it started from, else the default branch; and the one its record names, else the one its
 * checkout has out.
 */
async function run(host: ModuleServerHost, input: ModuleReadInput): Promise<RunChanges> {
  const agentId = runId(input)
  if (agentId === undefined) return { source: 'gone' }
  try {
    const [facts, at] = await Promise.all([host.run(agentId).catch(() => undefined), resolveAgentWork(host, agentId)])
    const changes = await readAgentChanges(host.root, at)
    if (!('changes' in changes)) return changes
    const [from, to] = await Promise.all([
      facts?.record?.base ?? defaultBranchName(host.root),
      facts?.record?.branch ?? (at.source === 'checkout' ? checkoutBranch(at.path) : at.source === 'branch' ? at.branch : undefined),
    ])
    return { ...changes, ...(from ? { from } : {}), ...(to ? { to } : {}) }
  } catch {
    return { source: 'gone' }
  }
}

/**
 * One changed file's diff, from the same source its list was read from: a run's (in one of its
 * commits, when the read names one), or the project folder's uncommitted change. The status comes from the same git read the list does, never from
 * the caller: a page that thinks a file is untracked cannot make the read treat it as one.
 */
async function diff(host: ModuleServerHost, input: ModuleReadInput): Promise<FileDiff | null> {
  const path = pathOf(input)
  if (path === undefined) return null
  const agentId = runId(input)
  if (agentId !== undefined) {
    const at = await resolveAgentWork(host, agentId)
    const sha = commitId(input)
    return (sha !== undefined ? readAgentCommitFileDiff(host.root, at, sha, path, undefined, contextOf(input)) : readAgentFileDiff(host.root, at, path, undefined, contextOf(input))).catch(() => null)
  }
  const status: FileGitStatus | undefined = (await readFileStatuses(host.root))[path]
  return status ? readFileDiff(host.root, path, status, undefined, undefined, contextOf(input)).catch(() => null) : null
}

/**
 * What a working run has changed so far: every changed file in its own checkout, with line counts.
 * `[]` for a run with no checkout: its changes are then its branch's, which the handoff shows, and
 * the project folder's own changes are never passed off as the run's.
 */
async function counts(host: ModuleServerHost, input: ModuleReadInput): Promise<FileChange[]> {
  const agentId = runId(input)
  const checkout = agentId !== undefined ? (await host.run(agentId).catch(() => undefined))?.checkout : undefined
  if (!checkout) return []
  return readFileChanges(checkout, await readFileStatuses(checkout)).catch(() => [])
}

/** The commits of a run's work, newest first; none for a read naming no run. */
async function commits(host: ModuleServerHost, input: ModuleReadInput): Promise<AgentCommit[]> {
  const agentId = runId(input)
  if (agentId === undefined) return []
  return readAgentCommits(host.root, await resolveAgentWork(host, agentId)).catch(() => [])
}

/** What one commit of a run's work changed; null when the read names no run, or a commit that is not the run's. */
async function commit(host: ModuleServerHost, input: ModuleReadInput): Promise<Record<string, FileMark> | null> {
  const agentId = runId(input)
  const sha = commitId(input)
  if (agentId === undefined || sha === undefined) return null
  return readAgentCommitChanges(host.root, await resolveAgentWork(host, agentId), sha).catch(() => null)
}

const server: ModuleServer = { reads: { project, run, diff, counts, commits, commit } }
export default server
