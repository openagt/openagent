// notifications-command's UI part: the package's `./dashboard` export. One entry of Settings,
// Notifications, where the person types the command this computer runs when a run needs them. It
// reads and saves the command through its own server part (`../src/server.ts`).
import { defineUiModule } from '@openagt/ui/module'
import { BellRing } from 'lucide-react'
import { CommandSettings } from './CommandSettings.js'

export default defineUiModule({
  name: 'notifications-command',
  hooks: {
    'ui.view': [{ place: 'settings.section', id: 'notifications-command', title: 'Notification command', icon: BellRing, order: 35, View: CommandSettings }],
  },
})
