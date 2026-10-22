// The module for the dashboard: the package's `./dashboard` export. It adds the Devices entry of
// Settings: this computer, how the person's devices reach it, and every device of theirs, phones,
// computers and servers. Its data is the `devices` command's own (`status`, `on`, `off`, `add`,
// `remove`, `rename`) and, for servers, `devices server`'s; the saved machines are OpenAgent's,
// read and changed through the dashboard.
import { MonitorSmartphone } from 'lucide-react'
import { defineModule } from '@openagt/dashboard/module'
import { DevicesSettings } from './DevicesSettings.js'
import './dashboard.css'

export default defineModule({
  settings: [{ id: 'devices', title: 'Devices', icon: MonitorSmartphone, order: 10, Section: () => <DevicesSettings /> }],
  stylesheet: 'dashboard.css',
})
