// The module for the dashboard: the package's `./dashboard` export. It adds the Devices section
// of the Settings page. Its data is the `remote-access` command's own: `status` to read, `on`,
// `off`, `add` and `remove` to change.
import { defineModule } from '@openagt/dashboard/module'
import { DevicesSettings } from './DevicesSettings.js'
import './dashboard.css'

export default defineModule({
  settings: [{ id: 'devices', order: 10, Section: DevicesSettings }],
  stylesheet: 'dashboard.css',
})
