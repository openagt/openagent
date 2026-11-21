import { computerRpcClient, type ModuleHost } from '@openagt/ui/module'

// The module's calls of its own server part (`../src/server.ts`), typed by it, in no project: the
// person's name and picture are theirs on every computer. Each throws the reason a call failed.

const server = (host: ModuleHost) => computerRpcClient<typeof import('../src/server.js')>(host)

/** Call the person `name`, on every computer of theirs. */
export const saveName = (host: ModuleHost, name: string) => server(host).saveName({ name })

/** Show no picture of them: their initials instead. */
export const removePicture = (host: ModuleHost) => server(host).removePicture({})

/** Copy the name and picture of the GitHub profile of `login`, once. */
export const copyFromGitHub = (host: ModuleHost, login: string) => server(host).copyFromGitHub({ login })
