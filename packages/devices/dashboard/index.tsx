// The module for the dashboard: the package's `./dashboard` export. It adds two entries of
// Settings. Devices: its data is the `devices` command's own: `status` to read, `on`, `off`,
// `add` and `remove` to change. Machines: the servers this computer installed OpenAgent on, and
// every other machine a run can be sent to. A server's data is the `devices server` command's own:
// `status` and `devices` to read, `connect`, `link`, `added`, `reach`, `remove-device` and
// `forget` to change. The machines are OpenAgent's, read and changed through the dashboard.
import { Server, Smartphone } from 'lucide-react'
import { defineModule } from '@openagt/dashboard/module'
import { DevicesSettings } from './DevicesSettings.js'
import { MachinesSettings } from './MachinesSettings.js'
import './dashboard.css'

export default defineModule({
  settings: [
    { id: 'devices', title: 'Devices', icon: Smartphone, order: 10, Section: () => <DevicesSettings /> },
    { id: 'machines', title: 'Machines', icon: Server, order: 20, Section: () => <MachinesSettings /> },
  ],
  stylesheet: 'dashboard.css',
})
