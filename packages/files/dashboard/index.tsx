// The Files module for the dashboard: the package's `./dashboard` export, built into OpenAgent and
// loaded for every project. It adds one pane beside the chat: the project's files, or a run's, for
// as long as its checkout, branch or merge commit exists. Its data is its own server part's reads
// (`../src/server.ts`).
import { defineModule } from '@openagt/dashboard/module'
import { FolderIcon } from 'lucide-react'
import { FileTree } from './FileTree.js'
import './dashboard.css'

export default defineModule({
  panels: [
    {
      id: 'files',
      label: 'Files',
      help: 'The project’s files, or a session’s as it left them — hover one to preview it, click one to add it to the next run’s Context.',
      icon: FolderIcon,
      Panel: FileTree,
    },
  ],
  stylesheet: 'dashboard.css',
})
