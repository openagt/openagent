import type { ModuleReadInput, ModuleServer, ModuleServerHost } from '@openagt/dashboard/module-server'
import { listFiles } from './list.js'
import { readFileContent, type FileContent } from './read.js'
import { readAgentFileContent, readAgentTree, resolveAgentFiles, type AgentTree } from './tree.js'

// The Files module's server part: the reads its browser part makes. A read about a run takes the
// run's id (`agentId`) and reads wherever the run's files are now (`tree.ts`); a read without one
// is about the project's own folder.

function runId(input: ModuleReadInput): string | undefined {
  return typeof input.agentId === 'string' ? input.agentId : undefined
}

/** What the Files pane shows for the project itself: every file in its folder. */
function project(host: ModuleServerHost): Promise<string[]> {
  return listFiles(host.root)
}

async function tree(host: ModuleServerHost, input: ModuleReadInput): Promise<AgentTree> {
  const agentId = runId(input)
  if (agentId === undefined) return { source: 'gone' }
  return readAgentTree(host.root, await resolveAgentFiles(host, agentId)).catch((): AgentTree => ({ source: 'gone' }))
}

/** One file's contents, from the same source its tree was read from. */
async function content(host: ModuleServerHost, input: ModuleReadInput): Promise<FileContent | null> {
  const path = typeof input.path === 'string' ? input.path : undefined
  if (path === undefined) return null
  const agentId = runId(input)
  if (agentId !== undefined) return readAgentFileContent(host.root, await resolveAgentFiles(host, agentId), path).catch(() => null)
  return readFileContent(host.root, path)
}

const server: ModuleServer = { reads: { project, tree, content } }
export default server
