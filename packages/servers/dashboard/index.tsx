// The module for the dashboard: the package's `./dashboard` export. It adds the Machines section
// of the Settings page: the servers this computer installed OpenAgent on, and every other machine
// a run can be sent to. A server's data is the `servers` command's own: `status` and `devices` to
// read, `connect`, `link`, `added`, `reach`, `remove-device` and `forget` to change. The machines
// are OpenAgent's, read and changed through the dashboard.
import { defineModule } from '@openagt/dashboard/module'
import { MachinesSettings } from './MachinesSettings.js'
import './dashboard.css'

export default defineModule({
  settings: [{ id: 'machines', order: 20, Section: () => <MachinesSettings /> }],
  stylesheet: 'dashboard.css',
})
