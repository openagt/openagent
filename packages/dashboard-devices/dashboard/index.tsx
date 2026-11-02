// The module for the dashboard: the package's `./dashboard` export. It adds the Devices entry of
// Settings: this computer, how the person's devices reach it, and every device of theirs, phones,
// computers and servers. Its data is the `devices` command's own (`status`, `on`, `off`, `add`,
// `remove`, `rename`) and, for servers, `devices server`'s; the saved machines are OpenAgent's,
// read and changed through the dashboard. Over every page, the popup for a computer on this Wi-Fi
// that asks to connect. On the Overview, a card of this computer and its servers: whether each answers,
// and how much of its memory and disk is in use.
import { MonitorSmartphone } from 'lucide-react'
import { defineModule } from '@openagt/dashboard/module'
import { DevicesSettings } from './DevicesSettings.js'
import { DevicesCard } from './DevicesCard.js'
import { AskPopup } from './Pairing.js'
import './dashboard.css'

export default defineModule({
  settings: [{ id: 'devices', title: 'Devices', icon: MonitorSmartphone, order: 10, Section: ({ item }) => <DevicesSettings {...(item !== undefined ? { item } : {})} /> }],
  cards: [{ id: 'devices', label: 'Devices', order: 40, width: '1/3', minWidth: '1/4', Card: DevicesCard }],
  everyPage: AskPopup,
  stylesheet: 'dashboard.css',
})
