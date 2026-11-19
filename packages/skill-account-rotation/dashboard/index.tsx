// The skill's UI: the package's `./dashboard` export. One card, built only on the `account-rotation`
// command, so it shows on the dashboard's Overview and its Permissions page what an agent sees
// through the same command.
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
