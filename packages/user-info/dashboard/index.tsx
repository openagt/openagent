// user-info's UI part: the package's `./dashboard` export. One entry of Settings, Profile, first
// among the person's and this computer's: their name and picture, which the foot of the sidebar
// shows. Its writes are its own server part's (`../src/server.ts`).
import { defineUiModule } from '@openagt/ui/module'
import { UserRound } from 'lucide-react'
import { ProfileSettings } from './ProfileSettings.js'

export default defineUiModule({
  name: 'user-info',
  hooks: {
    'ui.view': [{ place: 'settings.section', id: 'profile', title: 'Profile', icon: UserRound, order: 10, View: ProfileSettings }],
  },
})
