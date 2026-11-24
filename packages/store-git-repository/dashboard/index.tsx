// store-git-repository's UI part: the package's `./dashboard` export. One entry of Settings, Your
// agent data, among the person's and this computer's: the person's own folder, where the agents keep
// everything, synced with a repository of theirs, and at its top what of the agents' data is not
// backed up, with the press that names an account for it: what the item the module says needs the
// person (`app.attention`) opens. Its reads and writes are its own server part's (`../src/server.ts`).
import { FolderGit2 } from 'lucide-react'
import { defineUiModule } from '@openagt/ui/module'
import { SYNC_ENTRY } from '../src/entry.js'
import { AgentDataSettings } from './AgentDataSettings.js'

export default defineUiModule({
  name: 'store-git-repository',
  hooks: {
    'ui.view': [{ place: 'settings.section', id: SYNC_ENTRY, title: 'Your agent data', icon: FolderGit2, order: 50, View: AgentDataSettings }],
  },
})
