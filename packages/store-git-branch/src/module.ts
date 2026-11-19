import { readSharing } from '@openagt/agent-data'
import { defineModule } from '@openagt/hooks'
import { gitBranchBackend } from './backend.js'

/** The Settings entry a project's data is shared on: the project's Agent data. */
export const SHARE_ENTRY = 'project-agent-data'

/**
 * store-git-branch, a plugin kept per project: a shared project's data on its `agent-data`
 * branch. It is on in a project whose data the person shares there: its row is the clone's own
 * answer (`agent-data.share`), which its link reads to know where the project's data is, switched
 * on the project's Agent data entry, which moves the data and asks first: everyone who can read
 * the repository reads it there. Its link of the store's chain is there in every project, as
 * every store's is, and passes on the scopes of the projects not shared.
 */
export default defineModule({
  name: 'store-git-branch',
  plugin: { scope: 'project', row: { read: async project => project !== undefined && (await readSharing(project.dir)), settings: SHARE_ENTRY } },
  hooks: { 'store.backend': gitBranchBackend() },
})
