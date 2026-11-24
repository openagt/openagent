// profiles' UI part: the package's `./dashboard` export. The Profiles page, last of the modules'
// rows in the sidebar; the gear's first line under the message box, which picks the profile of
// every next run; and the Overview's line on the profiles. What it reads and saves is its own
// server part's (`../src/server.ts`).
import { defineUiModule } from '@openagt/ui/module'
import { Bot } from 'lucide-react'
import { PROFILES_PAGE } from './calls.js'
import { ProfileControl } from './ProfileControl.js'
import { ProfilesPage } from './ProfilesPage.js'
import { ProfilesPart } from './ProfilesPart.js'

export default defineUiModule({
  name: 'profiles',
  hooks: {
    'ui.view': [
      { place: 'app.page', id: PROFILES_PAGE, label: 'Profiles', icon: Bot, order: 90, View: ProfilesPage },
      { place: 'composer.control', id: 'profile', at: 'setup', order: 10, View: ProfileControl },
      { place: 'overview.line', id: 'profiles', label: 'Agent profiles', order: 4, View: ProfilesPart },
    ],
  },
})
