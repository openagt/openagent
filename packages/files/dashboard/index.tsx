// The Files module for the dashboard: the package's `./dashboard` export, built into OpenAgent and
// loaded for every project. It adds two panes beside the chat, Changes first. Files shows the project's files, or a
// run's with what the run changed marked while that is not merged yet, for as long as its
// checkout, branch or merge commit exists. Changes lists only the files that changed: a run's,
// kept after its work is merged, or the project folder's own. And, on a working run's page, the count of files it has changed so far, in the bar
// above the message box. Its data is its own server part's reads (`../src/server.ts`).
import { defineModule } from '@openagt/dashboard/module'
import { FileDiff, FolderIcon } from 'lucide-react'
import { FileTree } from './FileTree.js'
import { ChangesPanel } from './ChangesPanel.js'
import { ChangesSummary } from './AgentChanges.js'
import './dashboard.css'

export default defineModule({
  panels: [
    {
      id: 'changes',
      label: 'Changes',
      help: 'Only the files that changed: a session’s, kept after its work is merged, or the project folder’s own — the list on the left, the picked file’s diff on the right.',
      icon: FileDiff,
      changes: true,
      Panel: ChangesPanel,
    },
    {
      id: 'files',
      label: 'Files',
      help: 'The project’s files, or a session’s with what it changed marked while that is not merged yet — hover one to preview it, click one to add it to the next run’s Context.',
      icon: FolderIcon,
      Panel: FileTree,
    },
  ],
  run: { summary: ChangesSummary },
  stylesheet: 'dashboard.css',
})
