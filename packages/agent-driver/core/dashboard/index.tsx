// agent-driver's UI (#2394): the package's `./dashboard` export. One card, the coding agents'
// accounts, on the dashboard's Overview and its Permissions page, and the press that connects an
// agent where a new install is asked for one. It reads the accounts through
// the package's server part, which answers what the `account-rotation` command's reads answer, so
// it shows what an agent sees through the command, and changes them through the command.
import { defineUiModule } from '@openagt/ui/module'
import { AccountsCard, ConnectAgent, OverviewAccounts } from './AccountsCard.js'

export default defineUiModule({
  name: 'agent-driver',
  hooks: {
    'ui.view': [
      { place: 'overview.card', id: 'accounts', label: 'Coding agent accounts', order: 45, width: '1/3', minWidth: '1/4', View: OverviewAccounts },
      { place: 'permissions.section', id: 'accounts', label: 'Coding agent accounts', View: AccountsCard },
      { place: 'agent.connect', id: 'connect', View: ConnectAgent },
    ],
  },
})
