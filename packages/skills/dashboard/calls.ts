import { rpcClient, type ModuleHost } from '@openagt/ui/module'

// The module's calls of its own server part (`../src/server.ts`), typed by it, in the project each
// is about. Each throws the reason a call failed, so a polled read keeps the last answer it had.

export type { ListedSkill, ProjectSkills } from '../src/server.js'

const server = (host: ModuleHost) => rpcClient<typeof import('../src/server.js')>(host)

/** The project's own skills, each said waiting while its runs do not have it yet. */
export const readSkills = (host: ModuleHost, projectId: string) => server(host).projectSkills(projectId, {})
