import type { ModuleHost } from '@openagt/dashboard/module'
import type { AgentChanges, AgentCommit, FileMark } from '../src/run.js'
import type { FileChange, FileDiff } from '../src/diff.js'

// The module's reads, typed: each asks the module's own server part (`../src/server.ts`) through
// the dashboard, and throws the reason when the read answers an error, so a polled read keeps the
// last answer it had rather than showing an empty list.

async function read<T>(host: ModuleHost, projectId: string, name: string, input: Record<string, unknown>): Promise<T> {
  const result = await host.read(projectId, name, input)
  if (!result.ok) throw new Error(result.error)
  return result.output as T
}

/** What is changed in the project's own folder and not committed. */
export const readProject = (host: ModuleHost, projectId: string) => read<Record<string, FileMark>>(host, projectId, 'project', {})

/** What a run changed, wherever its work is now. */
export const readRun = (host: ModuleHost, projectId: string, agentId: string) => read<AgentChanges>(host, projectId, 'run', { agentId })

/** One changed file's diff: the run's (in one of its commits, when `commit` names one), or the project folder's. */
export const readDiff = (host: ModuleHost, projectId: string, path: string, agentId?: string, commit?: string) =>
  read<FileDiff | null>(host, projectId, 'diff', agentId !== undefined ? { path, agentId, ...(commit !== undefined ? { commit } : {}) } : { path })

/** The commits of a run's work, newest first. */
export const readCommits = (host: ModuleHost, projectId: string, agentId: string) => read<AgentCommit[]>(host, projectId, 'commits', { agentId })

/** What one commit of a run's work changed; null when it is not one of the run's commits. */
export const readCommit = (host: ModuleHost, projectId: string, agentId: string, commit: string) =>
  read<Record<string, FileMark> | null>(host, projectId, 'commit', { agentId, commit })

/** What a working run has changed so far in its checkout, with line counts. */
export const readCounts = (host: ModuleHost, projectId: string, agentId: string) => read<FileChange[]>(host, projectId, 'counts', { agentId })
