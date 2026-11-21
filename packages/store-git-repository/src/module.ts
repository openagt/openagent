import { personalFolderSyncs } from '@openagt/agent-data'
import { defineModule } from '@openagt/hooks'
import { gitRepositoryBackend } from './backend.js'
import { folderSync } from './sync.js'

/** The Settings entry the folder is synced on: Settings › Your agent data. */
export const SYNC_ENTRY = 'agent-data'

/**
 * store-git-repository, a plugin kept per computer: the person's own folder as a git repository,
 * synced with a repository of theirs. It is on where the folder syncs with one: its row is the
 * folder's remote, set on Settings › Your agent data with the account it is sent as, and taken
 * away there. Its link of the store's chain is there either way, as every store's is: with no
 * remote, a save is a commit in the folder, sent nowhere. Its own timer keeps the folder in step
 * with the repository, and a folder that does not converge is said to need the person (`sync.ts`).
 */
const sync = folderSync()

export default defineModule({
  name: 'store-git-repository',
  plugin: { scope: 'computer', row: { read: () => personalFolderSyncs(), settings: SYNC_ENTRY } },
  hooks: { 'store.backend': gitRepositoryBackend(), 'app.lifecycle': sync.lifecycle, 'app.attention': sync.attention },
})
