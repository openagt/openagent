// The Files module for the dashboard: the package's `./dashboard` export, built into OpenAgent and
// loaded for every project. It adds one pane beside the chat: the project's files, or a run's, for
// as long as its checkout, branch or merge commit exists, and the files opened from them. Its data is its own server part's reads
// (`../src/server.ts`).
import { defineModule } from '@openagt/dashboard/module'
import { FolderIcon } from 'lucide-react'
import { FilesPane } from './FilesPane.js'
import './dashboard.css'

export default defineModule({
  panels: [
    {
      id: 'files',
      label: 'Files',
      icon: FolderIcon,
      Panel: FilesPane,
    },
  ],
  stylesheet: 'dashboard.css',
})
