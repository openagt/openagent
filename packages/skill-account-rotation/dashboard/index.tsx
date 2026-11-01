// The skill's UI: the package's `./dashboard` export. One card, built only on the `account-rotation`
// command, so it shows on the dashboard's Overview what an agent sees through the same command.
import { defineModule } from '@openagt/dashboard/module'
import { AccountsCard } from './AccountsCard.js'
import './dashboard.css'

export default defineModule({
  cards: [{ id: 'accounts', label: 'Accounts', order: 45, width: '1/3', minWidth: '1/4', Card: AccountsCard }],
  stylesheet: 'dashboard.css',
})
