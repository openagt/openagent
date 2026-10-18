// The module for the dashboard: the package's `./dashboard` export. It adds the Devices entry
// of Settings. Its data is the `remote-access` command's own: `status` to read, `on`,
// `off`, `add` and `remove` to change.
import { Smartphone } from 'lucide-react'
import { defineModule } from '@openagt/dashboard/module'
import { DevicesSettings } from './DevicesSettings.js'
import './dashboard.css'

export default defineModule({
  settings: [{ id: 'devices', title: 'Devices', icon: Smartphone, order: 10, Section: () => <DevicesSettings /> }],
  stylesheet: 'dashboard.css',
})
