import { computerRpcClient, type ModuleHost } from '@openagt/ui/module'
import type { Waiting } from '../src/server.js'

// The module's calls of its own server part (`../src/server.ts`), typed by it, in no project: the
// list of projects is this computer's. Each throws the reason a call failed. A call that waits on a
// person (the folder dialog) or a clone answers `waiting` before it is done: it is asked again
// until it answers.

const server = (host: Pick<ModuleHost, 'callComputer'>) => computerRpcClient<typeof import('../src/server.js')>(host)

/** Ask `call` again while it answers that it is still waiting. */
async function untilAnswered<T>(call: () => Promise<T | Waiting>): Promise<T> {
  for (;;) {
    const answer = await call()
    if (!(typeof answer === 'object' && answer !== null && 'waiting' in answer)) return answer
  }
}

/** The repos on this computer that are not projects yet. */
export const readRepos = (host: Pick<ModuleHost, 'callComputer'>) => server(host).repos({})

/** The system's folder dialog on this computer, until the person picked a folder or dismissed it. */
export const pickDirectory = (host: Pick<ModuleHost, 'callComputer'>) => untilAnswered(() => server(host).pickDirectory({}))

/** Add the folder at `path` as a project. */
export const addProject = (host: Pick<ModuleHost, 'callComputer'>, path: string) => server(host).addProject({ path })

/** Where what was typed would be cloned to, or why it is no address. */
export const cloneTargetFor = (host: Pick<ModuleHost, 'callComputer'>, address: string) => server(host).cloneTargetFor({ address })

/** Clone the repository at `address` and add it as a project, however long the clone takes. */
export const addFromAddress = (host: Pick<ModuleHost, 'callComputer'>, address: string) => untilAnswered(() => server(host).addFromAddress({ address }))

/** Take a project off the list; with `files`, what OpenAgent left in its folder too. */
export const removeProject = (host: Pick<ModuleHost, 'callComputer'>, projectId: string, files: boolean) => server(host).removeProject({ projectId, files })

/** "Search another folder…": the folder dialog, and the folder picked looked in for repos. */
export const addFolderToSearch = (host: Pick<ModuleHost, 'callComputer'>) => untilAnswered(() => server(host).addFolderToSearch({}))

/** Stop looking in a folder the person added. */
export const removeFolderToSearch = (host: Pick<ModuleHost, 'callComputer'>, folder: string) => server(host).removeFolderToSearch({ folder })

/** The folders the person added to look for repos in. */
export const readRepoFolders = (host: Pick<ModuleHost, 'callComputer'>) => server(host).repoFolders({})
