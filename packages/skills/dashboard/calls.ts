import { NO_PROJECT, rpcClient, type ModuleHost } from '@openagt/ui/module'

// The module's calls of its own server part (`../src/server.ts`), typed by it, in the project each
// is about, or with none in {@link NO_PROJECT}. Each throws the reason a call failed, so a polled
// read keeps the last answer it had.

export type { ListedSkill, PluginChoice, ProjectSkills, SkillChoices } from '../src/server.js'

const server = (host: Pick<ModuleHost, 'call'>) => rpcClient<typeof import('../src/server.js')>(host)

/** The project's own skills, each said waiting while its runs do not have it yet. */
export const readSkills = (host: ModuleHost, projectId: string) => server(host).projectSkills(projectId, {})

/**
 * What the Skills line picks from in the project (none: a session with no project, or with `every`
 * a profile's editor), and what the profile in force has of it: `profile`, else the one picked for
 * every next run.
 */
export const readSkillChoices = (host: ModuleHost, projectId: string | undefined, input: { profile?: string; every?: boolean }) => server(host).skillChoices(projectId ?? NO_PROJECT, input)

/** The commands the message box offers in the project. */
export const readCommands = (host: Pick<ModuleHost, 'call'>, projectId: string) => server(host).commands(projectId, {})
