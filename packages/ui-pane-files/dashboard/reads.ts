import { rpcClient, type ModuleHost } from '@openagt/ui/module'

// The module's calls of its own server part (`../src/server.ts`), typed by it. Each throws the
// reason when the call answers an error, so a polled read keeps the last answer it had rather than
// showing an empty tree.

const server = (host: ModuleHost) => rpcClient<typeof import('../src/server.js')>(host)

/** The files in the project's own folder. */
export const readProject = (host: ModuleHost, projectId: string) => server(host).project(projectId, {})

/** A run's files wherever they are now. */
export const readTree = (host: ModuleHost, projectId: string, agentId: string) => server(host).tree(projectId, { agentId })

/** One file's contents: the run's copy, or the project folder's. */
export const readContent = (host: ModuleHost, projectId: string, path: string, agentId?: string, repo?: string) =>
  server(host).content(projectId, agentId !== undefined ? { path, agentId, ...(repo !== undefined ? { repo } : {}) } : { path })

/** The run's copies of other repositories with their files, and the project's own folder's name. */
export const readCopies = (host: ModuleHost, projectId: string, agentId: string) => server(host).copies(projectId, { agentId })
