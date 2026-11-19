// The skill's UI: the package's `./dashboard` export. One card, on the dashboard's Overview and its
// Permissions page. It reads the accounts through the package's server part, which answers what
// the `account-rotation` command's reads answer, so it shows what an agent sees through the
// command, and changes them through the command.
import { defineUiModule } from '@openagt/ui/module'
import { AccountsCard } from './AccountsCard.js'

export default defineUiModule({
  name: 'account-rotation',
  hooks: {
    'ui.view': [
      { place: 'overview.card', id: 'accounts', label: 'Coding agent accounts', order: 45, width: '1/3', minWidth: '1/4', View: AccountsCard },
      { place: 'permissions.section', id: 'accounts', label: 'Coding agent accounts', View: AccountsCard },
    ],
  },
})
