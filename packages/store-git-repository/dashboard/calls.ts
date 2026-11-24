import { computerRpcClient, type ModuleHost } from '@openagt/ui/module'

// The module's calls of its own server part (`../src/server.ts`), typed by it, in no project: the
// person's folder is theirs on this computer. Each throws the reason a call failed.

export type { BackupGap, PersonalFolderView } from '../src/server.js'

export const server = (host: Pick<ModuleHost, 'callComputer'>) => computerRpcClient<typeof import('../src/server.js')>(host)
