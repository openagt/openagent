// The module for the dashboard: the package's `./dashboard` export. It adds the Browser tab of
// the side panel: the browser the session's agent opened, live, with its address bar, taking the
// person's clicks and typing. What it shows is the stream the browser's own process writes
// (`../src/stream.ts`), asked of OpenAgent, which asks the computer the session runs on.
import { defineModule } from '@openagt/dashboard/module'
import { BrowserPanel } from './BrowserPanel.js'
import './dashboard.css'

export default defineModule({
  panels: [
    {
      id: 'browser',
      label: 'Browser',
      help: 'The browser the session’s agent opened, live: watch it, and click, scroll and type in it.',
      screen: true,
      Panel: BrowserPanel,
    },
  ],
  stylesheet: 'dashboard.css',
})
