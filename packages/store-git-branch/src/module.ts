import { readSharing } from '@openagt/store-filesystem'
import { defineModule } from '@openagt/hooks'
import { SHARE_ENTRY } from './entry.js'
import { backupAttention } from './backup-attention.js'
import { gitBranchBackend } from './backend.js'
import { dataSync } from './sync.js'

/**
 * store-git-branch, a plugin kept per project: a shared project's data on its `agent-data`
 * branch. It is on in a project whose data the person shares there: its row is the clone's own
 * answer (`agent-data.share`), which its link reads to know where the project's data is, switched
 * on the project's Agent data entry, which moves the data and asks first: everyone who can read
 * the repository reads it there. Its link of the store's chain is there in every project, as
 * every store's is, and passes on the scopes of the projects not shared. Its own timer keeps the
 * shared projects' data in step with their remotes, and a project whose data does not converge is
 * said to need the person (`sync.ts`), as is one at a git host with no account of OpenAgent's named
 * to send it as (`backup-attention.ts`).
 */
const sync = dataSync()

export default defineModule({
  name: 'store-git-branch',
  plugin: { scope: 'project', row: { read: async project => project !== undefined && (await readSharing(project.dir)), settings: SHARE_ENTRY } },
  hooks: {
    'store.backend': gitBranchBackend(),
    'app.lifecycle': sync.lifecycle,
    'app.attention': async (args, app) => [...(await sync.attention(args, app)), ...(await backupAttention(args, app))],
  },
})

export { SHARE_ENTRY } from './entry.js'
