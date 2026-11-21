// notifications-browser's UI part: the package's `./dashboard` export. The notifier, drawn over
// every page and showing nothing (`app.overlay`), and one entry of Settings, Notifications, where
// this browser is allowed to show them and the person picks what they are about. It reads and
// saves the person's switches through its own server part (`../src/server.ts`).
import { defineUiModule } from '@openagt/ui/module'
import { Bell } from 'lucide-react'
import { NotificationSettings } from './NotificationSettings.js'
import { Notifier } from './Notifier.js'

export default defineUiModule({
  name: 'notifications-browser',
  hooks: {
    'ui.view': [
      { place: 'app.overlay', id: 'notifier', View: Notifier },
      { place: 'settings.section', id: 'notifications', title: 'Notifications', icon: Bell, order: 30, View: NotificationSettings },
    ],
  },
})
