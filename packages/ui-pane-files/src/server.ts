import { read, type RpcHost } from '@openagt/hooks/rpc'
import { listFiles } from './list.js'
import { readFileContent, type FileContent } from './read.js'
import { readAgentFileContent, readAgentTree, resolveAgentFiles, type AgentTree } from './tree.js'

// The Files module's server part: the functions its browser part calls (`@openagt/hooks/rpc`), all
// reads. One about a run takes the run's id (`agentId`) and reads wherever the run's files are now
// (`tree.ts`); one without it is about the project's own folder. What a caller sends is checked
// here, whatever its type says: it comes from a page.

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** What the Files pane shows for the project itself: every file in its folder. */
export const project = read(async (host: RpcHost, _input: object): Promise<string[]> => listFiles(host.root))

/** A run's files, wherever they are now. */
export const tree = read(async (host: RpcHost, input: { agentId: string }): Promise<AgentTree> => {
  const agentId = text(input.agentId)
  if (agentId === undefined) return { source: 'gone' }
  return readAgentTree(host.root, await resolveAgentFiles(host, agentId)).catch((): AgentTree => ({ source: 'gone' }))
})

/** One file's contents, from the same source its tree was read from: the run's copy, or the project folder's. */
export const content = read(async (host: RpcHost, input: { path: string; agentId?: string }): Promise<FileContent | null> => {
  const path = text(input.path)
  if (path === undefined) return null
  const agentId = text(input.agentId)
  if (agentId !== undefined) return readAgentFileContent(host.root, await resolveAgentFiles(host, agentId), path).catch(() => null)
  return readFileContent(host.root, path)
})
