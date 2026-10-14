// The Changes module for the dashboard: the package's `./dashboard` export, built into OpenAgent
// and loaded for every project. It adds one pane beside the chat: only the files that changed, a
// run's, kept after its work is merged, or the project folder's own. And, on a working run's page,
// the count of files it has changed so far, in the bar above the message box. Its data is its own
// server part's reads (`../src/server.ts`).
import { defineModule } from '@openagt/dashboard/module'
import { FileDiff } from 'lucide-react'
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
  ],
  run: { summary: ChangesSummary },
  stylesheet: 'dashboard.css',
})
