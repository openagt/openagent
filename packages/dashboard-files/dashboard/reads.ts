import type { ModuleHost } from '@openagt/dashboard/module'
import type { AgentTree } from '../src/tree.js'
import type { FileContent } from '../src/read.js'

// The module's reads, typed: each asks the module's own server part (`../src/server.ts`) through
// the dashboard, and throws the reason when the read answers an error, so a polled read keeps the
// last answer it had rather than showing an empty tree.

async function read<T>(host: ModuleHost, projectId: string, name: string, input: Record<string, unknown>): Promise<T> {
  const result = await host.read(projectId, name, input)
  if (!result.ok) throw new Error(result.error)
  return result.output as T
}

/** The files in the project's own folder. */
export const readProject = (host: ModuleHost, projectId: string) => read<string[]>(host, projectId, 'project', {})

/** A run's files wherever they are now. */
export const readTree = (host: ModuleHost, projectId: string, agentId: string) => read<AgentTree>(host, projectId, 'tree', { agentId })

/** One file's contents: the run's copy, or the project folder's. */
export const readContent = (host: ModuleHost, projectId: string, path: string, agentId?: string) =>
  read<FileContent | null>(host, projectId, 'content', agentId !== undefined ? { path, agentId } : { path })
