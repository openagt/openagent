// The module for the dashboard: the package's `./dashboard` export. It adds the Devices entry of
// Settings: this computer, how the person's devices reach it, and every device of theirs, phones,
// computers and servers. Its data is the `devices` command's own (`status`, `on`, `off`, `add`,
// `remove`, `rename`) and, for servers, `devices server`'s; the saved machines are OpenAgent's,
// read and changed through the dashboard. Over every page, the popup for a computer on this Wi-Fi
// that asks to connect.
import { MonitorSmartphone } from 'lucide-react'
import { defineModule } from '@openagt/dashboard/module'
import { DevicesSettings } from './DevicesSettings.js'
import { AskPopup } from './Pairing.js'
import './dashboard.css'

export default defineModule({
  settings: [{ id: 'devices', title: 'Devices', icon: MonitorSmartphone, order: 10, Section: () => <DevicesSettings /> }],
  everyPage: AskPopup,
  stylesheet: 'dashboard.css',
})
