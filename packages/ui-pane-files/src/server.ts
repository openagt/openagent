import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { sessionCopies } from '@openagt/git-branches'
import { sessionsHome } from '@openagt/hooks'
import { read, type RpcHost } from '@openagt/hooks/rpc'
import { listFiles } from './list.js'
import { readFileContent, type FileContent } from './read.js'
import { readAgentFileContent, readAgentTree, resolveAgentFiles, type AgentTree } from './tree.js'

// The Files module's server part: the functions its browser part calls (`@openagt/hooks/rpc`), all
// reads. One about a run takes the run's id (`agentId`) and reads wherever the run's files are now
// (`tree.ts`); one without it is about the project's own folder. What a caller sends is checked
// here, whatever its type says: it comes from a page. A run's copies of other repositories, each
// its own folder in the session's folder, are read beside its own files (`copies`), and a file of
// one is read by naming the copy (`repo`).

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** What the Files pane shows for the project itself: every file in its folder. */
export const project = read(async (host: RpcHost, _input: object): Promise<string[]> => listFiles(host.root))

/** A run's files, wherever they are now. */
export const tree = read(async (host: RpcHost, input: { agentId: string }): Promise<AgentTree> => {
  const agentId = text(input.agentId)
  if (agentId === undefined) return { source: 'gone' }
  return readAgentTree(host.root, await resolveAgentFiles(host, agentId)).catch((): AgentTree => ({ source: 'gone' }))
})

/** A copy's folder in the session's folder; none for a name that is no folder's own, or a copy that is not there. */
function copyFolder(agentId: string, repo: string): string | undefined {
  if (!/^[\w.-]+$/.test(agentId) || !/^[^./\\][^/\\]*$/.test(repo)) return undefined
  const folder = join(sessionsHome(), agentId, repo)
  return existsSync(join(folder, '.git')) ? folder : undefined
}

/** The run's copies of other repositories with their files, and the name of the project's own folder: the pane draws one tree, a folder per repo. */
export const copies = read(async (host: RpcHost, input: { agentId: string }): Promise<{ project: string; copies: { name: string; files: string[] }[] }> => {
  const agentId = text(input.agentId)
  const names = agentId !== undefined && /^[\w.-]+$/.test(agentId) ? await sessionCopies(agentId).catch(() => []) : []
  const copies = await Promise.all(names.map(async name => ({ name, files: await listFiles(join(sessionsHome(), agentId!, name)).catch(() => []) })))
  return { project: basename(host.root), copies }
})

/** One file's contents, from the same source its tree was read from: the run's copy, or the project folder's; or a file of the run's copy `repo` of another repository. */
export const content = read(async (host: RpcHost, input: { path: string; agentId?: string; repo?: string }): Promise<FileContent | null> => {
  const path = text(input.path)
  if (path === undefined) return null
  const agentId = text(input.agentId)
  const repo = text(input.repo)
  if (agentId !== undefined && repo !== undefined) {
    const folder = copyFolder(agentId, repo)
    return folder ? readFileContent(folder, path) : null
  }
  if (agentId !== undefined) return readAgentFileContent(host.root, await resolveAgentFiles(host, agentId), path).catch(() => null)
  return readFileContent(host.root, path)
})
