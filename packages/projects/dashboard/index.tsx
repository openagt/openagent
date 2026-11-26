// projects' UI part: the package's `./dashboard` export. The project picker in the row above the
// launcher's box, with the repos on this computer among every module's (`composer.where`), and the
// same picker as the sidebar's project select (`sidebar.project`); "Remove
// project…" in a project's menu; what fixes "Add your first project" (`app.attention`); and
// Settings › Repos, the folders searched for repos. Its reads and writes are its own server part's
// (`../src/server.ts`), this computer's.
import { useRef } from 'react'
import { defineUiModule } from '@openagt/ui/module'
import { FolderSearch, Trash2 } from 'lucide-react'
import { ADD_PROJECT } from '../src/attention.js'
import { AddProjectPanel } from './AddProjectPanel.js'
import { ProjectControl, SidebarProject, reposHere } from './ProjectPicker.js'
import { RemoveProjectDialog } from './RemoveProjectDialog.js'
import { RepoFolders } from './RepoFolders.js'

/** "Add your first project"'s press: the Add project dialog, the system's folder dialog first, saying what adding one does. */
function AddFirstProject({ onDone }: { onDone(): void }) {
  const opener = useRef<HTMLElement>(null)
  return <AddProjectPanel opener={opener} effects onAdded={() => {}} onClose={onDone} />
}

export default defineUiModule({
  name: 'projects',
  hooks: {
    'ui.view': [
      // First in the row above the box: where the session works, before the branch it starts from.
      { place: 'composer.control', id: 'project', at: 'context', order: 0, View: ProjectControl },
      { place: 'sidebar.project', id: 'project', View: SidebarProject },
      { place: 'settings.section', id: 'repos', title: 'Repos', icon: FolderSearch, order: 60, View: RepoFolders },
    ],
    'ui.action': [
      // Last, and apart: the one item of the project's menu that takes something away.
      { place: 'project.menu', id: 'remove', label: 'Remove project…', icon: Trash2, order: 1000, offer: () => ({ danger: true }), Dialog: RemoveProjectDialog },
      { place: 'attention.fix', id: ADD_PROJECT, label: 'Add a project', Dialog: AddFirstProject },
    ],
    'ui.option': [{ place: 'composer.where', id: 'this-computer', label: 'Repos', loadingWords: 'Looking for repos on this computer…', order: 0, repos: reposHere }],
  },
})
