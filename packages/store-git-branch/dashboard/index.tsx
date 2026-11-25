// store-git-branch's UI part: the package's `./dashboard` export. One entry of Settings for a
// project, Project agent data: where the project's agent data is, the person's own folder or its own
// repository's branch `agent-data`, switched there, and what is kept there; and "Agent data…" in the
// project's menu, which opens it. Its reads and writes are its own server part's (`../src/server.ts`).
import { Database } from 'lucide-react'
import { defineUiModule } from '@openagt/ui/module'
import { SHARE_ENTRY } from '../src/entry.js'
import { ProjectAgentDataSettings } from './ProjectAgentDataSettings.js'

export default defineUiModule({
  name: 'store-git-branch',
  hooks: {
    'ui.view': [
      {
        place: 'settings.section',
        id: SHARE_ENTRY,
        title: 'Project agent data',
        icon: Database,
        order: 50,
        pickProject: 'Each project keeps its agent data in one place, your folder or its own repository. Pick a project.',
        View: ProjectAgentDataSettings,
      },
    ],
    'ui.action': [
      {
        place: 'project.menu',
        id: 'agent-data',
        label: 'Agent data…',
        icon: Database,
        run: async (host, { projectId }) => {
          host.openSettings(SHARE_ENTRY, projectId)
          return { ok: true }
        },
      },
    ],
  },
})
