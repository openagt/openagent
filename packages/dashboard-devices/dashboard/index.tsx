// The module for the dashboard: the package's `./dashboard` export. It adds the Devices entry of
// Settings: this computer, how the person's devices reach it, and every device of theirs, phones,
// computers and servers. Its data is the `devices` command's own (`status`, `on`, `off`, `add`,
// `remove`, `rename`) and, for servers, `devices server`'s; the saved machines are OpenAgent's,
// read and changed through the dashboard. Over every page, the popup for a computer on this Wi-Fi
// that asks to connect. On the Overview, a card of this computer and its servers: whether each answers,
// and how much of its memory and disk is in use.
import { MonitorSmartphone } from 'lucide-react'
import { defineUiModule } from '@openagt/ui/module'
import { DevicesSettings } from './DevicesSettings.js'
import { DevicesCard } from './DevicesCard.js'
import { AskPopup } from './Pairing.js'

export default defineUiModule({
  name: 'devices',
  hooks: {
    'ui.view': [
      { place: 'settings.section', id: 'devices', title: 'Devices', icon: MonitorSmartphone, order: 10, View: ({ item }) => <DevicesSettings {...(item !== undefined ? { item } : {})} /> },
      { place: 'overview.card', id: 'devices', label: 'Devices', order: 11, width: '1/3', minWidth: '1/4', View: DevicesCard },
      { place: 'app.overlay', id: 'ask', View: AskPopup },
    ],
  },
})
