import { sessionCopies } from '@openagt/git-branches'
import { read, type RpcHost } from '@openagt/hooks/rpc'
import { readFileStatuses, type FileGitStatus } from './status.js'
import { CONTEXT_LINES } from './confined.js'
import { WHOLE_FILE, readFileChanges, readFileDiff, type FileChange, type FileDiff } from './diff.js'
import { checkoutBranch, defaultBranchName, pendingChanges, readAgentChanges, resolveCopyWork, readAgentCommitChanges, readAgentCommitFileDiff, readAgentCommits, readAgentFileDiff, resolveAgentWork, type AgentChanges, type AgentCommit, type FileMark } from './run.js'

// The Changes module's server part: the functions its browser part calls (`@openagt/hooks/rpc`),
// all reads. One about a run takes the run's id (`agentId`) and reads wherever the run's work is
// now (`run.ts`); one without it is about the project's own folder. What a caller sends is checked
// here, whatever its type says: it comes from a page. A read about a run may name one of its
// copies of other repositories (`repo`): it reads that copy's folder instead (`resolveCopyWork`).

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** Where the work a call asks about is: the run's own, or its copy `repo`'s, in the session's folder. */
const workOf = (host: RpcHost, agentId: string, repo: unknown) => {
  const copy = text(repo)
  return copy !== undefined ? resolveCopyWork(agentId, copy) : resolveAgentWork(host, agentId)
}

/** What a run changed, and the branches it is between: the one it is measured from, and its own. */
export type RunChanges = AgentChanges & { from?: string; to?: string }

/** What is changed in the project's own folder and not committed. */
export const project = read(async (host: RpcHost, _input: object): Promise<Record<string, FileMark>> => pendingChanges(host.root))

/**
 * What a run changed, wherever its work is now, and between which branches: the one its record
 * says it started from, else the default branch; and the one its record names, else the one its
 * checkout has out.
 */
export const run = read(async (host: RpcHost, input: { agentId: string; repo?: string }): Promise<RunChanges> => {
  const agentId = text(input.agentId)
  if (agentId === undefined) return { source: 'gone' }
  try {
    const repo = text(input.repo)
    if (repo !== undefined) {
      // A copy of another repository: measured from the commit it was made at, on its own branch.
      const at = await resolveCopyWork(agentId, repo)
      const changes = await readAgentChanges(host.root, at)
      if (!('changes' in changes) || at.source !== 'checkout') return changes
      const [from, to] = await Promise.all([defaultBranchName(at.path), checkoutBranch(at.path)])
      return { ...changes, ...(from ? { from } : {}), ...(to ? { to } : {}) }
    }
    const [found, at] = await Promise.all([host.run(agentId).catch(() => undefined), resolveAgentWork(host, agentId)])
    const changes = await readAgentChanges(host.root, at)
    if (!('changes' in changes)) return changes
    const [from, to] = await Promise.all([
      found?.record?.base ?? defaultBranchName(host.root),
      found?.record?.branch ?? (at.source === 'checkout' ? checkoutBranch(at.path) : at.source === 'branch' ? at.branch : undefined),
    ])
    return { ...changes, ...(from ? { from } : {}), ...(to ? { to } : {}) }
  } catch {
    return { source: 'gone' }
  }
})

/**
 * One changed file's diff, from the same source its list was read from: a run's (in one of its
 * commits, when the call names one), or the project folder's uncommitted change. `whole` asks for
 * every line of the file, not three around each change. The status comes from the same git read
 * the list does, never from the caller: a page that thinks a file is untracked cannot make the
 * read treat it as one.
 */
export const diff = read(async (host: RpcHost, input: { path: string; agentId?: string; repo?: string; commit?: string; whole?: boolean }): Promise<FileDiff | null> => {
  const path = text(input.path)
  if (path === undefined) return null
  const context = input.whole === true ? WHOLE_FILE : CONTEXT_LINES
  const agentId = text(input.agentId)
  if (agentId !== undefined) {
    const at = await workOf(host, agentId, input.repo)
    const sha = text(input.commit)
    return (sha !== undefined ? readAgentCommitFileDiff(host.root, at, sha, path, context) : readAgentFileDiff(host.root, at, path, context)).catch(() => null)
  }
  const status: FileGitStatus | undefined = (await readFileStatuses(host.root))[path]
  return status ? readFileDiff(host.root, path, status, { context }).catch(() => null) : null
})

/**
 * What a working run has changed so far: every changed file in its own checkout, with line counts.
 * `[]` for a run with no checkout: its changes are then its branch's, which the handoff shows, and
 * the project folder's own changes are never passed off as the run's.
 */
export const counts = read(async (host: RpcHost, input: { agentId: string }): Promise<FileChange[]> => {
  const agentId = text(input.agentId)
  const checkout = agentId !== undefined ? (await host.run(agentId).catch(() => undefined))?.checkout : undefined
  if (!checkout) return []
  return readFileChanges(checkout, await readFileStatuses(checkout)).catch(() => [])
})

/** The commits of a run's work, newest first; none for a call naming no run. */
export const commits = read(async (host: RpcHost, input: { agentId: string; repo?: string }): Promise<AgentCommit[]> => {
  const agentId = text(input.agentId)
  if (agentId === undefined) return []
  return readAgentCommits(host.root, await workOf(host, agentId, input.repo)).catch(() => [])
})

/** What one commit of a run's work changed; null when the call names no run, or a commit that is not the run's. */
export const commit = read(async (host: RpcHost, input: { agentId: string; repo?: string; commit: string }): Promise<Record<string, FileMark> | null> => {
  const agentId = text(input.agentId)
  const sha = text(input.commit)
  if (agentId === undefined || sha === undefined) return null
  return readAgentCommitChanges(host.root, await workOf(host, agentId, input.repo), sha).catch(() => null)
})

/** The run's copies of other repositories, by their names in the session's folder: the pane's repo menu lists them after the project. */
export const repos = read(async (_host: RpcHost, input: { agentId: string }): Promise<string[]> => {
  const agentId = text(input.agentId)
  return agentId !== undefined && /^[\w.-]+$/.test(agentId) ? sessionCopies(agentId).catch(() => []) : []
})
