import { rpcClient, type ModuleHost } from '@openagt/ui/module'

// The module's calls of its own server part (`../src/server.ts`), typed by it. Each throws the
// reason when the call answers an error, so a polled read keeps the last answer it had rather than
// showing an empty list.

const server = (host: ModuleHost) => rpcClient<typeof import('../src/server.js')>(host)

/** What is changed in the project's own folder and not committed. */
export const readProject = (host: ModuleHost, projectId: string) => server(host).project(projectId, {})

/** A run's copy of another repository, when a read is about it rather than the run's own work. */
const ofRepo = (repo: string | undefined) => (repo !== undefined ? { repo } : {})

/** What a run changed, wherever its work is now; or what its copy `repo` holds. */
export const readRun = (host: ModuleHost, projectId: string, agentId: string, repo?: string) => server(host).run(projectId, { agentId, ...ofRepo(repo) })

/** The run's copies of other repositories, by name. */
export const readRepos = (host: ModuleHost, projectId: string, agentId: string) => server(host).repos(projectId, { agentId })

/**
 * One changed file's diff: the run's (in one of its commits, when `commit` names one), or the
 * project folder's. `whole` asks for every line of the file, not only those around its changes.
 */
export const readDiff = (host: ModuleHost, projectId: string, path: string, agentId?: string, commit?: string, whole = false, repo?: string) =>
  server(host).diff(projectId, { path, ...(agentId !== undefined ? { agentId, ...ofRepo(repo), ...(commit !== undefined ? { commit } : {}) } : {}), ...(whole ? { whole } : {}) })

/** The commits of a run's work, newest first. */
export const readCommits = (host: ModuleHost, projectId: string, agentId: string, repo?: string) => server(host).commits(projectId, { agentId, ...ofRepo(repo) })

/** What one commit of a run's work changed; null when it is not one of the run's commits. */
export const readCommit = (host: ModuleHost, projectId: string, agentId: string, commit: string, repo?: string) => server(host).commit(projectId, { agentId, commit, ...ofRepo(repo) })

/** What a working run has changed so far in its checkout, with line counts. */
export const readCounts = (host: ModuleHost, projectId: string, agentId: string) => server(host).counts(projectId, { agentId })
