// agent-driver's UI (#2394): the package's `./dashboard` export. Everything the dashboard shows of
// the coding agents: the control under the message box that picks the agent, its model and how hard
// it thinks (and says them in a session); the Overview's usage card and the notice of an agent's
// newer version; Settings › Coding agent; the accounts card, on the Overview and the Permissions
// page; and the presses that fix what its `app.attention` items say (installing an agent, adding an
// account). Each reads through the package's server part, which answers for this computer.
import { Bot } from 'lucide-react'
import { defineUiModule } from '@openagt/ui/module'
import { AccountsCard, OverviewAccounts } from './AccountsCard.js'
import { AgentControl } from './AgentMenu.js'
import { AgentSettings } from './AgentSettings.js'
import { AgentUpdates } from './AgentUpdates.js'
import { Usage } from './Usage.js'
import { connectFix, installFix } from './setup.js'

export default defineUiModule({
  name: 'agent-driver',
  hooks: {
    'ui.view': [
      { place: 'composer.control', id: 'agent', at: 'row', View: AgentControl },
      { place: 'overview.card', id: 'usage', label: 'Usage', order: 9, width: '1/2', minWidth: '1/3', View: Usage },
      { place: 'overview.card', id: 'accounts', label: 'Coding agent accounts', order: 45, width: '1/3', minWidth: '1/4', View: OverviewAccounts },
      { place: 'overview.notice', id: 'updates', View: AgentUpdates },
      { place: 'settings.section', id: 'agent', title: 'Coding agent', icon: Bot, order: 40, View: AgentSettings },
      { place: 'permissions.section', id: 'accounts', label: 'Coding agent accounts', View: AccountsCard },
    ],
    'ui.action': [installFix, connectFix],
  },
})
