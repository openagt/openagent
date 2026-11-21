import { rpcClient, type ModuleHost } from '@openagt/ui/module'
import type { Answer, Answered } from '../src/server.js'

// The module's calls of its own server part (`../src/server.ts`), typed by it, in the project of
// the run that asks. A call that fails throws why.

export type { Answer, Answered }

const server = (host: ModuleHost) => rpcClient<typeof import('../src/server.js')>(host)

/** Send the person's answer to question `question` that run `agentId` waits on: what the agent was told, or why nothing was. */
export const sendAnswer = (host: ModuleHost, projectId: string, agentId: string, question: string, answer: Answer): Promise<Answered> => server(host).answer(projectId, { agentId, question, ...answer })
