// The module for the dashboard: the package's `./dashboard` export. It adds the Servers section
// of the Settings page. Its data is the `servers` command's own: `status` to read, `connect`,
// `link`, `added` and `forget` to change.
import { defineModule } from '@openagt/dashboard/module'
import { ServersSettings } from './ServersSettings.js'
import './dashboard.css'

export default defineModule({
  settings: [{ id: 'servers', order: 20, Section: () => <ServersSettings /> }],
  stylesheet: 'dashboard.css',
})
