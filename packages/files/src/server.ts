import type { ModuleReadInput, ModuleServer, ModuleServerHost } from '@openagt/dashboard/module-server'
import { listFiles } from './list.js'
import { readFileStatuses, type FileGitStatus } from './status.js'
import { readFileChanges, readFileDiff, type FileChange, type FileDiff } from './diff.js'
import { readFileContent, type FileContent } from './read.js'
import { readAgentCommitChanges, readAgentCommitFileDiff, readAgentCommits, readAgentFileContent, readAgentFileDiff, readAgentTree, resolveAgentFiles, type AgentCommit, type AgentTree, type FileMark } from './tree.js'

// The Files module's server part: the reads its browser part makes. A read about a run takes the
// run's id (`agentId`) and reads wherever the run's files are now (`tree.ts`); a read without one
// is about the project's own folder.

/** What the Files pane shows for the project itself: every file, the ones changed on disk marked. */
export interface ProjectTree {
  files: string[]
  changes: Record<string, FileMark>
}

function runId(input: ModuleReadInput): string | undefined {
  return typeof input.agentId === 'string' ? input.agentId : undefined
}

function pathOf(input: ModuleReadInput): string | undefined {
  return typeof input.path === 'string' ? input.path : undefined
}

function commitId(input: ModuleReadInput): string | undefined {
  return typeof input.commit === 'string' ? input.commit : undefined
}

async function project(host: ModuleServerHost): Promise<ProjectTree> {
  const [files, statuses] = await Promise.all([listFiles(host.root), readFileStatuses(host.root)])
  const changes: Record<string, FileMark> = {}
  for (const [path, status] of Object.entries(statuses)) changes[path] = { status, committed: false }
  return { files, changes }
}

async function tree(host: ModuleServerHost, input: ModuleReadInput): Promise<AgentTree> {
  const agentId = runId(input)
  if (agentId === undefined) return { source: 'gone' }
  return readAgentTree(host.root, await resolveAgentFiles(host, agentId)).catch((): AgentTree => ({ source: 'gone' }))
}

/**
 * One changed file's diff, from the same source its tree was read from: a run's (in one of its
 * commits, when the read names one), or the project folder's uncommitted change. The status comes from the same git read the marks do, never from
 * the caller: a page that thinks a file is untracked cannot make the read treat it as one.
 */
async function diff(host: ModuleServerHost, input: ModuleReadInput): Promise<FileDiff | null> {
  const path = pathOf(input)
  if (path === undefined) return null
  const agentId = runId(input)
  if (agentId !== undefined) {
    const at = await resolveAgentFiles(host, agentId)
    const sha = commitId(input)
    return (sha !== undefined ? readAgentCommitFileDiff(host.root, at, sha, path) : readAgentFileDiff(host.root, at, path)).catch(() => null)
  }
  const status: FileGitStatus | undefined = (await readFileStatuses(host.root))[path]
  return status ? readFileDiff(host.root, path, status).catch(() => null) : null
}

/** One unchanged file's contents, from the same source its tree was read from. */
async function content(host: ModuleServerHost, input: ModuleReadInput): Promise<FileContent | null> {
  const path = pathOf(input)
  if (path === undefined) return null
  const agentId = runId(input)
  if (agentId !== undefined) return readAgentFileContent(host.root, await resolveAgentFiles(host, agentId), path).catch(() => null)
  return readFileContent(host.root, path)
}

/**
 * What a working run has changed so far: every changed file in its own checkout, with line counts.
 * `[]` for a run with no checkout: its changes are then its branch's, which the handoff shows, and
 * the project folder's own changes are never passed off as the run's.
 */
async function changes(host: ModuleServerHost, input: ModuleReadInput): Promise<FileChange[]> {
  const agentId = runId(input)
  const checkout = agentId !== undefined ? (await host.run(agentId).catch(() => undefined))?.checkout : undefined
  if (!checkout) return []
  return readFileChanges(checkout, await readFileStatuses(checkout)).catch(() => [])
}

/** The commits of a run's work, newest first; none for a read naming no run. */
async function commits(host: ModuleServerHost, input: ModuleReadInput): Promise<AgentCommit[]> {
  const agentId = runId(input)
  if (agentId === undefined) return []
  return readAgentCommits(host.root, await resolveAgentFiles(host, agentId)).catch(() => [])
}

/** What one commit of a run's work changed; null when the read names no run, or a commit that is not the run's. */
async function commit(host: ModuleServerHost, input: ModuleReadInput): Promise<Record<string, FileMark> | null> {
  const agentId = runId(input)
  const sha = commitId(input)
  if (agentId === undefined || sha === undefined) return null
  return readAgentCommitChanges(host.root, await resolveAgentFiles(host, agentId), sha).catch(() => null)
}

const server: ModuleServer = { reads: { project, tree, diff, content, changes, commits, commit } }
export default server
